import {
  countryInRegion,
  EnrichedJobSchema,
  evaluateGates,
  titleTier,
  type EnrichedJob,
  type GateResult,
  type Preferences,
  type TitleTier,
} from "@cvtailor/core";
import { libraryContext, SCORE_SYSTEM, ScoreSchema, scoreUserPrompt, type Score } from "@cvtailor/core/prompts";
import { addUsage, mayUseAi, ZERO_USAGE, type LlmProvider, type LlmRequest, type LlmUsage } from "@cvtailor/llm";
import { chunks, must, type Db } from "../db";
import { log } from "../log";
import type { Http } from "../sources/http";
import { BudgetExceeded, type Budget } from "./budget";
import { liveUrl, type JobRow } from "./enrich";
import { checkLive } from "./live";
import type { ActiveUser } from "./users";

export interface MatchDeps {
  db: Db;
  http: Http;
  provider: LlmProvider;
  budget: Budget;
  ownerEmail?: string;
}

interface Candidate {
  job: JobRow;
  enriched: EnrichedJob;
  gates: GateResult;
  tier: TitleTier;
}

interface Scored extends Candidate {
  score: number;
  reason: string;
}

/** How far back to look. Longer than any user's age window, which never widens. */
const LOOKBACK_DAYS = 60;
const MAX_NEAR_MISSES_SCORED = 12;
/** A role needing a credential the user lacks, under the score-penalty policy. */
export const MISSING_CREDENTIAL_PENALTY = 3;

export function heldCredentials(user: Pick<ActiveUser, "facts">): string[] {
  return [
    ...user.facts.credentials.map((c) => c.name),
    ...user.facts.entries.filter((e) => e.kind === "education").map((e) => e.title),
  ];
}

export function totalScore(s: Pick<Score, "roleMatch" | "libraryFit">, missingCredentials: string[]): number {
  const raw = s.roleMatch + s.libraryFit;
  return Math.max(0, missingCredentials.length > 0 ? raw - MISSING_CREDENTIAL_PENALTY : raw);
}

/** Rank by score, then recency. */
export function rank<T extends { score: number; enriched: EnrichedJob }>(items: T[]): T[] {
  const time = (e: EnrichedJob) => (e.postedAt ? new Date(e.postedAt).getTime() : 0);
  return [...items].sort((a, b) => b.score - a.score || time(b.enriched) - time(a.enriched));
}

/** Near misses in the user's preferred regions first. Ordering is a preference, never a default. */
export function rankNearMisses<T extends { score: number; enriched: EnrichedJob }>(items: T[], prefs: Preferences): T[] {
  const preferred = (e: EnrichedJob) =>
    prefs.worthALookPreferRegions.some(
      (r) =>
        e.eligibleRegions.includes(r) ||
        e.eligibleCountries.some((c) => countryInRegion(c, r)) ||
        e.locations.some((l) => countryInRegion(l.country, r)),
    );
  return [...rank(items)].sort((a, b) => Number(preferred(b.enriched)) - Number(preferred(a.enriched)));
}

function capFor(user: ActiveUser): number {
  return Math.min(user.preferences.dailyCap, user.dailyCap);
}

export interface MatchResult {
  picked: number;
  worthALook: number;
  skipped: number;
  unscored: number;
  stoppedBy?: string;
  aiBlockedReason?: string;
  usage: LlmUsage;
}

async function loadCandidates(deps: MatchDeps, user: ActiveUser, now: Date): Promise<Candidate[]> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const jobs = must(
    await deps.db.from("jobs").select("*").in("status", ["enriched", "verified"]).is("owner_id", null).gte("first_seen", since).order("first_seen", { ascending: false }).limit(2000),
    "candidate jobs",
  ) as (JobRow & { enriched: unknown })[];
  const done = must(
    await deps.db.from("matches").select("job_id,decision").eq("user_id", user.id).neq("decision", "unscored"),
    "existing matches",
  ) as { job_id: number }[];
  const seen = new Set(done.map((d) => d.job_id));
  const credentials = heldCredentials(user);
  const out: Candidate[] = [];
  for (const job of jobs) {
    if (seen.has(job.id)) continue;
    const parsed = EnrichedJobSchema.safeParse(job.enriched);
    if (!parsed.success) continue;
    out.push({
      job,
      enriched: parsed.data,
      gates: evaluateGates({ title: job.title, enriched: parsed.data }, user.preferences, now, { credentials }),
      tier: titleTier(job.title, user.preferences) ?? "c",
    });
  }
  return out;
}

