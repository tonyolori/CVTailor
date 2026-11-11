import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAlertSink } from "@cvtailor/core/alert";
import { errorFields, log, logged, loggedFetch } from "./log";

const SECRET = "ada@example.com";

let lines: { level: string; line: Record<string, unknown>; raw: string }[];

beforeEach(() => {
  lines = [];
  const capture = (level: string) => (raw: string) => lines.push({ level, raw, line: JSON.parse(raw) });
  vi.spyOn(console, "log").mockImplementation(capture("info"));
  vi.spyOn(console, "warn").mockImplementation(capture("warn"));
  vi.spyOn(console, "error").mockImplementation(capture("error"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const answering = (res: Response) => vi.stubGlobal("fetch", vi.fn(async () => res));

describe("log", () => {
  it("writes one JSON line to the console method for its level", () => {
    log("thing.happened", { count: 1 }, "warn");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.level).toBe("warn");
    expect(lines[0]!.line).toMatchObject({ event: "thing.happened", level: "warn", count: 1 });
  });

  it("raises an alert for errors only, with the fields made safe", () => {
    const alerts: { event: string; fields: Record<string, unknown> }[] = [];
    setAlertSink((event, fields) => alerts.push({ event, fields }));
    try {
      log("thing.happened", { count: 1 }, "warn");
      log("thing.failed", { reason: `no user ${SECRET}` }, "error");
    } finally {
      setAlertSink(undefined);
    }
    expect(alerts).toEqual([{ event: "thing.failed", fields: { reason: "no user [email]" } }]);
  });

  it("hands the exception from errorFields() to the alert, and leaves it out of the line", () => {
    const seen: unknown[] = [];
    setAlertSink((_event, _fields, exception) => seen.push(exception));
    const err = new Error(`no user ${SECRET}`);
    try {
      log("thing.failed", { op: "x", ...errorFields(err) }, "error");
    } finally {
      setAlertSink(undefined);
    }
    expect(seen).toEqual([err]);
    expect(JSON.stringify(lines[0]!.line)).not.toContain("no user");
  });
});

describe("errorFields", () => {
  it("names the error and where it came from, without its message", () => {
    const fields = errorFields(new Error(`could not parse ${SECRET}`));
    expect(fields.errorType).toBe("Error");
    expect(fields.at).toMatch(/log\.test/);
    expect(JSON.stringify(fields)).not.toContain(SECRET);
  });

  it("keeps the network code a failed fetch carries in its cause", () => {
    const err = new TypeError("fetch failed", { cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }) });
    expect(errorFields(err)).toMatchObject({ errorType: "TypeError", code: "ECONNREFUSED" });
  });
});

describe("loggedFetch", () => {
  it("logs the response with the query string removed", async () => {
    answering(new Response("{}", { status: 200 }));
    const res = await loggedFetch(`https://db.example.com/rest/v1/waitlist?email=eq.${SECRET}`, { method: "PATCH" });
    expect(res.status).toBe(200);
    expect(lines[0]!.line).toMatchObject({ event: "http.response", method: "PATCH", host: "db.example.com", path: "/rest/v1/waitlist", status: 200 });
    expect(lines[0]!.raw).not.toContain(SECRET);
  });

  it("works with the relative addresses the browser uses", async () => {
    answering(new Response("{}", { status: 200 }));
    await loggedFetch("/api/tasks/7?x=1");
    expect(lines[0]!.line).toMatchObject({ method: "GET", path: "/api/tasks/7" });
  });

  it("reports a failed answer's error code and leaves its body readable", async () => {
    answering(new Response(JSON.stringify({ code: 429, error_code: "over_email_send_rate_limit", msg: `limit for ${SECRET}` }), { status: 429 }));
    const res = await loggedFetch("https://db.example.com/auth/v1/otp", { method: "POST" });
    expect(lines[0]!.level).toBe("warn");
    expect(lines[0]!.line).toMatchObject({ event: "http.response", status: 429, code: "over_email_send_rate_limit" });
    expect(lines[0]!.raw).not.toContain(SECRET);
    expect((await res.json()).error_code).toBe("over_email_send_rate_limit");
  });

  it("ignores a code that isn't a plain identifier", async () => {
    answering(new Response(JSON.stringify({ code: `bad address ${SECRET}` }), { status: 400 }));
    await loggedFetch("https://db.example.com/x");
    expect(lines[0]!.line.code).toBeUndefined();
    expect(lines[0]!.raw).not.toContain(SECRET);
  });

  it("logs a server error at error level", async () => {
    answering(new Response("oops", { status: 503 }));
    await loggedFetch("https://db.example.com/x");
    expect(lines[0]!.level).toBe("error");
  });

  it("logs a network failure and still throws it", async () => {
    const err = new TypeError("fetch failed", { cause: Object.assign(new Error("dns"), { code: "ENOTFOUND" }) });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(err)));
    await expect(loggedFetch("https://db.example.com/x")).rejects.toBe(err);
    expect(lines[0]!.level).toBe("error");
    expect(lines[0]!.line).toMatchObject({ event: "http.failed", host: "db.example.com", code: "ENOTFOUND" });
  });

  it("treats a cancelled request as cancelled, not as a failure", async () => {
    const err = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(err)));
    await expect(loggedFetch("https://db.example.com/x")).rejects.toBe(err);
    expect(lines[0]!.level).toBe("info");
    expect(lines[0]!.line.event).toBe("http.cancelled");
  });
});

