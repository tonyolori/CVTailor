import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/site";
import { checkoutBody, PLANS, type PlanId } from "@/lib/paystack";
import { createClient } from "@/lib/supabase/server";

/** Starts a Paystack checkout. Nothing is granted here: only the verified webhook does that. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return NextResponse.redirect(siteUrl("/login", request), 303);

  const secret = process.env.PAYSTACK_SECRET_KEY;
  const form = await request.formData();
  const planId = String(form.get("plan"));
  if (!secret || !(planId in PLANS)) return NextResponse.redirect(siteUrl("/pricing?error=unavailable", request), 303);

  const envKey = planId === "monthly" ? "PAYSTACK_PRICE_MONTHLY_KOBO" : "PAYSTACK_PRICE_ONCE_KOBO";
  const amountKobo = Number(process.env[envKey]);
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) return NextResponse.redirect(siteUrl("/pricing?error=unavailable", request), 303);

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(
      checkoutBody({
        email: data.user.email,
        userId: data.user.id,
        planId: planId as PlanId,
        amountKobo,
        callbackUrl: `${site}/settings?paid=pending`,
        planCode: process.env.PAYSTACK_PLAN_CODE_MONTHLY,
      }),
    ),
  });
  const body = (await res.json().catch(() => null)) as { status?: boolean; data?: { authorization_url?: string } } | null;
  const url = body?.data?.authorization_url;
  if (!res.ok || !url) return NextResponse.redirect(siteUrl("/pricing?error=checkout", request), 303);
  return NextResponse.redirect(url, 303);
}
