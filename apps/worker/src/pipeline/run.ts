import { topicsFromLibrary, type Category } from "@cvtailor/core";
import { addUsage, mayUseAi, ZERO_USAGE, type LlmProvider } from "@cvtailor/llm";
import type { Config } from "../config";
import { errorInfo, must, type Db } from "../db";
import type { EmailSender } from "../email/send";
import { log } from "../log";
import { AGGREGATORS } from "../sources/aggregators";
import { atsBoards, type CompanyRow } from "../sources/ats";
import type { Http } from "../sources/http";
import { coverageGaps, fallbackQueries, primaryQueries, type RegistryOptions } from "../sources/registry";
import { Budget, today } from "@cvtailor/ai/budget";
import { collect, type CollectResult } from "./collect";
import { sendDueEmails } from "./deliver";
import { runDiscovery } from "./discovery";
import { enrichPending } from "./enrich";
import { matchUser, type MatchResult } from "./match";
import { decideRun, missedDays, MISSED_LOOKBACK_DAYS, sendAtFor, shouldAlert } from "./schedule";
import { buildSummary } from "./summary";
import { loadActiveUsers, type ActiveUser } from "@cvtailor/ai/users";

export interface RunDeps {
  db: Db;
  http: Http;
  provider: LlmProvider;
  sender: EmailSender;
  config: Pick<
    Config,
    | "OWNER_EMAIL"
    | "GLOBAL_DAILY_BUDGET_USD"
    | "USER_DAILY_BUDGET_USD"
    | "ENRICH_MAX_PER_RUN"
    | "BILLING_ENFORCED"
    | "ENABLED_UNVERIFIED_SOURCES"
    | "RUN_START_HOUR_UTC"
    | "RUN_ALERT_HOUR_UTC"
    | "EMAIL_FROM"
    | "SITE_URL"
  >;
  now?: () => Date;
}

const ADAPTER_LABELS = [...AGGREGATORS.map((a) => ({ id: a.id, label: a.label })), ...["greenhouse", "lever", "ashby", "workable", "breezy", "recruitee"].map((id) => ({ id, label: atsBoards.label }))];

/**
 * One day's pipeline: collect -> enrich -> match -> verify live -> queue email. CVs aren't written
 * here: each one waits until someone asks for it, which is what keeps costs down. Every stage is idempotent, so re-running after a crash resumes it.
 */
