import "server-only";
import { Budget } from "@cvtailor/ai/budget";
import { ApiProvider } from "@cvtailor/llm/api";
import { DeepSeekProvider } from "@cvtailor/llm/deepseek";
import { withLogging } from "@cvtailor/llm/logging";
import type { LlmProvider } from "@cvtailor/llm";
import { log } from "./log";
import { adminClient } from "./supabase/admin";

function inlineProvider(): LlmProvider | null {
  const models = { modelSmall: process.env.LLM_MODEL_SMALL ?? "", modelStrong: process.env.LLM_MODEL_STRONG ?? "" };
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey && process.env.LLM_PROVIDER === "anthropic-api") return new ApiProvider({ provider: "anthropic-api", apiKey: anthropicKey, ...models });
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey && process.env.LLM_PROVIDER === "deepseek") return new DeepSeekProvider({ provider: "deepseek", apiKey: deepseekKey, ...models });
  return null;
}

/**
 * The AI that writes CVs and reads uploads, which runs here as people ask. It needs an API key:
 * a personal Claude login can't serve other people. Without one, those steps are unavailable
 * and people fill in their details by hand.
 */
export function webProvider(): LlmProvider | null {
  const provider = inlineProvider();
  return provider && withLogging(provider, log);
}

const positive = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? n : fallback;
};

/** The worker's daily caps. Spend from both is recorded in `runs`, so they share one budget. */
export function budgetLimits(): { globalUsd: number; userUsd: number } {
  return { globalUsd: positive(process.env.GLOBAL_DAILY_BUDGET_USD, 5), userUsd: positive(process.env.USER_DAILY_BUDGET_USD, 0.5) };
}

/** Today's budget, with what's already been spent, ready for one request's calls. */
export async function webBudget(provider: LlmProvider): Promise<Budget> {
  const budget = new Budget(adminClient(), provider.name, budgetLimits());
  await budget.load();
  return budget;
}

export const AI_UNAVAILABLE = "That isn't available right now. You can enter your details by hand.";
