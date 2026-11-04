import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { MAX_POSTING_CHARS, MIN_POSTING_CHARS, PASTED_JOB_TITLE } from "@cvtailor/core";
import { billingEnforced, cvRequestsPerDay } from "@/lib/entitlement";
import { allow } from "@/lib/rate-limit";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { safeHref } from "@/lib/views";

const BodySchema = z.object({
  /** An existing match with no CV. Missing for a job that's being pasted in fresh. */
  matchId: z.number().int().positive().optional(),
  text: z.string().max(MAX_POSTING_CHARS * 2).optional(),
  title: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  link: z.string().max(2000).optional(),
});

const TOO_SHORT = "That looks too short to be a full job posting. Paste the whole posting, including what the role involves.";

/**
 * Asks for a CV: for a job we already hold, or one pasted in. Takes one CV from the person's
 * allowance, and the worker gives it back if the CV isn't written. The worker checks again
 * before it spends anything, so these checks are for a clear answer.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const userId = auth.user.id;
  if (!allow(`cv-request:${userId}`, 20, 10 * 60_000)) return NextResponse.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429 });

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That request wasn't valid." }, { status: 400 });
  const body = parsed.data;

  const { data: facts } = await supabase.from("fact_library").select("user_id").eq("user_id", userId).maybeSingle();
  if (!facts) return NextResponse.json({ error: "Add your experience to your library first, so there's something to write from." }, { status: 409 });

  const text = body.text?.trim() ?? "";
  if (text && text.length < MIN_POSTING_CHARS) return NextResponse.json({ error: TOO_SHORT }, { status: 400 });
  if (!body.matchId && !text) return NextResponse.json({ error: TOO_SHORT }, { status: 400 });

  const admin = adminClient();

  if (body.matchId) {
    // RLS: this finds only the user's own match, and only jobs they may read.
    const { data: match } = await supabase.from("matches").select("id,tailor_status,posting_text,jobs(raw_text)").eq("id", body.matchId).maybeSingle();
    if (!match) return NextResponse.json({ error: "We couldn't find that job." }, { status: 404 });
    if (match.tailor_status === "rendered") return NextResponse.json({ error: "This job already has a CV." }, { status: 409 });
    const job = match.jobs as unknown as { raw_text: string | null } | null;
    if (!text && !match.posting_text && !job?.raw_text?.trim()) return NextResponse.json({ error: "We don't have this posting's text. Paste it to write a CV." }, { status: 400 });

    // Asking twice shouldn't cost twice.
    const { data: waiting } = await admin.from("ai_tasks").select("id").eq("match_id", match.id).in("status", ["pending", "running"]).maybeSingle();
    if (waiting) return NextResponse.json({ taskId: waiting.id, matchId: match.id });
  }

  const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
  const { count } = await admin.from("ai_tasks").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("kind", "tailor_match").neq("status", "skipped").gte("created_at", dayStart);
  if ((count ?? 0) >= cvRequestsPerDay()) {
    return NextResponse.json({ error: `You can write up to ${cvRequestsPerDay()} CVs a day. Try again tomorrow.` }, { status: 429 });
  }

  // Last of the checks and first of the changes: everything after this must give the CV back on failure.
  let bucket = "none";
  if (billingEnforced()) {
    const { data: reserved, error } = await admin.rpc("reserve_cv", { uid: userId });
    if (error) return NextResponse.json({ error: "Couldn't start that. Try again shortly." }, { status: 500 });
    if (!reserved) return NextResponse.json({ error: "You've used all your CVs.", upgrade: true }, { status: 402 });
    bucket = reserved as string;
  }
  const fail = async (message: string) => {
    if (bucket !== "none") await admin.rpc("return_cv", { uid: userId, bucket });
    return NextResponse.json({ error: message }, { status: 500 });
  };

  let matchId: number;
  if (body.matchId) {
    // Held on this person's match, never on a job other people share.
    const { error } = await admin
      .from("matches")
      .update({ tailor_status: "pending", tailor_error: null, ...(text ? { posting_text: text.slice(0, MAX_POSTING_CHARS) } : {}) })
      .eq("id", body.matchId)
      .eq("user_id", userId);
    if (error) return fail("Couldn't start that. Try again shortly.");
    matchId = body.matchId;
  } else {
    // A private job: only its owner can read it, and the daily pipeline never touches it.
    // The address is a placeholder. Nothing ever fetches a pasted job.
    const { data: job, error: jobError } = await admin
      .from("jobs")
      .insert({
        owner_id: userId,
        url: `pasted:${randomUUID()}`,
        apply_url: safeHref(body.link?.trim()),
        title: body.title?.trim().slice(0, 120) || PASTED_JOB_TITLE,
        company: body.company?.trim().slice(0, 120) || "Company not stated",
        source: "pasted",
        raw_text: text.slice(0, MAX_POSTING_CHARS),
        status: "new",
      })
      .select("id")
      .single();
    if (jobError || !job) return fail("Couldn't save that posting. Try again shortly.");
    const { data: match, error: matchError } = await admin
      .from("matches")
      .insert({ user_id: userId, job_id: job.id, decision: "pasted", reason: "You pasted this job in yourself.", tailor_status: "pending" })
      .select("id")
      .single();
    if (matchError || !match) {
      await admin.from("jobs").delete().eq("id", job.id);
      return fail("Couldn't save that posting. Try again shortly.");
    }
    matchId = match.id;
  }

  const { data: task, error } = await admin.from("ai_tasks").insert({ user_id: userId, kind: "tailor_match", input: {}, match_id: matchId, cv_bucket: bucket }).select("id").single();
  if (error || !task) return fail("Couldn't start that. Try again shortly.");
  return NextResponse.json({ taskId: task.id, matchId });
}
