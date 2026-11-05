import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createProvider, mayUseAi } from "./index";
import { DeepSeekProvider, estimateDeepSeekCost } from "./deepseek";

const config = { provider: "deepseek" as const, apiKey: "test-key", modelSmall: "deepseek-flash", modelStrong: "deepseek-v4-pro" };
const schema = z.object({ n: z.number() });
const req = { id: "1", tier: "small" as const, system: "Stable instructions.", user: "the posting", schema };

/** Midweek, outside DeepSeek's peak hours. */
const OFF_PEAK = new Date("2026-11-04T12:00:00Z");

function reply(content: string, finish = "stop", usage: Record<string, number> = {}) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: finish, message: { role: "assistant", content } }],
      usage: { prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100, completion_tokens: 50, ...usage },
    }),
    { status: 200 },
  );
}

/** A provider over scripted responses. Records each request body, and never waits between retries. */
function scripted(...responses: (Response | Error)[]) {
  const bodies: Record<string, any>[] = [];
  const headers: Headers[] = [];
  const fetchFn: typeof fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    headers.push(new Headers(init?.headers));
    const next = responses.shift();
    if (!next) throw new Error("no scripted response left");
    if (next instanceof Error) throw next;
    return next;
  };
  return { provider: new DeepSeekProvider(config, { fetchFn, pause: async () => {}, now: () => OFF_PEAK }), bodies, headers };
}

describe("DeepSeekProvider requests", () => {
  it("sends the key, the tier's model and JSON mode", async () => {
    const { provider, bodies, headers } = scripted(reply('{"n":1}'), reply('{"n":1}'));
    await provider.complete(req);
    await provider.complete({ ...req, tier: "strong" });
    expect(headers[0]?.get("authorization")).toBe("Bearer test-key");
    expect(bodies[0]?.model).toBe("deepseek-flash");
    expect(bodies[1]?.model).toBe("deepseek-v4-pro");
    expect(bodies[0]?.response_format).toEqual({ type: "json_object" });
  });

  it("never offers tools, since postings are untrusted", async () => {
    const { provider, bodies } = scripted(reply('{"n":1}'));
    await provider.complete(req);
    expect(bodies[0]).not.toHaveProperty("tools");
    expect(bodies[0]).not.toHaveProperty("tool_choice");
  });

  it("asks for json by name and shows the schema, as JSON mode has no schema parameter", async () => {
    const { provider, bodies } = scripted(reply('{"n":1}'));
    await provider.complete(req);
    const system = bodies[0]?.messages[0];
    expect(system.role).toBe("system");
    expect(system.content).toMatch(/json/);
    expect(system.content).toContain('"n"');
  });

  it("shows the model limits that strict schemas leave out, so fewer replies need a paid retry", async () => {
    const { provider, bodies } = scripted(reply('{"list":["a"]}'));
    await provider.complete({ ...req, schema: z.object({ list: z.array(z.string()).max(8) }) });
    expect(bodies[0]?.messages[0].content).toContain('"maxItems":8');
  });

  it("keeps the stable parts first and the posting last, which is what makes prefix caching hit", async () => {
    const { provider, bodies } = scripted(reply('{"n":1}'));
    await provider.complete({ ...req, cachedContext: "One user's library." });
    const [system, user] = bodies[0]?.messages;
    expect(system.content.indexOf("Stable instructions.")).toBeLessThan(system.content.indexOf("One user's library."));
    expect(system.content).not.toContain("the posting");
    expect(user).toEqual({ role: "user", content: "the posting" });
  });

  it("turns thinking off at low effort, because it's billed as output", async () => {
    const { provider, bodies } = scripted(reply('{"n":1}'), reply('{"n":1}'), reply('{"n":1}'), reply('{"n":1}'));
    await provider.complete(req);
    await provider.complete({ ...req, effort: "low" });
    await provider.complete({ ...req, effort: "medium" });
    await provider.complete({ ...req, effort: "high" });
    expect(bodies.map((b) => b.reasoning_effort)).toEqual(["none", "none", "low", "high"]);
  });

  it("passes on the request's token limit", async () => {
    const { provider, bodies } = scripted(reply('{"n":1}'));
    await provider.complete({ ...req, maxTokens: 500 });
    expect(bodies[0]?.max_tokens).toBe(500);
  });
});

