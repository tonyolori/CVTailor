"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FactLibrarySchema, type CvStyle, type FactLibrary } from "@cvtailor/core";
import { giveConsent } from "@/app/actions";
import { ProfileEditor } from "./ProfileEditor";
import { errorFields, log, loggedFetch } from "@/lib/log";

type Step = "choose" | "working" | "review";

/**
 * Step 1: upload a CV for a proposed library, or start from blank. Nothing is saved until the user reviews it.
 * Someone new agrees to how their details are used here, before either path, since both store them.
 */
export function OnboardingLibrary({ email, displayName, consented: alreadyConsented, style }: { email: string; displayName: string; consented: boolean; style: CvStyle }) {
  const blank: FactLibrary = FactLibrarySchema.parse({ contact: { name: displayName, email }, entries: [] });
  const [step, setStep] = useState<Step>("choose");
  const [library, setLibrary] = useState<FactLibrary>(blank);
  const [notice, setNotice] = useState<string | null>(null);
  const [waited, setWaited] = useState(0);
  const [consented, setConsented] = useState(alreadyConsented);
  const [agreed, setAgreed] = useState(alreadyConsented);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  // Counts the seconds while the CV is read, so a slow read can offer the way out.
  useEffect(() => {
    if (step !== "working") return;
    const started = Date.now();
    const t = setInterval(() => setWaited(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [step]);

  // A submit handler, not <form action>: React holds back state set inside a form action until
  // the action ends, which here is the whole extraction, so the waiting screen would never show.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step !== "choose") return;
    void upload(new FormData(event.currentTarget));
  }

  /** Records the agreement once, the first time either path is taken. */
  async function consent(): Promise<boolean> {
    if (consented) return true;
    const r = await giveConsent();
    if (!r.ok) {
      setNotice(r.message ?? "Couldn't save that. Try again.");
      return false;
    }
    setConsented(true);
    return true;
  }

  async function upload(form: FormData) {
    setNotice(null);
    setWaited(0);
    setStep("working");
    if (!(await consent())) return setStep("choose");
    const failed = (message?: string) => {
      setNotice(message ?? "That didn't work. You can enter your details by hand.");
      setStep("choose");
    };
    abort.current = new AbortController();
    try {
      const res = await loggedFetch("/api/onboarding/extract", { method: "POST", body: form, signal: abort.current.signal });
      const body = (await res.json().catch(() => ({}))) as { error?: string; library?: unknown };
      if (!res.ok || body.error || !body.library) return failed(body.error);
      return accept(body.library);
    } catch (err) {
      if (abort.current.signal.aborted) return;
      log("onboarding.upload_failed", errorFields(err), "error");
      failed();
    }
  }

  function enterByHand() {
    abort.current?.abort();
    setStep("review");
  }

  async function startByHand() {
    setNotice(null);
    if (await consent()) setStep("review");
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
        <div className="notice">This is what we read from your CV. Click any part to fix it, and remove anything you wouldn't say in an interview, because CVs can only use what's here.</div>
        <ProfileEditor initial={library} style={style} next="/onboarding/preferences" saveLabel="Save and continue" />
      </div>
    );
  }

  if (step === "working") {
    return (
      <div className="card" role="status" aria-live="polite" style={{ maxWidth: 640 }}>
        <div className="row">
          <span className="spinner" aria-hidden="true" />
          <h2>Reading your CV...</h2>
        </div>
        <p className="muted">
          {waited >= 45
            ? `Still reading after ${waited} seconds. A long CV can take a couple of minutes. You can keep waiting, or carry on by hand.`
            : "This usually takes under a minute. Stay on this page while it works."}
        </p>
        {waited >= 45 ? (
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
    <div className="card" style={{ maxWidth: 640 }}>
      <h2>Start from your CV</h2>
      <p className="muted">Upload a CV to get a proposed library of your jobs, facts and qualifications, then review it. The file itself isn't kept.</p>
      {notice ? <div className="notice bad">{notice}</div> : null}
      <form onSubmit={submit} className="stack">
        <label>
          CV (PDF or Word .docx, up to 4 MB)
          <input name="file" type="file" accept=".pdf,.docx" required />
        </label>
        {consented ? null : (
          <div className="consent">
            <p>
              To find roles and write your CVs, CV Tailor keeps the work history and preferences you give it, and sends them with each job posting to an AI model. You can export or delete everything from your settings at any time. <Link href="/privacy?from=/onboarding">How we handle your data</Link>
            </p>
            <label className="check">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              I agree to CV Tailor using my details this way
            </label>
          </div>
        )}
        <div className="row">
          <button className="primary" type="submit" disabled={!agreed}>
            Upload and read
          </button>
          <button type="button" onClick={() => void startByHand()} disabled={!agreed}>
            Enter my details by hand
          </button>
        </div>
      </form>
    </div>
  );
}