export async function runDaily(deps: RunDeps, runDate: string): Promise<{ users: number; picked: number; failedUsers: number }> {
  const { db, http, provider, config } = deps;
  const now = deps.now?.() ?? new Date();
  const budget = new Budget(db, provider.name, { globalUsd: config.GLOBAL_DAILY_BUDGET_USD, userUsd: config.USER_DAILY_BUDGET_USD }, runDate);
  await budget.load();

  const users = await loadActiveUsers(db);
  const categories = must(await db.from("categories").select("id,keywords"), "categories") as Category[];
  const opts: RegistryOptions = { billingEnforced: config.BILLING_ENFORCED, enabledUnverified: config.ENABLED_UNVERIFIED_SOURCES };
  const allPrefs = users.map((u) => u.preferences);

  let collected: CollectResult | null = null;
  let firstQueries: string[] = [];
  if (users.length > 0) {
    firstQueries = primaryQueries(allPrefs, users.map(searchTopicsFor));
    collected = await collect(db, http, allPrefs, categories, opts, now, { queries: firstQueries, countries: remoteCountries(users) });
    await budget.record("collect", ZERO_USAGE, "ok");
    await runDiscovery(db, http, now).catch((err: unknown) => log("discovery.failed", errorInfo(err), "error"));
    await enrichPending(db, http, provider, budget, categories, config.ENRICH_MAX_PER_RUN, allPrefs, now);
  }

  const boards = must(await db.from("companies").select("id,ats,slug,name,tags,countries,fail_count").in("ats", ["gh", "lever", "ashby", "workable", "breezy", "recruitee"]), "boards") as CompanyRow[];

  let failedUsers = 0;
  const matches = new Map<string, MatchResult>();
  const matchOnce = async (user: ActiveUser) => {
    try {
      const m = await matchUser({ db, http, provider, budget, ownerEmail: config.OWNER_EMAIL }, user, runDate, now);
      const prev = matches.get(user.id);
      matches.set(user.id, prev ? mergeMatch(prev, m) : m);
    } catch (err) {
      failedUsers++;
      log("run.user_failed", { userId: user.id, ...errorInfo(err) }, "error");
      await budget.record("match", ZERO_USAGE, "failed", user.id, "stage_error");
    }
  };
  for (const user of users) await matchOnce(user);

  // Fallback titles are searched only for people still short of their minimum, as the first pass
  // found too little for them. Gates and the score floor stay as they are.
  const short = users.filter((u) => {
    const m = matches.get(u.id);
    return m && !m.aiBlockedReason && !m.stoppedBy && m.picked < u.preferences.minPicks;
  });
  const extra = fallbackQueries(short.map((u) => u.preferences), firstQueries);
  if (short.length > 0 && extra.length > 0) {
    log("run.fallback_search", { users: short.length, queries: extra.length });
    try {
      const more = await collect(db, http, short.map((u) => u.preferences), categories, opts, now, { queries: extra, countries: remoteCountries(short), queryOnly: true });
      collected = collected ? mergeCollect(collected, more) : more;
      await enrichPending(db, http, provider, budget, categories, config.ENRICH_MAX_PER_RUN, short.map((u) => u.preferences), now);
      for (const user of short) await matchOnce(user);
    } catch (err) {
      log("run.fallback_failed", errorInfo(err), "error");
    }
  }

  let picked = 0;
  for (const user of users) {
    const match = matches.get(user.id) ?? null;
    picked += match?.picked ?? 0;
    try {
      const gaps = coverageGaps(user.preferences, opts, boards).map((g) => g.message);
      const summary = await buildSummary(db, user, runDate, collected, ADAPTER_LABELS, gaps, match);
      // Upsert keeps a sent email sent: only its status row, not its delivery, is rewritten by a re-run.
      const existing = must(await db.from("daily_summaries").select("status").eq("user_id", user.id).eq("run_date", runDate).maybeSingle(), "existing summary") as { status: string } | null;
      if (existing?.status !== "sent") {
        must(
          await db.from("daily_summaries").upsert({
            user_id: user.id,
            run_date: runDate,
            data: summary,
            send_at: sendAtFor(now, user.tz, user.sendTime).toISOString(),
            status: "pending",
          }),
          "store summary",
        );
      }
    } catch (err) {
      failedUsers++;
      log("run.summary_failed", { userId: user.id, ...errorInfo(err) }, "error");
    }
  }
  log("run.done", { runDate, users: users.length, picked, failedUsers, spentUsd: budget.spent() });
  return { users: users.length, picked, failedUsers };
}

/** The person's own search topics, or the strongest tags in their library when they haven't set any. */
export function searchTopicsFor(user: Pick<ActiveUser, "preferences" | "facts">): string[] {
  return user.preferences.searchTopics.length > 0 ? user.preferences.searchTopics : topicsFromLibrary(user.facts);
}

/** Countries of people open to remote work, for searches of roles open to their country. */
function remoteCountries(users: ActiveUser[]): string[] {
  return [...new Set(users.filter((u) => u.preferences.workModes.includes("remote")).map((u) => u.preferences.eligibility.country.toUpperCase()))];
}

export function mergeMatch(a: MatchResult, b: MatchResult): MatchResult {
  return {
    picked: a.picked + b.picked,
    worthALook: a.worthALook + b.worthALook,
    skipped: a.skipped + b.skipped,
    unscored: a.unscored + b.unscored,
    stoppedBy: b.stoppedBy ?? a.stoppedBy,
    aiBlockedReason: b.aiBlockedReason ?? a.aiBlockedReason,
    usage: addUsage(a.usage, b.usage),
  };
}

export function mergeCollect(a: CollectResult, b: CollectResult): CollectResult {
  const sources = a.sources.map((s) => ({ ...s }));
  for (const s of b.sources) {
    const same = sources.find((x) => x.id === s.id);
    if (same) same.found += s.found;
    else sources.push({ ...s });
  }
  const dropped = { ...a.droppedByFilter };
  for (const [k, v] of Object.entries(b.droppedByFilter)) dropped[k] = (dropped[k] ?? 0) + v;
  return { sources, fetched: a.fetched + b.fetched, kept: a.kept + b.kept, inserted: a.inserted + b.inserted, droppedByFilter: dropped };
}

