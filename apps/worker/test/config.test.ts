import { describe, expect, it } from "vitest";
import { llmConfig, loadConfig } from "../src/config";

const env = { LLM_MODEL_SMALL: "small", LLM_MODEL_STRONG: "strong", ANTHROPIC_API_KEY: "anthropic-key", DEEPSEEK_API_KEY: "deepseek-key" };

describe("llmConfig", () => {
  it("gives DeepSeek its own key", () => {
    const c = llmConfig(loadConfig({ ...env, LLM_PROVIDER: "deepseek" }));
    expect(c.provider).toBe("deepseek");
    expect(c.apiKey).toBe("deepseek-key");
  });

  it("gives the Anthropic API its own key", () => {
    expect(llmConfig(loadConfig({ ...env, LLM_PROVIDER: "anthropic-api" })).apiKey).toBe("anthropic-key");
  });
});