describe("DeepSeekProvider replies", () => {
  it("returns validated data and reports cached tokens separately", async () => {
    const { provider } = scripted(reply('{"n":7}', "stop", { prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20, completion_tokens: 10 }));
    const r = await provider.complete(req);
    expect(r.ok && r.data.n).toBe(7);
    expect(r.usage).toMatchObject({ inputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 0, outputTokens: 10, calls: 1 });
    expect(r.usage.costUsd).toBeCloseTo(estimateDeepSeekCost("deepseek-flash", { inputTokens: 20, outputTokens: 10, cacheReadTokens: 80, cacheWriteTokens: 0 }, OFF_PEAK));
  });

  it("retries a blank reply, which DeepSeek documents as possible in JSON mode", async () => {
    const { provider, bodies } = scripted(reply("   "), reply('{"n":1}'));
    const r = await provider.complete(req);
    expect(r.ok).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(r.usage.calls).toBe(2);
  });

  it("feeds validation errors back to the model", async () => {
    const { provider, bodies } = scripted(reply('{"n":"x"}'), reply('{"n":2}'));
    const r = await provider.complete(req);
    expect(r.ok && r.data.n).toBe(2);
    expect(bodies[1]?.messages[1].content).toContain("failed validation");
  });

  it("treats a truncated reply as a failure rather than parsing part of it", async () => {
    const { provider } = scripted(reply('{"n":1}', "length"));
    const r = await provider.complete(req);
    expect(!r.ok && r.kind).toBe("other");
  });

  it("treats the content filter as a refusal", async () => {
    const { provider } = scripted(reply("", "content_filter"));
    const r = await provider.complete(req);
    expect(!r.ok && r.kind).toBe("refusal");
  });
});

describe("DeepSeekProvider errors", () => {
  const status = (code: number, body = "the prompt said: my private CV") => new Response(body, { status: code });

  it("an empty balance stops the stage, so postings aren't marked failed for good", async () => {
    const { provider, bodies } = scripted(status(402));
    const r = await provider.complete(req);
    expect(!r.ok && r.kind).toBe("auth");
    expect(!r.ok && r.error).toMatch(/balance/i);
    expect(bodies).toHaveLength(1);
  });

  it("a rejected key is an auth failure", async () => {
    const { provider } = scripted(status(401));
    const r = await provider.complete(req);
    expect(!r.ok && r.kind).toBe("auth");
  });

  it.each([429, 500, 503])("retries %i and then succeeds", async (code) => {
    const { provider, bodies } = scripted(status(code), reply('{"n":1}'));
    const r = await provider.complete(req);
    expect(r.ok).toBe(true);
    expect(bodies).toHaveLength(2);
  });

  it("reports a rate limit once retries run out", async () => {
    const { provider, bodies } = scripted(status(429), status(429), status(429));
    const r = await provider.complete(req);
    expect(!r.ok && r.kind).toBe("rate_limit");
    expect(bodies).toHaveLength(3);
  });

  it("an overloaded service stops the stage instead of failing postings for good", async () => {
    const { provider } = scripted(status(503), status(503), status(503));
    const r = await provider.complete(req);
    expect(!r.ok && r.kind).toBe("rate_limit");
  });

  it("retries a network failure", async () => {
    const { provider } = scripted(new TypeError("fetch failed"), reply('{"n":1}'));
    const r = await provider.complete(req);
    expect(r.ok).toBe(true);
  });

  it("does not retry a request the API calls invalid", async () => {
    const { provider, bodies } = scripted(status(422));
    const r = await provider.complete(req);
    expect(!r.ok && r.kind).toBe("other");
    expect(bodies).toHaveLength(1);
  });

  it("never lets response text into an error, which logs and task rows could carry", async () => {
    for (const code of [400, 401, 402, 422, 429, 500]) {
      const { provider } = scripted(status(code), status(code), status(code));
      const r = await provider.complete(req);
      expect(!r.ok && r.error).not.toContain("private CV");
    }
  });
});

