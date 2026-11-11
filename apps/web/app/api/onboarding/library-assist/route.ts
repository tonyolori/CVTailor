import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { FactLibrarySchema } from "@cvtailor/core";
import { BudgetExceeded } from "@cvtailor/ai/budget";
import { assistLibrary, MAX_INSTRUCTION_CHARS } from "@cvtailor/ai/onboarding";
import { AI_UNAVAILABLE, webBudget, webProvider } from "@/lib/ai";
import { logged } from "@/lib/log";
import { allow } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const Body = z.object({
  instruction: z.string().trim().min(3).max(MAX_INSTRUCTION_CHARS),
  /** The library as it stands on screen, saved or not. Falls back to the saved one. */
  library: z.unknown().optional(),
});

/**
 * The CV-setup prompt box. The person says what to change ("put my dates in order", "add that I led
 * the 2023 migration") and gets back a proposed library and a list of changes. Nothing is saved:
 * they review it and save through saveFacts.
 */
export const POST = logged("POST /api/onboarding/library-assist", async (request: NextRequest) => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("consented_at").eq("id", data.user.id).single();
  if (!profile?.consented_at) return NextResponse.json({ error: "Agree to how CV Tailor uses your details first." }, { status: 403 });
  if (!allow(`library-assist:${data.user.id}`, 10, 10 * 60_000)) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Say what you'd like changed." }, { status: 400 });

  let lib = FactLibrarySchema.safeParse(body.data.library);
  if (!lib.success) {
    const { data: saved } = await supabase.from("fact_library").select("data").eq("user_id", data.user.id).maybeSingle();
    lib = FactLibrarySchema.safeParse(saved?.data);
  }
  if (!lib.success) return NextResponse.json({ error: "Upload a CV or add one role first, then ask for changes." }, { status: 400 });

  const provider = webProvider();
  if (!provider) return NextResponse.json({ error: AI_UNAVAILABLE }, { status: 503 });
  try {
    const r = await assistLibrary({ provider, budget: await webBudget(provider) }, data.user.id, { instruction: body.data.instruction, library: lib.data });
    if (!r.ok) return NextResponse.json({ error: "That couldn't be done. Try saying it another way." }, { status: 502 });
    return NextResponse.json({ library: r.data.library, changes: r.data.changes });
  } catch (err) {
    if (err instanceof BudgetExceeded) return NextResponse.json({ error: AI_UNAVAILABLE }, { status: 429 });
    throw err;
  }
});