describe("logged", () => {
  it("logs a good response's status and returns it untouched", async () => {
    const res = new Response("{}", { status: 200 });
    const out = await logged("POST /api/x", async () => res)();
    expect(out).toBe(res);
    expect(lines[0]!.level).toBe("info");
    expect(lines[0]!.line).toMatchObject({ event: "op.done", op: "POST /api/x", status: 200 });
  });

  it("logs the error a JSON response gives the user, and keeps its body readable", async () => {
    const out = await logged("POST /api/x", async () => Response.json({ error: "Too many requests." }, { status: 429 }))();
    expect(lines[0]!.level).toBe("warn");
    expect(lines[0]!.line).toMatchObject({ status: 429, reason: "Too many requests." });
    expect((await out.json()).error).toBe("Too many requests.");
  });

  it("logs a 500 at error level", async () => {
    await logged("POST /api/x", async () => Response.json({ error: "nope" }, { status: 500 }))();
    expect(lines[0]!.level).toBe("error");
  });

  it("treats a redirect carrying ?error= as a failure", async () => {
    await logged("POST /api/x", async () => new Response(null, { status: 303, headers: { location: "https://site.example/pricing?error=checkout" } }))();
    expect(lines[0]!.level).toBe("warn");
    expect(lines[0]!.line).toMatchObject({ status: 303, reason: "checkout" });
  });

  it("doesn't log where a good redirect goes, since a payment link holds a token", async () => {
    await logged("POST /api/x", async () => new Response(null, { status: 303, headers: { location: "https://pay.example/secret-access-code" } }))();
    expect(lines[0]!.level).toBe("info");
    expect(lines[0]!.raw).not.toContain("secret-access-code");
  });

  it("logs a server action that answers with a failure", async () => {
    await logged("action.save", async () => ({ ok: false, message: "Couldn't save your library." }))();
    expect(lines[0]!.level).toBe("warn");
    expect(lines[0]!.line).toMatchObject({ op: "action.save", reason: "Couldn't save your library." });
  });

  it("logs a server action that succeeds", async () => {
    await logged("action.save", async () => ({ ok: true, message: "Saved." }))();
    expect(lines[0]!.level).toBe("info");
    expect(lines[0]!.line.reason).toBeUndefined();
  });

  it("passes arguments through", async () => {
    const add = logged("op", async (a: number, b: number) => a + b);
    expect(await add(2, 3)).toBe(5);
  });

  it("logs a thrown error without its message and rethrows it", async () => {
    const err = new Error(`bad ${SECRET}`);
    await expect(
      logged("op", async () => {
        throw err;
      })(),
    ).rejects.toBe(err);
    expect(lines[0]!.level).toBe("error");
    expect(lines[0]!.line).toMatchObject({ event: "op.threw", op: "op", errorType: "Error" });
    expect(lines[0]!.raw).not.toContain(SECRET);
  });

  it("treats Next's redirect() as a normal ending, and rethrows it", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    await expect(
      logged("op", async () => {
        throw redirect;
      })(),
    ).rejects.toBe(redirect);
    expect(lines[0]!.level).toBe("info");
    expect(lines[0]!.line).toMatchObject({ event: "op.done", outcome: "redirect" });
  });
});