describe("DeepSeekProvider completeMany", () => {
  const reqs = Array.from({ length: 12 }, (_, i) => ({ ...req, id: String(i) }));

  it("answers every request under its own id", async () => {
    const { provider, bodies } = scripted(...reqs.map(() => reply('{"n":1}')));
    const results = await provider.completeMany(reqs);
    expect([...results.keys()].sort()).toEqual(reqs.map((r) => r.id).sort());
    expect(bodies).toHaveLength(12);
  });

  it("runs a few at a time, without sending everything at once", async () => {
    let active = 0;
    let peak = 0;
    const fetchFn: typeof fetch = async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return reply('{"n":1}');
    };
    await new DeepSeekProvider(config, { fetchFn, pause: async () => {}, now: () => OFF_PEAK }).completeMany(reqs);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(reqs.length);
  });

  it("stops spending once the balance is empty, and marks the rest for the next run", async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls++;
      return new Response("", { status: 402 });
    };
    const results = await new DeepSeekProvider(config, { fetchFn, pause: async () => {}, now: () => OFF_PEAK }).completeMany(reqs);
    expect(calls).toBeLessThan(reqs.length);
    expect(results.size).toBe(reqs.length);
    for (const r of results.values()) expect(!r.ok && r.kind).toBe("auth");
  });
});

describe("estimateDeepSeekCost", () => {
  const million = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

  it("doubles in the weekday peak hours", () => {
    const offPeak = estimateDeepSeekCost("deepseek-flash", million, OFF_PEAK);
    expect(estimateDeepSeekCost("deepseek-flash", million, new Date("2026-11-04T01:00:00Z"))).toBeCloseTo(offPeak * 2);
    expect(estimateDeepSeekCost("deepseek-flash", million, new Date("2026-11-04T09:59:00Z"))).toBeCloseTo(offPeak * 2);
  });

  it("stays off-peak between the two windows, after them and at weekends", () => {
    const offPeak = estimateDeepSeekCost("deepseek-flash", million, OFF_PEAK);
    for (const at of ["2026-11-04T04:00:00Z", "2026-11-04T05:59:00Z", "2026-11-04T10:00:00Z", "2026-11-07T02:00:00Z", "2026-11-08T08:00:00Z"]) {
      expect(estimateDeepSeekCost("deepseek-flash", million, new Date(at))).toBeCloseTo(offPeak);
    }
  });

  it("charges each kind of token at its own rate", () => {
    const at = OFF_PEAK;
    expect(estimateDeepSeekCost("deepseek-flash", million, at)).toBeCloseTo(0.15);
    expect(estimateDeepSeekCost("deepseek-flash", { ...million, inputTokens: 0, outputTokens: 1_000_000 }, at)).toBeCloseTo(0.6);
    expect(estimateDeepSeekCost("deepseek-flash", { ...million, inputTokens: 0, cacheReadTokens: 1_000_000 }, at)).toBeCloseTo(0.003);
    expect(estimateDeepSeekCost("deepseek-v4-pro", million, at)).toBeCloseTo(0.66);
  });

  it("costs an unknown model high, so a typo can't quietly defeat the budget", () => {
    expect(estimateDeepSeekCost("deepseek-typo", million, OFF_PEAK)).toBeGreaterThan(estimateDeepSeekCost("deepseek-v4-pro", million, new Date("2026-11-04T01:00:00Z")));
  });
});

describe("choosing DeepSeek", () => {
  it("createProvider builds it from config", async () => {
    expect((await createProvider(config)).name).toBe("deepseek");
  });

  it("createProvider names the missing key", async () => {
    await expect(createProvider({ ...config, apiKey: undefined })).rejects.toThrow("DEEPSEEK_API_KEY");
  });

  it("createProvider refuses a model left over from another provider, before any call is made", async () => {
    await expect(createProvider({ ...config, modelSmall: "claude-haiku-5-5" })).rejects.toThrow("LLM_MODEL_SMALL");
    await expect(createProvider({ ...config, modelStrong: "claude-sonnet-5-5" })).rejects.toThrow("LLM_MODEL_STRONG");
  });

  it("serves any invited user, as a paid API rather than a personal plan", () => {
    expect(mayUseAi("deepseek", "owner@example.com", { email: "friend@example.com", isSynthetic: false }).allowed).toBe(true);
  });
});
