import type { FactLibrary } from "@cvtailor/core";
import {
  EXTRACT_FACTS_SYSTEM,
  extractFactsUserPrompt,
  ProposedLibrarySchema,
  suggestTitlesSystem,
  suggestTitlesUserPrompt,
  TitleSuggestionsSchema,
  type TitleSuggestions,
} from "@cvtailor/core/prompts";
import type { LlmProvider, LlmRequest, LlmResult } from "@cvtailor/llm";
import type { Budget } from "./budget";

export interface OnboardingDeps {
  provider: LlmProvider;
  budget: Budget;
}

const MAX_CV_CHARS = 60_000;

/** One call, checked against the person's budget first and recorded against them after. Throws BudgetExceeded. */
async function charged<T>(deps: OnboardingDeps, userId: string, req: LlmRequest<T>): Promise<LlmResult<T>> {
  deps.budget.assertAvailable(userId);
  const r = await deps.provider.complete(req);
  deps.budget.add(r.usage.costUsd, userId);
  await deps.budget.record("onboarding", r.usage, r.ok ? "ok" : "failed", userId, r.ok ? null : r.kind);
  return r;
}

/** Proposes a library from an uploaded CV's text. Nothing is saved until the person has reviewed it. */
export function extractFacts(deps: OnboardingDeps, userId: string, email: string, cvText: string) {
  return charged(deps, userId, {
    id: "extract",
    tier: "strong",
    effort: "low",
    system: EXTRACT_FACTS_SYSTEM,
    user: extractFactsUserPrompt(cvText.slice(0, MAX_CV_CHARS), email),
    schema: ProposedLibrarySchema,
  });
}

export function suggestTitles(
  deps: OnboardingDeps,
  userId: string,
  input: { categories: { id: string; label: string }[]; targetTitles: string[]; facts: FactLibrary | null },
): Promise<LlmResult<TitleSuggestions>> {
  return charged(deps, userId, {
    id: "titles",
    tier: "small",
    effort: "low",
    system: suggestTitlesSystem(input.categories),
    user: suggestTitlesUserPrompt(input.targetTitles, input.facts),
    schema: TitleSuggestionsSchema,
  });
}
