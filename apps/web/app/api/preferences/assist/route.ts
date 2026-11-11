import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { FactLibrarySchema, PreferencesSchema } from "@cvtailor/core";
import { BudgetExceeded } from "@cvtailor/ai/budget";
import { assistPreferences, MAX_INSTRUCTION_CHARS } from "@cvtailor/ai/onboarding";
import { AI_UNAVAILABLE, webBudget, webProvider } from "@/lib/ai";
import { logged } from "@/lib/log";
import { allow } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const Body = z.object({
  instruction: z.string().trim().min(3).max(MAX_INSTRUCTION_CHARS),
  /** The preferences as they stand on screen, saved or not. Falls back to the saved ones. */
  preferences: z.unknown().optional(),
});

/**
 * The preferences prompt box, in onboarding and settings. The person says what they want ("only
 * fully remote roles", "add titles that fit my experience") and gets back proposed preferences and
 * a list of changes. Nothing is saved: they review it and save through savePreferences.
 */
export const POST = logged("POST /api/preferences/assist", async (request: NextRequest) => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("consented_at").eq("id", data.user.id).single();
  if (!profile?.consented_at) return NextResponse.json({ error: "Agree to how CV Tailor uses your details first." }, { status: 403 });
  if (!allow(`preferences-assist:${data.user.id}`, 10, 10 * 60_000)) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Say what you'd like changed." }, { status: 400 });

  const [{ data: categories }, { data: facts }, { data: saved }] = await Promise.all([
    supabase.from("categories").select("id,label"),
    supabase.from("fact_library").select("data").eq("user_id", data.user.id).maybeSingle(),
    supabase.from("preferences").select("data").eq("user_id", data.user.id).maybeSingle(),
  ]);
  let prefs = PreferencesSchema.safeParse(body.data.preferences);
  if (!prefs.success) prefs = PreferencesSchema.safeParse(saved?.data);
  if (!prefs.success) return NextResponse.json({ error: "Add a job title and where you live first, then ask for changes." }, { status: 400 });
  const lib = FactLibrarySchema.safeParse(facts?.data);

  const provider = webProvider();
  if (!provider) return NextResponse.json({ error: AI_UNAVAILABLE }, { status: 503 });
  try {
    const r = await assistPreferences({ provider, budget: await webBudget(provider) }, data.user.id, {
      instruction: body.data.instruction,
      preferences: prefs.data,
      facts: lib.success ? lib.data : null,
      categories: categories ?? [],
    });
    if (!r.ok) return NextResponse.json({ error: "That couldn't be done. Try saying it another way." }, { status: 502 });
    return NextResponse.json({ preferences: r.data.preferences, changes: r.data.changes });
  } catch (err) {
    if (err instanceof BudgetExceeded) return NextResponse.json({ error: AI_UNAVAILABLE }, { status: 429 });
    throw err;
  }
});
