import { z } from "zod";
import { DEFAULT_CV_REQUESTS_PER_DAY } from "@jobtailor/core";
import type { LlmConfig } from "@jobtailor/llm";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const ConfigSchema = z.object({
  SUPABASE_URL: z.string().url().default("http://127.0.0.1:54321"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  SUPABASE_ANON_KEY: z.string().default(""),

  LLM_PROVIDER: z.enum(["claude-subscription", "anthropic-api", "fake"]).default("claude-subscription"),
  OWNER_EMAIL: optional,
  ANTHROPIC_API_KEY: optional,
  LLM_MODEL_SMALL: z.string().min(1),
  LLM_MODEL_STRONG: z.string().min(1),

  GLOBAL_DAILY_BUDGET_USD: z.coerce.number().positive().default(5),
  USER_DAILY_BUDGET_USD: z.coerce.number().positive().default(0.5),
  /** Most postings enriched per run. The rest wait for the next run. */
  ENRICH_MAX_PER_RUN: z.coerce.number().int().positive().default(300),

  /** The run starts from this hour. A later start catches up on a missed day. */
  RUN_START_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(1),
  RUN_ALERT_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(6),
  BILLING_ENFORCED: bool.default(false),
  /** CVs one person can ask for per UTC day, on top of their daily picks. Each one costs money to write. */
  CV_REQUESTS_PER_DAY: z.coerce.number().int().min(0).default(DEFAULT_CV_REQUESTS_PER_DAY),
  /** Comma-separated ids of sources with unverified terms that Tony has chosen to enable. */
  ENABLED_UNVERIFIED_SOURCES: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),

  EMAIL_PROVIDER: z.enum(["resend", "file"]).default("file"),
  EMAIL_API_KEY: optional,
  EMAIL_FROM: z.string().default("JobTailor <hello@example.com>"),
  SITE_URL: z.string().url().default("http://127.0.0.1:3000"),
});

export type Config = z.infer<typeof ConfigSchema>;

/** All worker config comes from env, so the Docker image is stateless. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse(env);
}

export function llmConfig(c: Config): LlmConfig {
  return {
    provider: c.LLM_PROVIDER,
    modelSmall: c.LLM_MODEL_SMALL,
    modelStrong: c.LLM_MODEL_STRONG,
    apiKey: c.ANTHROPIC_API_KEY,
  };
}
