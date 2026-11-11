import { describe, expect, it } from "vitest";
import { onsiteNursePersona, remoteAccountantPersona } from "@cvtailor/core";
import { FakeProvider, type LlmUsage } from "@cvtailor/llm";
import { BudgetExceeded, type Budget } from "./budget";
import { assistLibrary, assistPreferences, extractFacts, suggestTitles } from "./onboarding";

/** Records what the budget is told, and can be set to refuse. */
function budget(refuse = false) {
  const added: { cost: number; userId?: string }[] = [];
  const recorded: { stage: string; status: string; userId: string | null; calls: number }[] = [];
  const b = {
    assertAvailable: () => {
      if (refuse) throw new BudgetExceeded("user");
    },
    add: (cost: number, userId?: string) => added.push({ cost, userId }),
    record: async (stage: string, usage: LlmUsage, status: string, userId: string | null = null) => {
      recorded.push({ stage, status, userId, calls: usage.calls });
    },
  };
  return { b: b as unknown as Budget, added, recorded };
}

const proposed = { ...onsiteNursePersona.facts };
const titles = { a: ["Charge Nurse"], b: ["Clinical Nurse Specialist"], c: [], categories: ["nursing-healthcare"] };

describe("extractFacts", () => {
  it("proposes a library and charges it to the person", async () => {
    const { b, added, recorded } = budget();
    const provider = new FakeProvider(() => proposed);
    const r = await extractFacts({ provider, budget: b }, "u1", "grace@example.com", "My CV text");
    expect(r.ok).toBe(true);
    expect(provider.requests[0]?.tier).toBe("strong");
    expect(added).toEqual([{ cost: 0.001, userId: "u1" }]);
    expect(recorded).toEqual([{ stage: "onboarding", status: "ok", userId: "u1", calls: 1 }]);
  });

  it("asks nothing of the model once the budget is spent", async () => {
    const { b } = budget(true);
    const provider = new FakeProvider(() => proposed);
    await expect(extractFacts({ provider, budget: b }, "u1", "grace@example.com", "My CV text")).rejects.toBeInstanceOf(BudgetExceeded);
    expect(provider.requests).toEqual([]);
  });

  it("records a failure too, so its cost still counts", async () => {
    const { b, recorded } = budget();
    const provider = new FakeProvider(() => ({ nonsense: true }));
    const r = await extractFacts({ provider, budget: b }, "u1", "grace@example.com", "My CV text");
    expect(r.ok).toBe(false);
    expect(recorded[0]).toMatchObject({ stage: "onboarding", status: "failed", calls: 3 });
  });

  it("sends at most the first 60,000 characters", async () => {
    const { b } = budget();
    const provider = new FakeProvider(() => proposed);
    await extractFacts({ provider, budget: b }, "u1", "grace@example.com", "x".repeat(70_000));
    expect(provider.requests[0]?.user.length).toBeLessThan(62_000);
  });
});

describe("suggestTitles", () => {
  it("uses the cheap tier and charges it to the person", async () => {
    const { b, recorded } = budget();
    const provider = new FakeProvider(() => titles);
    const r = await suggestTitles({ provider, budget: b }, "u1", { categories: [{ id: "nursing-healthcare", label: "Nursing" }], targetTitles: ["Staff Nurse"], facts: null });
    expect(r.ok && r.data.a).toEqual(["Charge Nurse"]);
    expect(provider.requests[0]?.tier).toBe("small");
    expect(recorded).toEqual([{ stage: "onboarding", status: "ok", userId: "u1", calls: 1 }]);
  });

  it("asks nothing of the model once the budget is spent", async () => {
    const { b } = budget(true);
    const provider = new FakeProvider(() => titles);
    await expect(suggestTitles({ provider, budget: b }, "u1", { categories: [], targetTitles: ["Staff Nurse"], facts: null })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(provider.requests).toEqual([]);
  });
});

describe("suggestTitles with a library", () => {
  it("sends the whole experience and drops titles above the person's level", async () => {
    const { b } = budget();
    const lib = remoteAccountantPersona.facts;
    const provider = new FakeProvider(() => ({ a: ["Senior Accountant", "Finance Director"], b: ["Head of Finance"], c: [], categories: [], searchTopics: ["IFRS"] }));
    const r = await suggestTitles({ provider, budget: b }, "u1", { categories: [], targetTitles: ["Accountant"], facts: lib });
    const firstFact = lib.entries.find((e) => e.facts.length > 0)?.facts[0]?.text ?? "";
    expect(provider.requests[0]?.user).toContain(firstFact);
    expect(provider.requests[0]?.user).not.toContain(lib.contact.email);
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.searchTopics).toEqual(["IFRS"]);
    const all = [...r.data.a, ...r.data.b, ...r.data.c];
    for (const t of all) expect(t).not.toMatch(/director|head of/i);
  });
});

describe("assistLibrary", () => {
  it("returns a proposal, keeping the person's contact details", async () => {
    const { b, recorded } = budget();
    const lib = onsiteNursePersona.facts;
    const provider = new FakeProvider(() => ({ library: { ...lib, contact: { name: "Someone Else", email: "x@example.com", links: [] } }, changes: ["Tidied dates"] }));
    const r = await assistLibrary({ provider, budget: b }, "u1", { instruction: "Tidy my dates", library: lib });
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.library.contact).toEqual(lib.contact);
    expect(r.data.changes).toEqual(["Tidied dates"]);
    expect(provider.requests[0]?.tier).toBe("strong");
    expect(recorded).toEqual([{ stage: "onboarding", status: "ok", userId: "u1", calls: 1 }]);
  });
});

describe("assistPreferences", () => {
  it("returns valid preferences and drops unknown categories", async () => {
    const { b } = budget();
    const prefs = onsiteNursePersona.preferences;
    const provider = new FakeProvider(() => ({ preferences: { ...prefs, categories: ["nursing-healthcare", "made-up"], targetTitles: ["Charge Nurse"] }, changes: ["Changed your main title"] }));
    const r = await assistPreferences({ provider, budget: b }, "u1", {
      instruction: "Search for charge nurse roles",
      preferences: prefs,
      facts: null,
      categories: [{ id: "nursing-healthcare", label: "Nursing" }],
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.preferences.targetTitles).toEqual(["Charge Nurse"]);
    expect(r.data.preferences.categories).toEqual(["nursing-healthcare"]);
  });
});
