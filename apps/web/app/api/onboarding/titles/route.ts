import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { FactLibrarySchema } from "@cvtailor/core";
import { BudgetExceeded } from "@cvtailor/ai/budget";
import { suggestTitles } from "@cvtailor/ai/onboarding";
import { webBudget, webProvider } from "@/lib/ai";
import { logged } from "@/lib/log";
import { allow } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const Body = z.object({ targetTitles: z.array(z.string().min(1).max(120)).min(1).max(20) });
const UNAVAILABLE = "Suggestions aren't available right now. You can type your own.";

export const POST = logged("POST /api/onboarding/titles", async (request: NextRequest) => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!allow(`titles:${data.user.id}`, 10, 10 * 60_000)) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Add a job title first." }, { status: 400 });

  const provider = webProvider();
  if (!provider) return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  const [{ data: categories }, { data: facts }] = await Promise.all([
    supabase.from("categories").select("id,label"),
    supabase.from("fact_library").select("data").eq("user_id", data.user.id).maybeSingle(),
  ]);
  const lib = FactLibrarySchema.safeParse(facts?.data);
  try {
    const r = await suggestTitles({ provider, budget: await webBudget(provider) }, data.user.id, {
      categories: categories ?? [],
      targetTitles: body.data.targetTitles,
      facts: lib.success ? lib.data : null,
    });
    if (!r.ok) return NextResponse.json({ error: UNAVAILABLE }, { status: 502 });
    return NextResponse.json({ suggestions: r.data });
  } catch (err) {
    if (err instanceof BudgetExceeded) return NextResponse.json({ error: UNAVAILABLE }, { status: 429 });
    throw err;
  }
});
