import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { FactLibrarySchema } from "@jobtailor/core";
import { suggestTitlesSystem, suggestTitlesUserPrompt, TitleSuggestionsSchema } from "@jobtailor/core/prompts";
import { webProvider } from "@/lib/ai";
import { allow } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({ targetTitles: z.array(z.string().min(1).max(120)).min(1).max(20) });

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!allow(`titles:${data.user.id}`, 10, 10 * 60_000)) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Add a job title first." }, { status: 400 });

  const provider = webProvider();
  if (provider) {
    const [{ data: categories }, { data: facts }] = await Promise.all([
      supabase.from("categories").select("id,label"),
      supabase.from("fact_library").select("data").eq("user_id", data.user.id).maybeSingle(),
    ]);
    const lib = FactLibrarySchema.safeParse(facts?.data);
    const r = await provider.complete({
      id: "titles",
      tier: "small",
      effort: "low",
      system: suggestTitlesSystem(categories ?? []),
      user: suggestTitlesUserPrompt(body.data.targetTitles, lib.success ? lib.data : null),
      schema: TitleSuggestionsSchema,
    });
    if (!r.ok) return NextResponse.json({ error: "Suggestions aren't available right now. You can type your own." }, { status: 502 });
    return NextResponse.json({ suggestions: r.data });
  }

  const { data: task, error } = await supabase
    .from("ai_tasks")
    .insert({ user_id: data.user.id, kind: "suggest_titles", input: { targetTitles: body.data.targetTitles } })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: "Suggestions aren't available right now. You can type your own." }, { status: 500 });
  return NextResponse.json({ taskId: task.id });
}
