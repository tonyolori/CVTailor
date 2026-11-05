import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { webProvider } from "./ai";

const MODELS = { LLM_MODEL_SMALL: "deepseek-flash", LLM_MODEL_STRONG: "deepseek-v4-pro" };

function withEnv(vars: Record<string, string>) {
  for (const key of ["LLM_PROVIDER", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"]) vi.stubEnv(key, "");
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
}

afterEach(() => vi.unstubAllEnvs());

describe("webProvider", () => {
  it("runs DeepSeek inline when it's the provider and the key is set", () => {
    withEnv({ ...MODELS, LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "k" });
    expect(webProvider()?.name).toBe("deepseek");
  });

  it("queues for the worker when DeepSeek has no key on this host", () => {
    withEnv({ ...MODELS, LLM_PROVIDER: "deepseek" });
    expect(webProvider()).toBeNull();
  });

  it("doesn't use an Anthropic key while DeepSeek is the provider", () => {
    withEnv({ ...MODELS, LLM_PROVIDER: "deepseek", ANTHROPIC_API_KEY: "k" });
    expect(webProvider()).toBeNull();
  });

  it("still runs the Anthropic API inline", () => {
    withEnv({ LLM_PROVIDER: "anthropic-api", ANTHROPIC_API_KEY: "k" });
    expect(webProvider()?.name).toBe("anthropic-api");
  });

  it("has no AI of its own in subscription mode", () => {
    withEnv({ LLM_PROVIDER: "claude-subscription", ANTHROPIC_API_KEY: "k", DEEPSEEK_API_KEY: "k" });
    expect(webProvider()).toBeNull();
  });
});
