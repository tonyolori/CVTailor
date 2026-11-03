import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollTask, WORKER_OFF_MESSAGE } from "./TaskWait";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("pollTask", () => {
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

  it("returns the result once the task finishes", async () => {
    serve((n) => json(n < 3 ? { status: "pending" } : { status: "done", output: { a: 1 } }));
    const p = pollTask(1);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await p).toEqual({ status: "done", output: { a: 1 } });
  });

  it("checks less often once it has waited a while", async () => {
    serve(() => json({ status: "pending" }));
    void pollTask(1);
    await vi.advanceTimersByTimeAsync(30_000);
    const early = calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(early).toBeGreaterThanOrEqual(10);
    expect(calls.length - early).toBeLessThanOrEqual(4);
  });

  it("gives up with a clear message, and drops the task", async () => {
    serve(() => json({ status: "pending" }));
    const p = pollTask(7);
    await vi.advanceTimersByTimeAsync(310_000);
    expect(await p).toEqual({ status: "failed", error: WORKER_OFF_MESSAGE });
    expect(calls.at(-1)).toEqual({ url: "/api/tasks/7", method: "DELETE" });
  });

  it("keeps waiting through a dropped connection", async () => {
    serve((n) => {
      if (n === 1) throw new Error("network");
      return json({ status: "done", output: 1 });
    });
    const p = pollTask(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await p).status).toBe("done");
  });

  it("stops when cancelled", async () => {
    const controller = new AbortController();
    serve(() => json({ status: "pending" }));
    const p = pollTask(1, undefined, controller.signal);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await p).status).toBe("cancelled");
  });
});
