import { NextResponse, type NextRequest } from "next/server";
import { actionFor, eventKey, parseEvent, verifySignature } from "@/lib/paystack";
import { allow, clientIp } from "@/lib/rate-limit";
import { adminClient } from "@/lib/supabase/admin";

/**
 * The only place entitlement is ever granted. The HMAC is checked against the raw body,
 * each event runs once by its key, and the checkout redirect is never trusted.
 */
export async function POST(request: NextRequest) {
  if (!allow(`webhook:${clientIp(request.headers)}`, 120, 60_000)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  const raw = await request.text();
  const secret = process.env.PAYSTACK_SECRET_KEY ?? "";
  if (!verifySignature(raw, request.headers.get("x-paystack-signature"), secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  const event = parseEvent(raw);
  if (!event) return NextResponse.json({ error: "bad payload" }, { status: 400 });

  const db = adminClient();
  const key = eventKey(event);
  const claim = await db.from("webhook_events").insert({ event_key: key, event_type: event.event }).select("event_key");
  if (claim.error) {
    // 23505: already handled. Answer 200 so Paystack stops retrying.
    if (claim.error.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json({ error: "try again" }, { status: 500 });
  }

  try {
    await apply(db, event);
    return NextResponse.json({ ok: true });
  } catch {
    // Release the claim, so Paystack's retry can finish the work.
    await db.from("webhook_events").delete().eq("event_key", key);
    return NextResponse.json({ error: "try again" }, { status: 500 });
  }
}

async function findUserId(db: ReturnType<typeof adminClient>, userId?: string, email?: string): Promise<string | null> {
  if (userId) {
    const { data } = await db.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (data) return data.id;
  }
  if (email) {
    const { data } = await db.from("profiles").select("id").eq("email", email.toLowerCase()).maybeSingle();
    if (data) return data.id;
  }
  return null;
}

async function apply(db: ReturnType<typeof adminClient>, event: NonNullable<ReturnType<typeof parseEvent>>): Promise<void> {
  const action = actionFor(event);
  if (action.kind === "ignore") return;

  const userId = await findUserId(db, action.userId, action.email);

  if (action.kind === "payment") {
    // All or nothing, and a repeat of the same reference grants nothing: see record_payment.
    const { error } = await db.rpc("record_payment", {
      p_user: userId,
      p_event_id: eventKey(event),
      p_reference: action.reference,
      p_amount_kobo: action.amountKobo,
      p_currency: action.currency,
      p_days: action.days,
      p_cvs: action.cvs,
      p_grant: action.grant,
    });
    if (error) throw new Error("record payment");
    return;
  }

  const { error } = await db.from("subscriptions").upsert(
    {
      user_id: userId,
      provider: "paystack",
      provider_ref: action.code,
      plan: "monthly",
      status: action.status,
      current_period_end: action.nextPayment ?? null,
      updated_at: new Date().toISOString(),
      ...(action.emailToken ? { email_token: action.emailToken } : {}),
    },
    { onConflict: "provider,provider_ref" },
  );
  if (error && userId) throw new Error("store subscription");
}
