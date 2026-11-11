import { describe, expect, it } from "vitest";
import { EnrichedJobSchema, remoteAccountantPersona, remoteSoftwarePersona } from "@cvtailor/core";
import { COVER_LETTER_SYSTEM, libraryContext, SCORE_SYSTEM, TAILOR_SYSTEM } from "@cvtailor/core/prompts";
import { totalScore, MISSING_CREDENTIAL_PENALTY, rank, rankNearMisses, refineCandidates } from "../src/pipeline/match";
import { enrichPriority } from "../src/pipeline/enrich";

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

describe("two-stage scoring", () => {
  const e = EnrichedJobSchema.parse({ isOpen: true, workMode: "remote", postedAt: "2026-10-01" });
  const s = (score: number, refined = false) => ({ score, refined, enriched: e });

  it("refines the best first-pass scores within reach of the bar, once", () => {
    const items = [s(4), s(5), s(9), s(6, true), s(7)];
    expect(refineCandidates(items, 7, 2).map((x) => x.score)).toEqual([9, 7]);
    expect(refineCandidates(items, 7, 10).map((x) => x.score)).toEqual([9, 7, 5]);
    expect(refineCandidates(items, 7, 0)).toEqual([]);
  });
});

describe("enrichment order", () => {
  const prefs = remoteSoftwarePersona.preferences;
  it("puts main titles first, then worldwide labels and employers' own boards", () => {
    const main = enrichPriority({ title: prefs.targetTitles[0]!, location_text: "Remote", from_ats: false }, [prefs]);
    const other = enrichPriority({ title: "Barista", location_text: "Worldwide", from_ats: true }, [prefs]);
    const mainWorldwide = enrichPriority({ title: prefs.targetTitles[0]!, location_text: "Worldwide", from_ats: false }, [prefs]);
    expect(main).toBeLessThan(other);
    expect(mainWorldwide).toBeLessThan(main);
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

describe("missed days", () => {
  it("lists days with no run since the first one, up to yesterday", async () => {
    const { missedDays } = await import("../src/pipeline/schedule");
    expect(missedDays(["2026-11-06"], "2026-11-11")).toEqual(["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"]);
    expect(missedDays(["2026-11-06", "2026-11-08"], "2026-11-09")).toEqual(["2026-11-07"]);
    expect(missedDays([], "2026-11-11")).toEqual([]);
  });
});
