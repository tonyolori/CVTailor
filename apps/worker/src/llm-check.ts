import { z } from "zod";
import { createProvider } from "@jobtailor/llm";
import { loadConfig, llmConfig } from "./config";

/** One cheap call through the configured provider, to prove the login or key works. */
const config = loadConfig();
const provider = await createProvider(llmConfig(config));
const started = Date.now();
const r = await provider.complete({
  id: "llm-check",
  tier: "small",
  system: "You classify words. Reply using the requested structure.",
  user: 'Is "nurse" an occupation?',
  schema: z.object({ isOccupation: z.boolean() }),
  maxTokens: 200,
});
if (!r.ok) {
  console.error(`${provider.name}: failed (${r.kind}): ${r.error}`);
  process.exit(1);
}
console.log(
  `${provider.name}: ok in ${Date.now() - started}ms, reply=${JSON.stringify(r.data)}, ` +
    `tokens in/out=${r.usage.inputTokens}/${r.usage.outputTokens}, est cost=$${r.usage.costUsd.toFixed(5)}, calls=${r.usage.calls}`,
);
