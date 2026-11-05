import "server-only";
import { ApiProvider } from "@cvtailor/llm/api";
import { withLogging } from "@cvtailor/llm/logging";
import type { LlmProvider } from "@cvtailor/llm";
import { log } from "./log";

/**
 * AI on the web host only exists with an API key. A personal Claude login can't run here:
 * without a key, onboarding's AI steps are queued for the worker, and manual entry always works.
 */
export function webProvider(): LlmProvider | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || process.env.LLM_PROVIDER !== "anthropic-api") return null;
  return withLogging(
    new ApiProvider({
      provider: "anthropic-api",
      apiKey,
      modelSmall: process.env.LLM_MODEL_SMALL ?? "",
      modelStrong: process.env.LLM_MODEL_STRONG ?? "",
    }),
    log,
  );
}
