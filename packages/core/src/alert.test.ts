import { afterEach, describe, expect, it, vi } from "vitest";
import { alertsSent, describeException, raiseAlert, scrubbed, setAlertSink, slackAlerts, slackMessage } from "./alert";
import { errorFields } from "./log";

afterEach(() => {
  setAlertSink(undefined);
  vi.restoreAllMocks();
});

function slack(status: number | number[] = 200) {
  const statuses = Array.isArray(status) ? [...status] : [];
  const posts: { url: string; body: { text: string; blocks?: unknown[] } }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    posts.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response("ok", { status: Array.isArray(status) ? (statuses.shift() ?? 200) : status });
  });
  return { posts, fetch: fetch as unknown as typeof globalThis.fetch };
}

describe("raiseAlert", () => {
  it("does nothing without a sink", () => {
    expect(() => raiseAlert("thing.failed", {})).not.toThrow();
  });

  it("passes the event to the sink, and survives a sink that throws", () => {
    const seen: string[] = [];
    setAlertSink((event) => seen.push(event));
    raiseAlert("thing.failed", { code: "x" });
    expect(seen).toEqual(["thing.failed"]);

    setAlertSink(() => {
      throw new Error("boom");
    });
    expect(() => raiseAlert("thing.failed", {})).not.toThrow();
  });
});

describe("scrubbed", () => {
  it("takes values out of a message and keeps what says what went wrong", () => {
    expect(scrubbed('duplicate key value violates unique constraint "profiles_pkey" Key (email)=(ada@x.co)')).toBe(
      'duplicate key value violates unique constraint "profiles_pkey" Key (email)=(…)',
    );
    expect(scrubbed(`Unexpected token 'H', "Hello, I am Ada" is not valid JSON`)).toBe(`Unexpected token 'H', "…" is not valid JSON`);
    expect(scrubbed("can't reach https://api.example.com/v1/users?email=ada@x.co")).toBe("can't reach https://api.example.com/v1/users?…");
    expect(scrubbed("call me on 08031234567 or write to ada@x.co")).toBe("call me on [number] or write to [email]");
  });

  it("cuts long messages", () => {
    expect(scrubbed("x".repeat(1000)).length).toBeLessThanOrEqual(401);
  });
});

describe("describeException", () => {
  it("follows the causes, with each one's code, details and stack", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED", syscall: "connect" });
    const err = new Error("load user failed", { cause });
    const [outer, inner, ...rest] = describeException(err);
    expect(rest).toEqual([]);
    expect(outer).toMatchObject({ type: "Error", message: "load user failed" });
    expect(outer!.stack.length).toBeGreaterThan(0);
    expect(outer!.stack[0]).toMatch(/alert\.test\.ts/);
    expect(outer!.stack.join("\n")).not.toContain("/Users/");
    expect(inner).toMatchObject({ type: "Error", code: "ECONNREFUSED" });
    expect(inner!.details).toContain("syscall: connect");
  });

  it("lists a zod error's issues by path and code, without its message", () => {
    const err = Object.assign(new Error('[{"code":"invalid_type","path":["experience",0,"title"],"message":"Ada Lovelace"}]'), {
      name: "ZodError",
      issues: [{ code: "invalid_type", expected: "string", path: ["experience", 0, "title"], message: "anything" }],
    });
    const [r] = describeException(err);
    expect(r!.message).toBeUndefined();
    expect(r!.details).toEqual(["issue experience.0.title: invalid_type (expected string)"]);
  });

  it("describes what was thrown when it isn't an Error", () => {
    expect(describeException("gave up on ada@x.co")).toEqual([{ type: "string", message: "gave up on [email]", details: [], stack: [], moreFrames: 0 }]);
  });

  it("stops on a cause that points back to itself", () => {
    const err = new Error("loop") as Error & { cause?: unknown };
    err.cause = err;
    expect(describeException(err)).toHaveLength(1);
  });
});

