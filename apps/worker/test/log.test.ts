import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorInfo } from "../src/db";
import { resendSender } from "../src/email/send";
import { dbFetch, failureLoggingFetch, log } from "../src/log";
import { politeHttp } from "../src/sources/http";

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

const noPause = async () => undefined;
const events = () => lines.map((l) => l.line.event);

describe("log", () => {
  it("sends errors to console.error", () => {
    log("thing.failed", { count: 1 }, "error");
    expect(lines[0]!).toMatchObject({ level: "error", line: { event: "thing.failed", level: "error", count: 1 } });
  });
});

describe("errorInfo", () => {
  it("adds the network code a failed fetch carries", () => {
    const err = new TypeError("fetch failed", { cause: Object.assign(new Error("dns"), { code: "ENOTFOUND" }) });
    expect(errorInfo(err)).toMatchObject({ kind: "TypeError", code: "ENOTFOUND" });
  });

  it("leaves out an ordinary error's message", () => {
    expect(JSON.stringify(errorInfo(new Error(`parse failed for ${SECRET}`)))).not.toContain(SECRET);
  });
});

describe("failureLoggingFetch", () => {
  it("stays quiet on success, because the task loop polls every few seconds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    await failureLoggingFetch("https://db.example.com/rest/v1/cv_requests");
    expect(lines).toEqual([]);
  });

  it("logs a failed answer's code, with the filter values left out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "23505", message: SECRET }), { status: 409 })));
    const res = await failureLoggingFetch(`https://db.example.com/rest/v1/waitlist?email=eq.${SECRET}`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(lines[0]!.line).toMatchObject({ event: "db.response", method: "POST", path: "/rest/v1/waitlist", status: 409, code: "23505" });
    expect(lines[0]!.raw).not.toContain(SECRET);
  });

  it("logs a network failure once it has given up, and still throws it", async () => {
    const err = new TypeError("fetch failed");
    const fetchFn = vi.fn(async () => Promise.reject(err));
    vi.stubGlobal("fetch", fetchFn);
    await expect(dbFetch(noPause)("https://db.example.com/x")).rejects.toBe(err);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(lines.filter((l) => l.level === "error")).toHaveLength(1);
    expect(lines.at(-1)!.line).toMatchObject({ event: "db.failed", kind: "TypeError", attempts: 4 });
  });

  it("rides out a dropped connection, warning but not alerting", async () => {
    const dropped = new TypeError("fetch failed", { cause: Object.assign(new Error("read EADDRNOTAVAIL"), { code: "EADDRNOTAVAIL" }) });
    const fetchFn = vi.fn().mockRejectedValueOnce(dropped).mockResolvedValueOnce(new Response("[]"));
    vi.stubGlobal("fetch", fetchFn);
    const res = await dbFetch(noPause)("https://db.example.com/rest/v1/jobs", { method: "PATCH", body: "{}" });
    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(lines.map((l) => [l.level, l.line.event])).toEqual([["warn", "db.retry"]]);
  });

  it("doesn't resend an insert that may have arrived", async () => {
    const dropped = new TypeError("fetch failed", { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });
    const fetchFn = vi.fn(async () => Promise.reject(dropped));
    vi.stubGlobal("fetch", fetchFn);
    await expect(dbFetch(noPause)("https://db.example.com/rest/v1/runs", { method: "POST", body: "{}" })).rejects.toBe(dropped);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("resends an insert that never connected, and an upsert either way", async () => {
    const timeout = new TypeError("fetch failed", { cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }) });
    const reset = new TypeError("fetch failed", { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });
    const fetchFn = vi.fn().mockRejectedValueOnce(timeout).mockResolvedValueOnce(new Response("[]")).mockRejectedValueOnce(reset).mockResolvedValueOnce(new Response("[]"));
    vi.stubGlobal("fetch", fetchFn);
    await dbFetch(noPause)("https://db.example.com/rest/v1/runs", { method: "POST", body: "{}" });
    await dbFetch(noPause)("https://db.example.com/rest/v1/daily_runs", { method: "POST", body: "{}", headers: { Prefer: "resolution=merge-duplicates" } });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });
});

describe("politeHttp", () => {
  it("logs a response", async () => {
    await politeHttp({}, async () => new Response("{}"), noPause).json("https://jobs.example.com/feed?page=2");
    expect(lines[0]!.line).toMatchObject({ event: "http.response", host: "jobs.example.com", path: "/feed", status: 200 });
  });

  it("logs a 404, which gets no retry", async () => {
    const out = await politeHttp({}, async () => new Response("", { status: 404 }), noPause).text("https://jobs.example.com/gone");
    expect(out).toBeNull();
    expect(lines[0]!.level).toBe("warn");
    expect(lines[0]!.line).toMatchObject({ event: "http.response", status: 404 });
  });

  it("logs each network failure, and giving up", async () => {
    const fail = async () => {
      throw new TypeError("fetch failed");
    };
    await politeHttp({}, fail, noPause).json("https://jobs.example.com/feed");
    expect(events()).toEqual(["http.failed", "http.failed", "http.failed", "http.gave_up"]);
    expect(lines[0]!.line).toMatchObject({ host: "jobs.example.com", attempt: 1, kind: "TypeError" });
  });

  it("logs a body that isn't the JSON it should be", async () => {
    const out = await politeHttp({}, async () => new Response("<html>"), noPause).json("https://jobs.example.com/feed");
    expect(out).toBeNull();
    expect(events()).toContain("http.bad_body");
  });
});

describe("resendSender", () => {
  it("logs why Resend refused an email, and still throws", async () => {
    const fetchFn = async () => new Response(JSON.stringify({ name: "validation_error", message: `bad ${SECRET}` }), { status: 403 });
    const sender = resendSender("key", fetchFn);
    await expect(sender.send({ to: SECRET, from: "x@y.co", subject: "s", html: "h", text: "t" })).rejects.toThrow("Resend answered 403");
    expect(lines[0]!.line).toMatchObject({ event: "email.refused", status: 403, code: "validation_error" });
    expect(lines[0]!.raw).not.toContain(SECRET);
  });
});
