import { EnrichedJobSchema } from "@cvtailor/core";
import { must, type Db } from "../db";
import { DailySummarySchema, type DailySummary } from "../email/template";
import type { SourceAdapter } from "../sources/types";
import type { CollectResult } from "./collect";
import type { MatchResult } from "./match";
import type { ActiveUser } from "@cvtailor/ai/users";

interface MatchRow {
  id: number;
  decision: string;
  score: number | string | null;
  reason: string | null;
  tier: string | null;
  gate_failures: string[];
  notes: string[];
  verified: boolean | null;
  verified_note: string | null;
  tailor_status: string;
  tailor_error: string | null;
  jobs: {
    url: string;
    apply_url: string | null;
    source: string;
    company: string;
    title: string;
    enriched: unknown;
    posted_at: string | null;
  } | null;
}

const MAX_CLOSE_CALLS = 5;

function shortLocation(e: { eligibleCountries: string[]; eligibleRegions: string[]; locations: { city: string | null; country: string }[]; workMode: string }): string {
  if (e.locations.length) return e.locations.map((l) => l.city ?? l.country).slice(0, 3).join(", ");
  if (e.eligibleCountries.length) return e.eligibleCountries.slice(0, 4).join(", ") + " only";
  if (e.eligibleRegions.length) return e.eligibleRegions.join(", ") + " only";
  return e.workMode === "remote" ? "Eligibility unclear" : e.workMode;
}

const FAILURE_REASON: Record<string, string> = {
  failed_fact_check: "The draft kept including things that aren't in your library, so it wasn't delivered.",
};

export async function buildSummary(
  db: Db,
  user: ActiveUser,
  runDate: string,
  collected: Pick<CollectResult, "sources"> | null,
  adapters: Pick<SourceAdapter, "id" | "label">[],
  gaps: string[],
  match: Pick<MatchResult, "stoppedBy" | "aiBlockedReason" | "unscored"> | null,
): Promise<DailySummary> {
  const rows = must(
    await db
      .from("matches")
      .select("id,decision,score,reason,tier,gate_failures,notes,verified,verified_note,tailor_status,tailor_error,jobs(url,apply_url,source,company,title,enriched,posted_at)")
      .eq("user_id", user.id)
      .eq("run_date", runDate)
      .order("score", { ascending: false, nullsFirst: false }),
    "summary matches",
  ) as unknown as MatchRow[];
  const matchIds = rows.filter((r) => r.decision === "picked").map((r) => r.id);
  const docs = matchIds.length
    ? (must(await db.from("documents").select("match_id,kind,storage_path,id").eq("user_id", user.id).in("match_id", matchIds).order("id", { ascending: false }), "summary docs") as { match_id: number; kind: string; storage_path: string }[])
    : [];
  const docFor = (m: number, kind: string) => docs.find((d) => d.match_id === m && d.kind === kind)?.storage_path;
  const labelFor = (id: string) => adapters.find((a) => a.id === id)?.label ?? id;
  const parsed = (r: MatchRow) => EnrichedJobSchema.safeParse(r.jobs?.enriched);

  const summary: DailySummary = DailySummarySchema.parse({
    date: runDate,
    sources: (collected?.sources ?? []).filter((s) => !s.failed).map((s) => ({ label: s.label })),
    skipped: (collected?.sources ?? []).filter((s) => s.failed).map((s) => `${s.label} (didn't respond)`),
    gaps,
    roles: [],
    unscored: match?.unscored ?? 0,
    notes: [
      ...(match?.aiBlockedReason ? [match.aiBlockedReason] : []),
      ...(match?.stoppedBy
        ? ["Today's search stopped early because a usage limit was reached. It picks up where it left off on the next run."]
        : []),
    ],
  });

  const tiers = new Set<string>();
  for (const r of rows) {
    const job = r.jobs;
    if (!job) continue;
    const e = parsed(r);
    const enriched = e.success ? e.data : null;
    const apply = job.apply_url ?? job.url;
    if (r.decision === "picked") {
      if (r.tailor_status === "failed") {
        summary.failed.push({
          company: job.company,
          title: job.title,
          reason: FAILURE_REASON[r.tailor_error ?? ""] ?? "Something went wrong while writing the CV. It'll be looked at.",
          link: apply,
        });
        continue;
      }
      if (r.tier && r.tier !== "core") tiers.add(r.tier.toUpperCase());
      const notes: string[] = [];
      if (enriched?.applicantInstructions.length) notes.push(`The posting asks applicants: ${enriched.applicantInstructions.join(" ")}`);
      if (r.notes?.length) notes.push(...r.notes);
      if (r.tailor_error === "cover_letter_failed") notes.push("The posting asks for a cover letter, but one couldn't be written that passed the fact check.");
      const resumePath = docFor(r.id, "resume_pdf");
      summary.roles.push({
        matchId: r.id,
        title: job.title,
        company: job.company,
        score: Number(r.score ?? 0),
        tier: r.tier ?? undefined,
        apply,
        sourceLabel: labelFor(job.source),
        sourceUrl: job.url,
        location: enriched?.locationQuote || undefined,
        verified: r.verified_note ?? undefined,
        verifiedOk: r.verified !== false,
        why: r.reason ?? undefined,
        note: notes.join(" ") || undefined,
        resumePath,
        coverLetterPath: docFor(r.id, "cover_letter_pdf"),
      });
    } else if (r.decision === "worth-a-look") {
      summary.worthALook.push({
        title: job.title,
        company: job.company,
        score: Number(r.score ?? 0),
        link: job.url,
        sourceLabel: labelFor(job.source),
        posted: job.posted_at?.slice(0, 10),
        location: enriched ? shortLocation(enriched) : undefined,
        whyNot: enriched?.locationQuote ? `"${enriched.locationQuote}"` : undefined,
        why: r.reason ?? undefined,
      });
    } else if (r.decision === "skipped" && r.tier === "core" && r.gate_failures?.length === 1 && summary.closeCalls.length < MAX_CLOSE_CALLS) {
      // One gate away, on a main title. Near misses that scored low aren't close calls.
      const gate = r.gate_failures[0]!;
      if (gate !== "location" && gate !== "work_mode" && gate !== "category" && gate !== "closed") {
        summary.closeCalls.push({ company: job.company, title: job.title, reason: r.reason ?? gate, link: job.url });
      }
    }
  }
  if (tiers.size) summary.expansion = `Fewer than your minimum on your main titles, so tiers ${[...tiers].join(", ")} were searched too.`;
  return summary;
}
