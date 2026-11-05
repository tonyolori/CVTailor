import { describe, expect, it } from "vitest";
import { onsiteNursePersona } from "@cvtailor/core";
import { FakeProvider, type LlmUsage } from "@cvtailor/llm";
import { BudgetExceeded, type Budget } from "./budget";
import { extractFacts, suggestTitles } from "./onboarding";

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
