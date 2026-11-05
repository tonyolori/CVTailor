import { NextResponse, type NextRequest } from "next/server";
import { EXTRACT_FACTS_SYSTEM, extractFactsUserPrompt, ProposedLibrarySchema } from "@cvtailor/core/prompts";
import { webProvider } from "@/lib/ai";
import { extractCvText, MAX_CV_BYTES } from "@/lib/cv-text";
import { errorFields, log, logged } from "@/lib/log";
import { allow } from "@/lib/rate-limit";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const MAX_CV_CHARS = 60_000;

/** Reads an uploaded CV and proposes a library. Inline with an API key, otherwise queued for the worker. */
export const POST = logged("POST /api/onboarding/extract", async (request: NextRequest) => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!allow(`cv:${data.user.id}`, 5, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many uploads. Try again in a few minutes." }, { status: 429 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  if (file.size > MAX_CV_BYTES) return NextResponse.json({ error: "That file is over 4 MB." }, { status: 400 });

  let text: string;
  try {
    text = (await extractCvText(file)).trim();
  } catch (err) {
    log("cv.read_failed", { bytes: file.size, ...errorFields(err) }, "warn");
    return NextResponse.json({ error: err instanceof Error && /PDF or Word/.test(err.message) ? err.message : "That file couldn't be read." }, { status: 400 });
  }
  if (text.length < 50) {
    return NextResponse.json({ error: "No text found in that file. It may be a scanned image. You can enter your details by hand." }, { status: 400 });
  }

  const provider = webProvider();
  if (provider) {
    const r = await provider.complete({
      id: "extract",
      tier: "strong",
      effort: "low",
      system: EXTRACT_FACTS_SYSTEM,
      user: extractFactsUserPrompt(text.slice(0, MAX_CV_CHARS), data.user.email ?? ""),
      schema: ProposedLibrarySchema,
    });
    if (!r.ok) return NextResponse.json({ error: "That couldn't be processed. You can enter your details by hand." }, { status: 502 });
    return NextResponse.json({ library: r.data });
  }

  // A newer upload replaces any still waiting, such as one from before a page reload.
  await adminClient().from("ai_tasks").delete().eq("user_id", data.user.id).eq("kind", "extract_facts").eq("status", "pending");

  const { data: task, error } = await supabase
    .from("ai_tasks")
    .insert({ user_id: data.user.id, kind: "extract_facts", input: { cvText: text.slice(0, MAX_CV_CHARS) } })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: "Couldn't queue that. You can enter your details by hand." }, { status: 500 });
  return NextResponse.json({ taskId: task.id });
});
