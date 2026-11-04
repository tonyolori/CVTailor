import { NextResponse, type NextRequest } from "next/server";
import { hasActivePlan } from "@cvtailor/core";
import { siteUrl } from "@/lib/site";
import { checkoutBody, PLANS, type PlanId } from "@/lib/paystack";
import { nairaToKobo, priceNaira } from "@/lib/plan-settings";
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

  // Extra CVs top up a plan. They aren't a way around having one.
  if (planId === "topup") {
    const { data: profile } = await supabase.from("profiles").select("plan,paid_until").eq("id", data.user.id).maybeSingle();
    if (!profile || !hasActivePlan({ plan: profile.plan, paidUntil: profile.paid_until }, new Date())) {
      return NextResponse.redirect(siteUrl("/pricing?error=plan", request), 303);
    }
  }

  const price = priceNaira(planId as PlanId);
  if (price === null) return NextResponse.redirect(siteUrl("/pricing?error=unavailable", request), 303);

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(
      checkoutBody({
        email: data.user.email,
        userId: data.user.id,
        planId: planId as PlanId,
        amountKobo: nairaToKobo(price),
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
