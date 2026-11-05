import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { budgetLimits, webProvider } from "./ai";

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

  it("has no AI when DeepSeek has no key on this host", () => {
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

describe("budgetLimits", () => {
  it("uses the same daily caps as the worker, so both count against one budget", () => {
    vi.stubEnv("GLOBAL_DAILY_BUDGET_USD", "3");
    vi.stubEnv("USER_DAILY_BUDGET_USD", "0.25");
    expect(budgetLimits()).toEqual({ globalUsd: 3, userUsd: 0.25 });
  });

  it("falls back to the worker's defaults when unset or not a positive number", () => {
    vi.stubEnv("GLOBAL_DAILY_BUDGET_USD", "");
    vi.stubEnv("USER_DAILY_BUDGET_USD", "-1");
    expect(budgetLimits()).toEqual({ globalUsd: 5, userUsd: 0.5 });
  });
});
