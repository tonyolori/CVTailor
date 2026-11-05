import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollCvRequest, STILL_WRITING_MESSAGE } from "./CvWait";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("pollCvRequest", () => {
  let calls: { url: string; method: string }[];

  function serve(respond: (n: number) => Response | Promise<Response>) {
    calls = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      return respond(calls.length);
    });
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns once the CV is written", async () => {
    serve((n) => json(n < 3 ? { status: "running" } : { status: "done" }));
    const p = pollCvRequest(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await p).toEqual({ status: "done" });
    expect(calls[0]).toEqual({ url: "/api/cv-requests/1", method: "GET" });
  });

  it("passes on why it wasn't written", async () => {
    serve(() => json({ status: "failed", error: "The CV kept including things that aren't in your library." }));
    expect(await pollCvRequest(1)).toEqual({ status: "failed", error: "The CV kept including things that aren't in your library." });
  });

  it("checks less often once it has waited a while", async () => {
    serve(() => json({ status: "running" }));
    void pollCvRequest(1);
    await vi.advanceTimersByTimeAsync(30_000);
    const early = calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(early).toBeGreaterThanOrEqual(8);
    expect(calls.length - early).toBeLessThanOrEqual(4);
  });

  it("stops checking after a few minutes and says it's still being written, without cancelling it", async () => {
    serve(() => json({ status: "running" }));
    const p = pollCvRequest(7);
    await vi.advanceTimersByTimeAsync(400_000);
    expect(await p).toEqual({ status: "waiting", error: STILL_WRITING_MESSAGE });
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("keeps waiting through a dropped connection", async () => {
    serve((n) => {
      if (n === 1) throw new Error("network");
      return json({ status: "done" });
    });
    const p = pollCvRequest(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await p).status).toBe("done");
  });

  it("stops when cancelled", async () => {
    const controller = new AbortController();
    serve(() => json({ status: "running" }));
    const p = pollCvRequest(1, controller.signal);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await p).status).toBe("cancelled");
  });
});
