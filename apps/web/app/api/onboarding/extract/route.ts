import { NextResponse, type NextRequest } from "next/server";
import { BudgetExceeded } from "@cvtailor/ai/budget";
import { extractFacts } from "@cvtailor/ai/onboarding";
import { AI_UNAVAILABLE, webBudget, webProvider } from "@/lib/ai";
import { extractCvText, MAX_CV_BYTES } from "@/lib/cv-text";
import { errorFields, log, logged } from "@/lib/log";
import { allow } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/** Reading a long CV can take a few minutes. The most a Hobby plan allows. */
export const maxDuration = 300;

/** Reads an uploaded CV and proposes a library. The CV's text is used for this call only, never stored. */
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
  if (!provider) return NextResponse.json({ error: AI_UNAVAILABLE }, { status: 503 });
  try {
    const r = await extractFacts({ provider, budget: await webBudget(provider) }, data.user.id, data.user.email ?? "", text);
    if (!r.ok) return NextResponse.json({ error: "That couldn't be processed. You can enter your details by hand." }, { status: 502 });
    return NextResponse.json({ library: r.data });
  } catch (err) {
    if (err instanceof BudgetExceeded) return NextResponse.json({ error: "We can't read more CVs today. You can enter your details by hand." }, { status: 429 });
    throw err;
  }
});
