import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Daily check from the web host's cron. The worker can't report that it's off, so this
 * alerts the owner when no run has finished. Protected by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = adminClient();
  const runDate = new Date().toISOString().slice(0, 10);
  const { data: run } = await db.from("daily_runs").select("status,alert_sent_at").eq("run_date", runDate).maybeSingle();
  if (run?.status === "ok") return NextResponse.json({ ok: true, status: "ok" });
  if (run?.alert_sent_at) return NextResponse.json({ ok: true, status: "already_alerted" });

  const owner = process.env.OWNER_EMAIL;
  const key = process.env.EMAIL_API_KEY;
  if (!owner || !key) return NextResponse.json({ ok: false, status: "email_not_configured" }, { status: 500 });

  const text = `JobTailor hasn't finished today's run (${runDate}). Status: ${run?.status ?? "not started"}. Check that the worker is running.`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `alert-${runDate}` },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: owner, subject: `JobTailor: no completed run for ${runDate}`, text }),
  });
  if (!res.ok) return NextResponse.json({ ok: false, status: "send_failed" }, { status: 502 });
  await db.from("daily_runs").upsert({ run_date: runDate, status: run?.status ?? "failed", alert_sent_at: new Date().toISOString() }, { onConflict: "run_date" });
  return NextResponse.json({ ok: true, status: "alerted" });
}
