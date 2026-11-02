import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { withValidationRetry, type RawAttempt } from "./retry";
import { toStrictJsonSchema, validateReply } from "./schema";
import { ZERO_USAGE, type LlmConfig, type LlmProvider, type LlmRequest, type LlmResult, type LlmUsage } from "./types";

/** Empty, so the agent can't discover project files, CLAUDE.md, hooks or MCP config. */
const EMPTY_CWD = mkdtempSync(join(tmpdir(), "jobtailor-llm-"));

/**
 * Runs through the Claude Agent SDK on the machine owner's Claude login, with no API key.
 *
 * Anthropic's terms allow this for the plan holder's own use, not for routing requests on
 * behalf of other users, so the worker gates it with `mayUseAi`. Usage draws on the plan's
 * normal limits, and costUsd here is the SDK's estimate, not a charge.
 * https://code.claude.com/docs/en/legal-and-compliance
 */
export class SubscriptionProvider implements LlmProvider {
  readonly name = "claude-subscription" as const;

  constructor(private readonly config: LlmConfig) {}

  complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    return withValidationRetry(req, (user) => this.attempt(req, user));
  }

  /** Plan limits are shared with the owner's own use, so requests run one at a time. */
  async completeMany<T>(reqs: LlmRequest<T>[]): Promise<Map<string, LlmResult<T>>> {
    const results = new Map<string, LlmResult<T>>();
    for (const req of reqs) {
      const r = await this.complete(req);
      results.set(req.id, r);
      if (!r.ok && (r.kind === "rate_limit" || r.kind === "auth")) {
        for (const rest of reqs) {
          if (!results.has(rest.id)) {
            results.set(rest.id, { ok: false, kind: r.kind, error: r.error, usage: ZERO_USAGE });
          }
        }
        break;
      }
    }
    return results;
  }

  private async attempt<T>(req: LlmRequest<T>, user: string): Promise<RawAttempt<T>> {
    const { schema } = toStrictJsonSchema(req.schema);
    const system = req.cachedContext ? `${req.system}\n\n${req.cachedContext}` : req.system;
    let usage: LlmUsage = ZERO_USAGE;
    let output: unknown;
    let failure: { kind: "refusal" | "rate_limit" | "auth" | "other"; error: string } | undefined;

    try {
      for await (const message of query({
        // The fixed prefix keeps posting text from ever being read as a leading slash command.
        prompt: `Input data follows.\n\n${user}`,
        options: {
          model: req.tier === "small" ? this.config.modelSmall : this.config.modelStrong,
          systemPrompt: system,
          // No tools at all: postings are untrusted data. Structured output adds only its own tool.
          tools: [],
          allowedTools: [],
          permissionMode: "dontAsk",
          settingSources: [],
          skills: [],
          strictMcpConfig: true,
          mcpServers: {},
          persistSession: false,
          maxTurns: 4,
          cwd: EMPTY_CWD,
          effort: req.effort ?? "low",
          outputFormat: { type: "json_schema", schema },
          // Without this, an exported key would silently replace the login and bill the API.
          env: { ...process.env, ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined },
        },
      })) {
        if (message.type !== "result") continue;
        const u = message.usage;
        usage = {
          inputTokens: u?.input_tokens ?? 0,
          outputTokens: u?.output_tokens ?? 0,
          cacheReadTokens: u?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
          costUsd: message.total_cost_usd ?? 0,
          calls: 1,
        };
        if (message.subtype === "success" && !message.is_error && message.structured_output !== undefined) {
          output = message.structured_output;
        } else {
          failure = classify(message.subtype === "success" ? message.result : (message.errors ?? []).join("; "));
        }
      }
    } catch (err) {
      // query() throws after yielding an error result, so keep the classification already made.
      failure ??= classify(err instanceof Error ? err.message : String(err));
    }

    if (output === undefined) {
      const f = failure ?? { kind: "other" as const, error: "no structured output" };
      return { ok: false, kind: f.kind, error: f.error, usage };
    }
    const v = validateReply(req.schema, output);
    if (v.ok) return { ok: true, data: v.data, usage };
    return { ok: false, kind: "validation", error: v.error, forModel: v.forModel, usage };
  }
}

/** Errors from the SDK can quote the prompt, so only a fixed category leaves this function. */
function classify(message: string): { kind: "refusal" | "rate_limit" | "auth" | "other"; error: string } {
  const m = message.toLowerCase();
  if (/rate.?limit|usage limit|limit reached|429|overloaded/.test(m)) {
    return { kind: "rate_limit", error: "plan usage limit or rate limit reached" };
  }
  if (/not logged in|authentication|invalid api key|please run \/login|unauthorized|401/.test(m)) {
    return { kind: "auth", error: "Claude login missing or expired; run npm run claude:login" };
  }
  if (/refus|declin/.test(m)) return { kind: "refusal", error: "model declined the request" };
  return { kind: "other", error: "Claude Agent SDK run failed" };
}
