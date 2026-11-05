import { describe, expect, it } from "vitest";
import { EnrichedJobSchema, remoteAccountantPersona, remoteSoftwarePersona } from "@cvtailor/core";
import { COVER_LETTER_SYSTEM, libraryContext, SCORE_SYSTEM, TAILOR_SYSTEM } from "@cvtailor/core/prompts";
import { totalScore, MISSING_CREDENTIAL_PENALTY, rank, rankNearMisses } from "../src/pipeline/match";

describe("scoring helpers", () => {
  it("applies the credential penalty only when one is missing", () => {
    expect(totalScore({ roleMatch: 5, libraryFit: 4 }, [])).toBe(9);
    expect(totalScore({ roleMatch: 5, libraryFit: 4 }, ["CPA"])).toBe(9 - MISSING_CREDENTIAL_PENALTY);
    expect(totalScore({ roleMatch: 1, libraryFit: 1 }, ["CPA"])).toBe(0);
  });

  const item = (score: number, postedAt: string, over = {}) => ({
    score,
    enriched: EnrichedJobSchema.parse({ isOpen: true, workMode: "remote", postedAt, ...over }),
  });

  it("ranks by score, then recency", () => {
    const r = rank([item(7, "2026-10-01"), item(9, "2026-10-01"), item(7, "2026-10-20")]);
    expect(r.map((x) => [x.score, x.enriched.postedAt])).toEqual([
      [9, "2026-10-01"],
      [7, "2026-10-20"],
      [7, "2026-10-01"],
    ]);
  });

  it("near-miss order follows the user's preferred regions, and score otherwise", () => {
    const eu = item(8, "2026-10-01", { eligibleCountries: ["DE"] });
    const us = item(9, "2026-10-01", { eligibleCountries: ["US"] });
    const prefers = { ...remoteSoftwarePersona.preferences, worthALookPreferRegions: ["EU" as const] };
    expect(rankNearMisses([us, eu], prefers)[0]).toBe(eu);
    expect(rankNearMisses([eu, us], remoteSoftwarePersona.preferences)[0]).toBe(us);
  });
});

describe("prompts", () => {
  const all = [TAILOR_SYSTEM, COVER_LETTER_SYSTEM, SCORE_SYSTEM];

  it("treat postings as untrusted", () => {
    for (const p of all) expect(p).toContain("untrusted data");
  });

  it("assume no profession, work mode or country", () => {
    for (const p of all) {
      for (const word of [/software/i, /nigeria/i, /\bAI engineer/i, /\bLLM\b/, /\bMCP\b/, /stanbic/i, /tenece/i, /\bremote\b/i, /python/i]) {
        expect(p).not.toMatch(word);
      }
    }
  });

  it("the library context holds one user's data only", () => {
    const ctx = libraryContext(remoteAccountantPersona.facts);
    expect(ctx).toContain("Marta Exemplo");
    expect(ctx).not.toContain("Grace Sampleton");
  });
});
