import { ApiProvider } from "./api";
import { DeepSeekProvider } from "./deepseek";
import type { LlmConfig, LlmProvider } from "./types";

export * from "./types";
export { ApiProvider, estimateCost } from "./api";
export { DeepSeekProvider, estimateDeepSeekCost } from "./deepseek";
export { FakeProvider, type FakeHandler } from "./fake";
export { withLogging } from "./logging";
export { toPromptJsonSchema, toStrictJsonSchema, validateReply, stripNulls } from "./schema";

/** Loaded dynamically so a web bundle never pulls in the Agent SDK and its native binary. */
export async function createProvider(config: LlmConfig): Promise<LlmProvider> {
  switch (config.provider) {
    case "anthropic-api":
      if (!config.apiKey) throw new Error("LLM_PROVIDER=anthropic-api needs ANTHROPIC_API_KEY");
      return new ApiProvider(config);
    case "deepseek":
      if (!config.apiKey) throw new Error("LLM_PROVIDER=deepseek needs DEEPSEEK_API_KEY");
      return new DeepSeekProvider(config);
    case "claude-subscription": {
      const { SubscriptionProvider } = await import("./subscription");
      return new SubscriptionProvider(config);
    }
    case "fake":
      throw new Error("Construct FakeProvider directly in tests");
  }
}

export interface AiAccessUser {
  email: string;
  isSynthetic: boolean;
}

/**
 * Whether AI stages may run for a user under the configured provider.
 *
 * Anthropic does not permit routing requests through a Free, Pro, Max or Ultra plan on
 * behalf of other users, so subscription mode serves only the plan holder and invented
 * test personas. Everyone else needs an API key. Deliberately has no override.
 * https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use
 */
export function mayUseAi(
  provider: LlmProvider["name"],
  ownerEmail: string | undefined,
  user: AiAccessUser,
): { allowed: true } | { allowed: false; reason: string } {
  if (provider !== "claude-subscription") return { allowed: true };
  if (user.isSynthetic) return { allowed: true };
  if (ownerEmail && user.email.trim().toLowerCase() === ownerEmail.trim().toLowerCase()) return { allowed: true };
  return {
    allowed: false,
    reason: "AI stages need an API key for this account. Subscription mode only serves the owner and test personas.",
  };
}
