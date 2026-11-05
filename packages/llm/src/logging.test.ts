import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FakeProvider } from "./fake";
import { withLogging } from "./logging";
import type { LlmRequest } from "./types";

const SECRET = "Ada's CV text";

const request = (id: string): LlmRequest<{ a: number }> => ({ id, tier: "small", system: "s", user: SECRET, schema: z.object({ a: z.number() }) });

describe("withLogging", () => {
  it("logs a call's outcome and usage and returns its result", async () => {
    const log = vi.fn();
    const provider = withLogging(new FakeProvider(() => ({ a: 1 })), log);
    const r = await provider.complete(request("job-1"));
    expect(r.ok).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toBe("llm.response");
    expect(log.mock.calls[0]![1]).toMatchObject({ id: "job-1", tier: "small", ok: true });
    expect(log.mock.calls[0]![2]).toBe("info");
  });

  it("logs a failure's kind at error level, without its text", async () => {
    const log = vi.fn();
    const provider = withLogging(new FakeProvider(() => { throw new Error(SECRET); }), log);
    const r = await provider.complete(request("job-2"));
    expect(r.ok).toBe(false);
    expect(log.mock.calls[0]![1]).toMatchObject({ id: "job-2", ok: false, kind: "other" });
    expect(log.mock.calls[0]![2]).toBe("error");
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
  });

  it("logs each request in a batch", async () => {
    const log = vi.fn();
    const provider = withLogging(new FakeProvider(() => ({ a: 1 })), log);
    const out = await provider.completeMany([request("a"), request("b")]);
    expect(out.size).toBe(2);
    expect(log.mock.calls.map((c) => c[1].id).sort()).toEqual(["a", "b"]);
  });

  it("keeps the provider's name, which decides who may use AI", () => {
    expect(withLogging(new FakeProvider(() => ({ a: 1 })), vi.fn()).name).toBe("fake");
  });

  it("logs a thrown error's type and rethrows it", async () => {
    const log = vi.fn();
    const inner = new FakeProvider(() => ({ a: 1 }));
    const err = new RangeError(SECRET);
    inner.complete = () => Promise.reject(err);
    await expect(withLogging(inner, log).complete(request("job-3"))).rejects.toBe(err);
    expect(log.mock.calls[0]![0]).toBe("llm.threw");
    expect(log.mock.calls[0]![1]).toMatchObject({ id: "job-3", errorType: "RangeError" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
  });
});
