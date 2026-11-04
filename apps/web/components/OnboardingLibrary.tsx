"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { FactLibrarySchema, type FactLibrary } from "@cvtailor/core";
import { LibraryEditor } from "./LibraryEditor";
import { cancelTask, pollTask } from "./TaskWait";

type Step = "choose" | "working" | "review";

/** Step 1: upload a CV for a proposed library, or start from blank. Nothing is saved until the user reviews it. */
export function OnboardingLibrary({ email, displayName }: { email: string; displayName: string }) {
  const blank: FactLibrary = FactLibrarySchema.parse({ contact: { name: displayName, email }, entries: [] });
  const [step, setStep] = useState<Step>("choose");
  const [library, setLibrary] = useState<FactLibrary>(blank);
  const [notice, setNotice] = useState<string | null>(null);
  const [waited, setWaited] = useState(0);
  const abort = useRef<AbortController | null>(null);

  const taskId = useRef<number | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  // A submit handler, not <form action>: React holds back state set inside a form action until
  // the action ends, which here is the whole extraction, so the waiting screen would never show.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step !== "choose") return;
    void upload(new FormData(event.currentTarget));
  }

  async function upload(form: FormData) {
    setNotice(null);
    setWaited(0);
    setStep("working");
    const failed = (message?: string) => {
      setNotice(message ?? "That didn't work. You can enter your details by hand.");
      setStep("choose");
    };
    try {
      const res = await fetch("/api/onboarding/extract", { method: "POST", body: form });
      const body = (await res.json()) as { error?: string; library?: unknown; taskId?: number };
      if (!res.ok || body.error) return failed(body.error);
      if (body.library) return accept(body.library);
      taskId.current = body.taskId!;
      abort.current = new AbortController();
      const done = await pollTask<unknown>(body.taskId!, setWaited, abort.current.signal);
      if (done.status === "done") return accept(done.output);
      if (done.status !== "cancelled") failed(done.error);
    } catch {
      failed();
    }
  }

  function enterByHand() {
    abort.current?.abort();
    if (taskId.current !== null) void cancelTask(taskId.current);
    setStep("review");
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
      <div className="card" role="status" aria-live="polite">
        <div className="row">
          <span className="spinner" aria-hidden="true" />
          <h2>Reading your CV...</h2>
        </div>
        <p className="muted">
          {waited >= 30
            ? `Still waiting after ${waited} seconds. This step needs the background worker, which may be busy or off. You can keep waiting, or carry on by hand.`
            : "This usually takes under a minute. You can stay on this page while it works."}
        </p>
        {waited >= 30 ? (
          <div>
            <button type="button" onClick={enterByHand}>
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
      <form onSubmit={submit} className="stack">
        <label>
          CV (PDF or Word .docx, up to 4 MB)
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
