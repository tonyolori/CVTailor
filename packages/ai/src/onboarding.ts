import { experienceYears, isAboveLevel, PreferencesSchema, type FactLibrary, type Preferences } from "@cvtailor/core";
import {
  LIBRARY_ASSIST_SYSTEM,
  LibraryAssistSchema,
  libraryAssistUserPrompt,
  preferencesAssistSchema,
  preferencesAssistSystem,
  preferencesAssistUserPrompt,
  type LibraryAssist,
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

/**
 * Titles and search topics from the whole library. Anything above the person's level is dropped
 * here too, in case the model ignores the rule.
 */
export async function suggestTitles(
  deps: OnboardingDeps,
  userId: string,
  input: { categories: { id: string; label: string }[]; targetTitles: string[]; facts: FactLibrary | null },
): Promise<LlmResult<TitleSuggestions>> {
  const years = input.facts ? experienceYears(input.facts) : null;
  const r = await charged(deps, userId, {
    id: "titles",
    tier: "small",
    effort: "low",
    system: suggestTitlesSystem(input.categories),
    user: suggestTitlesUserPrompt(input.targetTitles, input.facts, years),
    schema: TitleSuggestionsSchema,
  });
  if (!r.ok || !input.facts) return r;
  const lib = input.facts;
  const keep = (titles: string[]) => titles.filter((t) => !isAboveLevel(t, lib, input.targetTitles));
  return { ...r, data: { ...r.data, a: keep(r.data.a), b: keep(r.data.b), c: keep(r.data.c) } };
}

export const MAX_INSTRUCTION_CHARS = 4000;

/**
 * The CV-setup prompt box: applies the person's instruction to their library and returns a
 * proposal to review. Contact details always come back as they went in.
 */
export async function assistLibrary(deps: OnboardingDeps, userId: string, input: { instruction: string; library: FactLibrary }): Promise<LlmResult<LibraryAssist>> {
  const r = await charged(deps, userId, {
    id: "library-assist",
    tier: "strong",
    effort: "low",
    system: LIBRARY_ASSIST_SYSTEM,
    user: libraryAssistUserPrompt(input.instruction.slice(0, MAX_INSTRUCTION_CHARS), input.library),
    schema: LibraryAssistSchema,
  });
  if (!r.ok) return r;
  return { ...r, data: { ...r.data, library: { ...r.data.library, contact: input.library.contact } } };
}

/** The preferences prompt box: applies the person's instruction and returns proposed preferences to review. */
export async function assistPreferences(
  deps: OnboardingDeps,
  userId: string,
  input: { instruction: string; preferences: Preferences; facts: FactLibrary | null; categories: { id: string; label: string }[] },
): Promise<LlmResult<{ preferences: Preferences; changes: string[] }>> {
  const r = await charged(deps, userId, {
    id: "preferences-assist",
    tier: "small",
    effort: "medium",
    system: preferencesAssistSystem(input.categories),
    user: preferencesAssistUserPrompt(input.instruction.slice(0, MAX_INSTRUCTION_CHARS), input.preferences, input.facts),
    schema: preferencesAssistSchema(),
  });
  if (!r.ok) return r;
  // Unknown category ids would silently filter everything out, so they're dropped.
  const known = new Set(input.categories.map((c) => c.id));
  const preferences = PreferencesSchema.parse({ ...r.data.preferences, categories: r.data.preferences.categories.filter((c) => known.has(c)) });
  return { ...r, data: { preferences, changes: r.data.changes } };
}