async function storeDecisions(
  db: Db,
  user: ActiveUser,
  runDate: string,
  rows: { c: Candidate; decision: string; score?: number; reason: string; verified?: boolean | null; verifiedNote?: string | null }[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200).map((r) => ({
      user_id: user.id,
      job_id: r.c.job.id,
      run_date: runDate,
      decision: r.decision,
      score: r.score ?? null,
      reason: r.reason.slice(0, 500),
      tier: r.c.tier,
      gate_failures: r.c.gates.failed,
      notes: r.c.gates.notes,
      verified: r.verified ?? null,
      verified_note: r.verifiedNote ?? null,
    }));
    must(await db.from("matches").upsert(batch, { onConflict: "user_id,job_id" }), "store matches");
  }
}

class ScoreStop extends Error {
  constructor(readonly by: string) {
    super(by);
  }
}

/** Scores with the cache keyed by (user, job, preferences version). Stops cleanly at a budget or rate limit. */
async function scoreAll(deps: MatchDeps, user: ActiveUser, items: Candidate[]): Promise<{ scored: Scored[]; usage: LlmUsage; stoppedBy?: string }> {
  if (items.length === 0) return { scored: [], usage: ZERO_USAGE };
  const cached: { job_id: number; role_match: number; library_fit: number; reason: string | null }[] = [];
  for (const ids of chunks(items.map((c) => c.job.id), 200)) {
    const rows = must(
      await deps.db
        .from("match_scores")
        .select("job_id,role_match,library_fit,reason")
        .eq("user_id", user.id)
        .eq("preferences_version", user.preferencesVersion)
        .in("job_id", ids),
      "cached scores",
    ) as typeof cached;
    cached.push(...rows);
  }
  const scores = new Map<number, Score>(
    cached.map((c) => [c.job_id, { roleMatch: Number(c.role_match), libraryFit: Number(c.library_fit), reason: c.reason ?? "" }]),
  );

  const missing = items.filter((c) => !scores.has(c.job.id));
  const context = libraryContext(user.facts);
  const requests: LlmRequest<Score>[] = missing.map((c) => ({
    id: String(c.job.id),
    tier: "small",
    effort: "low",
    maxTokens: 500,
    system: SCORE_SYSTEM,
    cachedContext: context,
    user: scoreUserPrompt({ title: c.job.title, company: c.job.company, enriched: c.enriched }, user.preferences, c.tier),
    schema: ScoreSchema,
  }));

  let usage = ZERO_USAGE;
  let stoppedBy: string | undefined;
  const CHUNK = deps.provider.name === "anthropic-api" ? 50 : 5;
  try {
    for (let i = 0; i < requests.length; i += CHUNK) {
      deps.budget.assertAvailable(user.id);
      const results = await deps.provider.completeMany(requests.slice(i, i + CHUNK));
      for (const [id, r] of results) {
        usage = addUsage(usage, r.usage);
        deps.budget.add(r.usage.costUsd, user.id);
        if (r.ok) {
          scores.set(Number(id), r.data);
          must(
            await deps.db.from("match_scores").upsert({
              user_id: user.id,
              job_id: Number(id),
              preferences_version: user.preferencesVersion,
              role_match: r.data.roleMatch,
              library_fit: r.data.libraryFit,
              reason: r.data.reason,
            }),
            "cache score",
          );
        } else if (r.kind === "rate_limit" || r.kind === "auth") {
          throw new ScoreStop(r.kind);
        } else {
          log("score.failed", { jobId: Number(id), userId: user.id, kind: r.kind });
        }
      }
    }
  } catch (err) {
    if (err instanceof BudgetExceeded) stoppedBy = err.scope;
    else if (err instanceof ScoreStop) stoppedBy = err.by;
    else throw err;
  }

  const scored: Scored[] = [];
  for (const c of items) {
    const s = scores.get(c.job.id);
    if (s) scored.push({ ...c, score: totalScore(s, c.gates.missingCredentials), reason: s.reason });
  }
  return { scored, usage, stoppedBy };
}

const TIER_ORDER: TitleTier[] = ["core", "a", "b", "c"];

/** Confirms a pick is still open at its source. An unreachable page still counts, marked unverified. */
async function verifyPick(deps: MatchDeps, c: Candidate, now: Date): Promise<{ ok: boolean; verified: boolean; note: string }> {
  const checkedToday = c.job.last_verified && now.getTime() - new Date(c.job.last_verified).getTime() < 86_400_000;
  if (c.job.from_ats && checkedToday) return { ok: true, verified: true, note: "On the employer's board today" };
  const live = await checkLive(deps.http, liveUrl(c.job));
  if (!live.reachable) return { ok: true, verified: false, note: "Couldn't check the employer's own listing" };
  if (live.closedSignal) {
    must(await deps.db.from("jobs").update({ status: "closed", last_verified: now.toISOString() }).eq("id", c.job.id), "close job");
    return { ok: false, verified: true, note: "Closed" };
  }
  must(await deps.db.from("jobs").update({ last_verified: now.toISOString() }).eq("id", c.job.id), "verify job");
  return { ok: true, verified: true, note: live.postedAt ? `Open, posted ${live.postedAt.slice(0, 10)}` : "Open at its source" };
}

