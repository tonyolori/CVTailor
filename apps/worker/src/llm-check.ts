import { z } from "zod";
import { createProvider } from "@jobtailor/llm";
import { loadConfig, llmConfig } from "./config";

/** One cheap call per model tier through the configured provider, to prove the login or key works. */
const config = loadConfig();
const provider = await createProvider(llmConfig(config));
for (const [tier, model] of [
  ["small", config.LLM_MODEL_SMALL],
  ["strong", config.LLM_MODEL_STRONG],
] as const) {
  const started = Date.now();
  const r = await provider.complete({
    id: `llm-check-${tier}`,
    tier,
    system: "You classify words. Reply using the requested structure.",
    user: 'Is "nurse" an occupation?',
    schema: z.object({ isOccupation: z.boolean() }),
    maxTokens: 200,
  });
  if (!r.ok) {
    console.error(`${provider.name} ${tier} (${model}): failed (${r.kind}): ${r.error}`);
    process.exit(1);
  }
  console.log(
    `${provider.name} ${tier} (${model}): ok in ${Date.now() - started}ms, reply=${JSON.stringify(r.data)}, ` +
      `tokens in/out=${r.usage.inputTokens}/${r.usage.outputTokens}, est cost=$${r.usage.costUsd.toFixed(5)}, calls=${r.usage.calls}`,
  );
}