async function sendAlert(deps: RunDeps, runDate: string, now: Date, status: string | undefined): Promise<void> {
  if (!deps.config.OWNER_EMAIL) return;
  const html = `<p>CV Tailor hasn't finished today's run (${runDate}). Status: ${status ?? "not started"}, checked at ${now.toISOString()}.</p><p>Check that the worker is running and look at the runs table.</p>`;
  await deps.sender.send({
    to: deps.config.OWNER_EMAIL,
    from: deps.config.EMAIL_FROM,
    subject: `CV Tailor: no completed run for ${runDate}`,
    html,
    text: html.replace(/<[^>]+>/g, " "),
    idempotencyKey: `alert-${runDate}`,
  });
  must(await deps.db.from("daily_runs").upsert({ run_date: runDate, status: status === "ok" ? "ok" : (status ?? "failed"), alert_sent_at: now.toISOString() }, { onConflict: "run_date" }), "alert sent");
}

/**
 * Days the worker never ran (it was off) are recorded as 'missed' and raised once each as an
 * error, which reaches Slack. Matches for a missed day aren't recovered: the next run picks up
 * whatever is still within everyone's age window.
 */
async function noteMissedDays(db: Db, now: Date): Promise<void> {
  const runDate = today(now);
  const since = new Date(now.getTime() - (MISSED_LOOKBACK_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);
  const first = must(await db.from("daily_runs").select("run_date").order("run_date", { ascending: true }).limit(1), "first run") as { run_date: string }[];
  if (first.length === 0) return;
  const rows = must(await db.from("daily_runs").select("run_date").gte("run_date", since), "recent runs") as { run_date: string }[];
  const recorded = [...new Set([first[0]!.run_date, ...rows.map((r) => r.run_date)])];
  for (const day of missedDays(recorded, runDate)) {
    log("run.missed_day", { runDate: day }, "error");
    must(
      await db.from("daily_runs").upsert({ run_date: day, status: "missed", started_at: now.toISOString(), alert_sent_at: now.toISOString() }, { onConflict: "run_date", ignoreDuplicates: true }),
      "record missed day",
    );
  }
}

/** One pass of the worker: catch up on today's run if it's missing, send due email, alert if late. */
export async function tick(deps: RunDeps): Promise<string> {
  const { db, config } = deps;
  const now = deps.now?.() ?? new Date();
  const runDate = today(now);
  const row = must(
    await db.from("daily_runs").select("status,started_at,alert_sent_at").eq("run_date", runDate).maybeSingle(),
    "daily run",
  ) as { status: string; started_at: string; alert_sent_at: string | null } | null;

  await noteMissedDays(db, now).catch((err: unknown) => log("run.missed_check_failed", errorInfo(err), "error"));

  const decision = decideRun(row, now, config.RUN_START_HOUR_UTC);
  if (decision === "run") {
    must(
      await db.from("daily_runs").upsert({ run_date: runDate, status: "running", started_at: now.toISOString(), finished_at: null }, { onConflict: "run_date" }),
      "start run",
    );
    try {
      const detail = await runDaily(deps, runDate);
      must(
        await db.from("daily_runs").update({ status: "ok", finished_at: new Date().toISOString(), detail }).eq("run_date", runDate),
        "finish run",
      );
    } catch (err) {
      log("run.failed", { runDate, ...errorInfo(err) }, "error");
      must(await db.from("daily_runs").update({ status: "failed", finished_at: new Date().toISOString(), detail: errorInfo(err) }).eq("run_date", runDate), "fail run");
    }
  }

  await sendDueEmails({ db, sender: deps.sender, from: config.EMAIL_FROM, siteUrl: config.SITE_URL }, deps.now?.() ?? new Date());

  const after = must(
    await db.from("daily_runs").select("status,alert_sent_at").eq("run_date", runDate).maybeSingle(),
    "daily run after",
  ) as { status: string; alert_sent_at: string | null } | null;
  if (shouldAlert(after, deps.now?.() ?? new Date(), config.RUN_ALERT_HOUR_UTC)) {
    await sendAlert(deps, runDate, deps.now?.() ?? new Date(), after?.status).catch((err: unknown) => log("alert.failed", { runDate, ...errorInfo(err) }, "error"));
  }
  return decision;
}

export { mayUseAi };