/** Per-user match stage. Gates in code first, then LLM scores for survivors. Safe to re-run. */
export async function matchUser(deps: MatchDeps, user: ActiveUser, runDate: string, now: Date = new Date()): Promise<MatchResult> {
  const prefs = user.preferences;
  const candidates = await loadCandidates(deps, user, now);
  const passing = candidates.filter((c) => c.gates.pass);
  const nearMisses = candidates.filter((c) => c.gates.nearMiss);
  const rest = candidates.filter((c) => !c.gates.pass && !c.gates.nearMiss);

  await storeDecisions(
    deps.db,
    user,
    runDate,
    rest.map((c) => ({ c, decision: "skipped", reason: c.gates.reasons.join("; ") })),
  );

  const result: MatchResult = { picked: 0, worthALook: 0, skipped: rest.length, unscored: 0, usage: ZERO_USAGE };

  const access = mayUseAi(deps.provider.name, deps.ownerEmail, { email: user.email, isSynthetic: user.isSynthetic });
  if (!access.allowed) {
    await storeDecisions(
      deps.db,
      user,
      runDate,
      [...passing, ...nearMisses].map((c) => ({ c, decision: c.gates.pass ? "unscored" : "skipped", reason: c.gates.pass ? access.reason : c.gates.reasons.join("; ") })),
    );
    result.unscored = passing.length;
    result.aiBlockedReason = access.reason;
    await deps.budget.record("match", ZERO_USAGE, "skipped", user.id, "ai_not_available_for_user");
    return result;
  }

  const { count } = await deps.db.from("matches").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("run_date", runDate).eq("decision", "picked");
  const room = Math.max(0, capFor(user) - (count ?? 0));
  const wantAtLeast = Math.min(prefs.minPicks, room);

  // Main titles first. Fallback tiers only while below minPicks, never relaxing a gate or the score floor.
  const qualifying: Scored[] = [];
  const belowThreshold: Scored[] = [];
  for (const tier of TIER_ORDER) {
    if (tier !== "core" && qualifying.length >= wantAtLeast) break;
    const inTier = passing.filter((c) => c.tier === tier);
    const r = await scoreAll(deps, user, inTier);
    result.usage = addUsage(result.usage, r.usage);
    for (const s of r.scored) (s.score >= prefs.minScore ? qualifying : belowThreshold).push(s);
    if (r.stoppedBy) result.stoppedBy = r.stoppedBy;
    if (result.stoppedBy) break;
  }

  // Past the daily cap, roles aren't recorded, so tomorrow's run can still take them.
  let picked = 0;
  for (const s of rank(qualifying)) {
    if (picked >= room) break;
    const v = await verifyPick(deps, s, now);
    if (!v.ok) {
      await storeDecisions(deps.db, user, runDate, [{ c: s, decision: "skipped", score: s.score, reason: "Closed when verified", verified: true, verifiedNote: v.note }]);
      continue;
    }
    await storeDecisions(deps.db, user, runDate, [
      { c: s, decision: "picked", score: s.score, reason: s.reason, verified: v.verified, verifiedNote: v.note },
    ]);
    picked++;
  }
  result.picked = picked;

  await storeDecisions(
    deps.db,
    user,
    runDate,
    belowThreshold.map((s) => ({ c: s, decision: "below-threshold", score: s.score, reason: s.reason })),
  );

  // Near misses: every other gate passed. Scored only for main titles, and given no CV.
  let worth: Scored[] = [];
  if (prefs.worthALookCount > 0 && !result.stoppedBy) {
    const toScore = nearMisses.filter((c) => c.tier === "core").slice(0, MAX_NEAR_MISSES_SCORED);
    const r = await scoreAll(deps, user, toScore);
    result.usage = addUsage(result.usage, r.usage);
    if (r.stoppedBy) result.stoppedBy = r.stoppedBy;
    worth = rankNearMisses(r.scored.filter((s) => s.score >= prefs.worthALookMinScore), prefs).slice(0, prefs.worthALookCount);
  }
  const worthIds = new Set(worth.map((w) => w.job.id));
  await storeDecisions(deps.db, user, runDate, worth.map((s) => ({ c: s, decision: "worth-a-look", score: s.score, reason: s.reason })));
  await storeDecisions(
    deps.db,
    user,
    runDate,
    nearMisses.filter((c) => !worthIds.has(c.job.id)).map((c) => ({ c, decision: "skipped", reason: c.gates.reasons.join("; ") })),
  );
  result.worthALook = worth.length;

  await deps.budget.record("match", result.usage, result.stoppedBy ? "failed" : "ok", user.id, result.stoppedBy ?? null);
  log("match.done", { userId: user.id, picked, worth: worth.length, skipped: rest.length, stoppedBy: result.stoppedBy, calls: result.usage.calls });
  return result;
}
