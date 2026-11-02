import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EnrichedJobSchema, ResumeSchema } from "@jobtailor/core";
import { estimateCost, FakeProvider, mayUseAi, stripNulls, toStrictJsonSchema, validateReply } from "./index";

describe("toStrictJsonSchema", () => {
  const schema = z.object({
    code: z.string().length(2),
    n: z.number().min(1).max(5),
    list: z.array(z.string()).min(3).default([]),
    maybe: z.string().optional(),
    nested: z.object({ a: z.string().nullable().default(null) }),
  });

  it("removes unsupported constraints and closes every object", () => {
    const { schema: s } = toStrictJsonSchema(schema);
    const text = JSON.stringify(s);
    for (const bad of ["minLength", "maxLength", "minimum", "maximum", '"default"', "$schema"]) {
      expect(text).not.toContain(bad);
    }
    const props = s.properties as Record<string, any>;
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["code", "n", "list", "maybe", "nested"]);
    expect(props.nested.additionalProperties).toBe(false);
    expect(props.maybe.anyOf).toEqual([{ type: "string" }, { type: "null" }]);
  });

  it("keeps enrichment within the anyOf limit so it can use strict output", () => {
    expect(toStrictJsonSchema(EnrichedJobSchema).anyOfCount).toBeLessThanOrEqual(16);
  });

  it("reports resume as over the limit, which sends it down the prompt-JSON path", () => {
    expect(toStrictJsonSchema(ResumeSchema).anyOfCount).toBeGreaterThan(16);
  });
});

describe("validateReply", () => {
  it("nulls for optional fields become zod defaults", () => {
    const r = validateReply(EnrichedJobSchema, { isOpen: true, workMode: "remote", postedAt: null, salary: null, category: null });
    expect(r.ok && r.data.category).toBe("other");
  });

  it("errors name fields, not values, so they are safe to log", () => {
    const r = validateReply(z.object({ secret: z.number() }), { secret: "my private CV text" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("secret");
      expect(r.error).not.toContain("private CV");
    }
  });

  it("stripNulls keeps arrays and drops null keys", () => {
    expect(stripNulls({ a: null, b: [{ c: null, d: 1 }] })).toEqual({ b: [{ d: 1 }] });
  });
});

describe("retry", () => {
  const schema = z.object({ n: z.number() });
  const req = { id: "1", tier: "small" as const, system: "s", user: "u", schema };

  it("feeds validation errors back and succeeds on a retry", async () => {
    let calls = 0;
    const p = new FakeProvider((_r, user) => {
      calls++;
      if (calls === 1) return { n: "x" };
      expect(user).toContain("failed validation");
      return { n: 2 };
    });
    const r = await p.complete(req);
    expect(r.ok && r.data.n).toBe(2);
    expect(r.usage.calls).toBe(2);
  });

  it("stops after two retries and marks the failure", async () => {
    let calls = 0;
    const p = new FakeProvider(() => {
      calls++;
      return { n: "never" };
    });
    const r = await p.complete(req);
    expect(r.ok).toBe(false);
    expect(calls).toBe(3);
    if (!r.ok) expect(r.kind).toBe("validation");
  });
});

describe("mayUseAi", () => {
  const owner = "owner@example.com";

  it("subscription mode serves the owner and synthetic personas only", () => {
    expect(mayUseAi("claude-subscription", owner, { email: "OWNER@example.com", isSynthetic: false }).allowed).toBe(true);
    expect(mayUseAi("claude-subscription", owner, { email: "p@jobtailor.test", isSynthetic: true }).allowed).toBe(true);
    expect(mayUseAi("claude-subscription", owner, { email: "friend@example.com", isSynthetic: false }).allowed).toBe(false);
    expect(mayUseAi("claude-subscription", undefined, { email: "friend@example.com", isSynthetic: false }).allowed).toBe(false);
  });

  it("the API provider serves everyone", () => {
    expect(mayUseAi("anthropic-api", owner, { email: "friend@example.com", isSynthetic: false }).allowed).toBe(true);
  });
});

describe("estimateCost", () => {
  const tokens = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  it("halves for batch and costs unknown models high", () => {
    const base = estimateCost("claude-haiku-5-5", tokens);
    expect(estimateCost("claude-haiku-5-5", tokens, true)).toBeCloseTo(base / 2);
    expect(estimateCost("some-typo", tokens)).toBeGreaterThan(base);
  });
});
