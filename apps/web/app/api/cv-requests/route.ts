import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { MAX_POSTING_CHARS } from "@cvtailor/core";
import { openCvRequest, writeRequestedCv } from "@cvtailor/ai/cv-request";
import { webBudget, webProvider } from "@/lib/ai";
import { billingEnforced, cvRequestsPerDay } from "@/lib/entitlement";
import { log, logged } from "@/lib/log";
import { allow } from "@/lib/rate-limit";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { safeHref } from "@/lib/views";

/** The CV is written after the response, within this route's time. The most a Hobby plan allows. */
export const maxDuration = 300;
/** Leaves room to record the outcome and give the CV back before the host stops the function. */
const WRITE_DEADLINE_MS = (maxDuration - 30) * 1000;

const BodySchema = z.object({
  /** An existing match with no CV. Missing for a job that's being pasted in fresh. */
  matchId: z.number().int().positive().optional(),
  text: z.string().max(MAX_POSTING_CHARS * 2).optional(),
  title: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  link: z.string().max(2000).optional(),
});

/**
 * Asks for a CV: for a job we already hold, or one pasted in. Takes one CV from the person's
 * allowance, answers straight away, and writes the CV after the response. The page polls
 * /api/cv-requests/[id], and the CV is given back if it isn't written.
 */
export const POST = logged("POST /api/cv-requests", async (request: NextRequest) => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const userId = auth.user.id;
  if (!allow(`cv-request:${userId}`, 20, 10 * 60_000)) return NextResponse.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429 });

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That request wasn't valid." }, { status: 400 });
  const body = parsed.data;

  const provider = webProvider();
  if (!provider) return NextResponse.json({ error: "Writing CVs isn't available right now. Try again later." }, { status: 503 });

  const db = adminClient();
  const opened = await openCvRequest(
    db,
    userId,
    { matchId: body.matchId, text: body.text, title: body.title, company: body.company, applyUrl: safeHref(body.link?.trim()) },
    { billingEnforced: billingEnforced(), cvRequestsPerDay: cvRequestsPerDay() },
  );
  if (!opened.ok) return NextResponse.json({ error: opened.error, ...(opened.upgrade ? { upgrade: true } : {}) }, { status: opened.status });

  after(async () => {
    try {
      await writeRequestedCv({ db, provider, budget: await webBudget(provider), deadlineMs: WRITE_DEADLINE_MS }, { id: opened.requestId, userId, matchId: opened.matchId });
    } catch {
      // writeRequestedCv records every outcome itself. This is loading the budget failing, which the expiry catches later.
      log("cv_request.start_failed", { requestId: opened.requestId, userId }, "error");
    }
  });
  return NextResponse.json({ requestId: opened.requestId, matchId: opened.matchId });
});
