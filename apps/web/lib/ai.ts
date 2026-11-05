import "server-only";
import { ApiProvider } from "@cvtailor/llm/api";
import { DeepSeekProvider } from "@cvtailor/llm/deepseek";
import { withLogging } from "@cvtailor/llm/logging";
import type { LlmProvider } from "@cvtailor/llm";
import { log } from "./log";

function inlineProvider(): LlmProvider | null {
  const models = { modelSmall: process.env.LLM_MODEL_SMALL ?? "", modelStrong: process.env.LLM_MODEL_STRONG ?? "" };
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey && process.env.LLM_PROVIDER === "anthropic-api") return new ApiProvider({ provider: "anthropic-api", apiKey: anthropicKey, ...models });
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey && process.env.LLM_PROVIDER === "deepseek") return new DeepSeekProvider({ provider: "deepseek", apiKey: deepseekKey, ...models });
  return null;
}

/**
 * AI on the web host only exists with an API key. A personal Claude login can't run here:
 * without a key, onboarding's AI steps are queued for the worker, and manual entry always works.
 */
export function webProvider(): LlmProvider | null {
  const provider = inlineProvider();
  return provider && withLogging(provider, log);
}
