import type { LlmUsage } from "@jobtailor/llm";
import { must, type Db } from "../db";

export class BudgetExceeded extends Error {
  constructor(readonly scope: "global" | "user" | "kill_switch") {
    super(`budget stop: ${scope}`);
  }
}

export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Per-user and global daily caps, enforced before every LLM call. Spend is recorded in
 * `runs` per stage, so a crashed run picks up where its budget left off.
 */
export class Budget {
  private global = 0;
  private perUser = new Map<string, number>();
  private killSwitch = false;

  constructor(
    private readonly db: Db,
    private readonly provider: string,
    private readonly limits: { globalUsd: number; userUsd: number },
    private readonly runDate: string = today(),
  ) {}

  async load(): Promise<void> {
    const rows = must(
      await this.db.from("runs").select("user_id,cost_usd").eq("run_date", this.runDate),
      "load spend",
    ) as { user_id: string | null; cost_usd: number | string }[];
    this.global = 0;
    this.perUser.clear();
    for (const r of rows) {
      const c = Number(r.cost_usd);
      this.global += c;
      if (r.user_id) this.perUser.set(r.user_id, (this.perUser.get(r.user_id) ?? 0) + c);
    }
    const ks = must(await this.db.from("app_settings").select("value").eq("key", "kill_switch").maybeSingle(), "kill switch") as { value: unknown } | null;
    this.killSwitch = ks?.value === true;
  }

  /** Throws if another call could overspend. Shared work passes no user. */
  assertAvailable(userId?: string): void {
    if (this.killSwitch) throw new BudgetExceeded("kill_switch");
    if (this.global >= this.limits.globalUsd) throw new BudgetExceeded("global");
    if (userId && (this.perUser.get(userId) ?? 0) >= this.limits.userUsd) throw new BudgetExceeded("user");
  }

  spent(userId?: string): number {
    return userId ? (this.perUser.get(userId) ?? 0) : this.global;
  }

  add(cost: number, userId?: string): void {
    this.global += cost;
    if (userId) this.perUser.set(userId, (this.perUser.get(userId) ?? 0) + cost);
  }

  /** Records one stage's total usage. */
  async record(
    stage: string,
    usage: LlmUsage,
    status: "ok" | "failed" | "skipped",
    userId: string | null = null,
    error: string | null = null,
  ): Promise<void> {
    must(
      await this.db.from("runs").insert({
        run_date: this.runDate,
        user_id: userId,
        stage,
        status,
        tokens_in: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
        tokens_out: usage.outputTokens,
        cost_usd: usage.costUsd,
        calls: usage.calls,
        provider: this.provider,
        error,
        finished_at: new Date().toISOString(),
      }),
      "record run",
    );
  }
}
