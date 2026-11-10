import { afterEach, describe, expect, it, vi } from "vitest";
import { raiseAlert, setAlertSink, slackAlerts, slackMessage } from "./alert";

afterEach(() => {
  setAlertSink(undefined);
  vi.restoreAllMocks();
});

function slack(status = 200) {
  const posts: { url: string; body: { text: string } }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    posts.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response("ok", { status });
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

describe("slackMessage", () => {
  it("names the event and source, then lists the fields that are set", () => {
    const { text } = slackMessage("cv_request.expire_failed", "web (production)", { userId: "u1", code: undefined, status: 404, t: "now" });
    expect(text).toContain("*cv_request.expire_failed* · web (production)");
    expect(text).toContain("userId: u1");
    expect(text).toContain("status: 404");
    expect(text).not.toContain("code:");
    expect(text).not.toContain("t: now");
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
