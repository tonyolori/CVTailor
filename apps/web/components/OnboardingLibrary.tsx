"use client";

import { useRef, useState } from "react";
import { FactLibrarySchema, type FactLibrary } from "@jobtailor/core";
import { LibraryEditor } from "./LibraryEditor";
import { pollTask } from "./TaskWait";

type Step = "choose" | "working" | "review";

/** Step 1: upload a CV for a proposed library, or start from blank. Nothing is saved until the user reviews it. */
export function OnboardingLibrary({ email, displayName }: { email: string; displayName: string }) {
  const blank: FactLibrary = FactLibrarySchema.parse({ contact: { name: displayName, email }, entries: [] });
  const [step, setStep] = useState<Step>("choose");
  const [library, setLibrary] = useState<FactLibrary>(blank);
  const [notice, setNotice] = useState<string | null>(null);
  const [waited, setWaited] = useState(0);
  const abort = useRef<AbortController | null>(null);

  async function upload(form: FormData) {
    setNotice(null);
    setStep("working");
    const res = await fetch("/api/onboarding/extract", { method: "POST", body: form });
    const body = (await res.json()) as { error?: string; library?: unknown; taskId?: number };
    if (!res.ok || body.error) {
      setNotice(body.error ?? "That didn't work. You can enter your details by hand.");
      setStep("choose");
      return;
    }
    if (body.library) return accept(body.library);
    abort.current = new AbortController();
    const done = await pollTask<unknown>(body.taskId!, setWaited, abort.current.signal);
    if (done.status === "done") return accept(done.output);
    if (done.status === "cancelled") return;
    setNotice(done.error ?? "That couldn't be processed. You can enter your details by hand.");
    setStep("choose");
  }

  function accept(raw: unknown) {
    const parsed = FactLibrarySchema.safeParse(raw);
    if (!parsed.success) {
      setNotice("The proposal couldn't be read. You can enter your details by hand.");
      setStep("choose");
      return;
    }
    setLibrary(parsed.data);
    setStep("review");
  }

  if (step === "review") {
    return (
      <div className="stack">
        <div className="notice">Check each entry. Fix anything wrong and remove anything you wouldn't say in an interview, because CVs can only use what's here.</div>
        <LibraryEditor initial={library} next="/onboarding/preferences" saveLabel="Save and continue" />
      </div>
    );
  }

  if (step === "working") {
    return (
      <div className="card">
        <h2>Reading your CV...</h2>
        <p className="muted">
          {waited > 30
            ? "This is taking a while. It's waiting for the background worker, which may be off right now. You can wait, or carry on by hand."
            : "This usually takes under a minute."}
        </p>
        {waited > 30 ? (
          <div>
            <button
              type="button"
              onClick={() => {
                abort.current?.abort();
                setStep("review");
              }}
            >
              Enter my details by hand
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Start from your CV</h2>
      <p className="muted">Upload a CV to get a proposed library of your jobs, facts and qualifications, then review it. The file itself isn't kept.</p>
      {notice ? <div className="notice bad">{notice}</div> : null}
      <form action={upload} className="stack">
        <label>
          CV (PDF or Word .docx, up to 5 MB)
          <input name="file" type="file" accept=".pdf,.docx" required />
        </label>
        <div className="row">
          <button className="primary" type="submit">
            Upload and read
          </button>
          <button type="button" onClick={() => setStep("review")}>
            Enter my details by hand
          </button>
        </div>
      </form>
    </div>
  );
}