describe("slackMessage", () => {
  it("shows the exception under the fields, and sums it up in the notification text", () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'id')");
    const { text, blocks } = slackMessage("op.threw", "web (production)", { op: "POST /api/cv-requests" }, err, { context: ["region dub1"], repeats: 3 });
    expect(text).toBe("op.threw · web (production): TypeError: Cannot read properties of undefined (reading 'id')");
    const all = JSON.stringify(blocks);
    expect(all).toContain("op: POST /api/cv-requests");
    expect(all).toContain("*TypeError*");
    expect(all).toContain("alert.test.ts");
    expect(all).toContain("region dub1 · +3 more like this since the last post");
  });

  it("escapes Slack's markup and keeps every section under its limit", () => {
    const err = new Error("<!channel> & <https://evil.example|click>");
    err.stack = `Error: x\n${Array.from({ length: 40 }, (_, i) => `    at fn${i} (/srv/app/packages/core/src/${"x".repeat(200)}.ts:1:1)`).join("\n")}`;
    const { blocks } = slackMessage("thing.failed", "worker", {}, err);
    const texts = (blocks as { text?: { text: string } }[]).flatMap((b) => (b.text ? [b.text.text] : []));
    expect(texts.join("")).not.toContain("<!channel>");
    expect(texts.join("")).toContain("&lt;!channel&gt; &amp;");
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(3000);
    expect(texts.join("")).toContain("more frames");
  });

  it("names the event and source, then lists the fields that are set", () => {
    const { text, blocks } = slackMessage("cv_request.expire_failed", "web (production)", { userId: "u1", code: undefined, status: 404, t: "now" });
    expect(text).toBe("cv_request.expire_failed · web (production)");
    const all = JSON.stringify(blocks);
    expect(all).toContain("*cv_request.expire_failed* · web (production)");
    expect(all).toContain("userId: u1");
    expect(all).toContain("status: 404");
    expect(all).not.toContain("code:");
    expect(all).not.toContain("t: now");
  });
});

describe("slackAlerts", () => {
  it("posts to the webhook", async () => {
    const { posts, fetch } = slack();
    const kept: Promise<unknown>[] = [];
    const sink = slackAlerts({ webhookUrl: "https://hooks.example/abc", source: "worker", fetch, keepAlive: (p) => kept.push(p) });
    sink("run.failed", { runDate: "2026-11-09", kind: "DbError" });
    await Promise.all(kept);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe("https://hooks.example/abc");
    expect(posts[0]!.body.text).toContain("run.failed");
  });

  it("posts the same failure once per window, and a different one straight away", () => {
    const { posts, fetch } = slack();
    let now = 0;
    const sink = slackAlerts({ webhookUrl: "https://hooks.example/abc", source: "web", fetch, now: () => now });
    sink("cv_request.expire_failed", { userId: "a" });
    sink("cv_request.expire_failed", { userId: "b" });
    sink("op.done", { op: "POST /api/cv-requests", status: 500 });
    expect(posts).toHaveLength(2);

    now = 10 * 60_000;
    sink("cv_request.expire_failed", { userId: "a" });
    expect(posts).toHaveLength(3);
  });

  it("waits for posts in flight, and errorFields() keeps the exception out of JSON", async () => {
    const { posts, fetch } = slack();
    setAlertSink(slackAlerts({ webhookUrl: "https://hooks.example/abc", source: "worker", fetch }));
    const fields = errorFields(new RangeError("too far"));
    raiseAlert("thing.failed", { kind: fields.errorType }, new RangeError("too far"));
    await alertsSent();
    expect(posts).toHaveLength(1);
    expect(JSON.stringify(posts[0]!.body.blocks)).toContain("*RangeError*");
    expect(JSON.stringify({ ...fields })).not.toContain("too far");
  });

  it("counts the repeats it held back, and says so in the next post", async () => {
    const { posts, fetch } = slack();
    let now = 0;
    const sink = slackAlerts({ webhookUrl: "https://hooks.example/abc", source: "web", fetch, now: () => now });
    sink("thing.failed", {});
    sink("thing.failed", {});
    sink("thing.failed", {});
    now = 10 * 60_000;
    sink("thing.failed", {});
    expect(posts).toHaveLength(2);
    expect(JSON.stringify(posts[1]!.body.blocks)).toContain("+2 more like this");
    now = 20 * 60_000;
    sink("thing.failed", {});
    expect(JSON.stringify(posts[2]!.body.blocks)).not.toContain("more like this");
  });

  it("sends the text alone when Slack refuses the blocks", async () => {
    const { posts, fetch } = slack([400, 200]);
    const kept: Promise<unknown>[] = [];
    const sink = slackAlerts({ webhookUrl: "https://hooks.example/abc", source: "web", fetch, keepAlive: (p) => kept.push(p) });
    sink("thing.failed", {}, new Error("boom"));
    await Promise.all(kept);
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toEqual({ text: "thing.failed · web: Error: boom" });
  });

  it("warns, without raising another alert, when Slack refuses or can't be reached", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const kept: Promise<unknown>[] = [];
    const refused = slackAlerts({ webhookUrl: "https://hooks.example/abc", source: "web", fetch: slack(404).fetch, keepAlive: (p) => kept.push(p) });
    const down = slackAlerts({
      webhookUrl: "https://hooks.example/abc",
      source: "web",
      fetch: (async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch,
      keepAlive: (p) => kept.push(p),
    });
    refused("thing.failed", {});
    down("thing.failed", {});
    await Promise.all(kept);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalled();
  });
});
