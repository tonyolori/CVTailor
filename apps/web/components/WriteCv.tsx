"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CvAllowance } from "@/lib/entitlement";
import { loggedFetch } from "@/lib/log";

export interface WritePrefill {
  title: string;
  company: string;
  link: string;
  text: string;
}

/**
 * Add a job by pasting its posting. The CV is written on the Jobs screen, which shows it being
 * written and opens it when it's ready, the same as for any match.
 */
export function WriteCv({
  allowance,
  forMatch,
  prefill = null,
}: {
  allowance: CvAllowance;
  forMatch: { id: number; title: string; company: string } | null;
  /** A job picked from All jobs, filled in as if pasted, so it's written the same way. */
  prefill?: WritePrefill | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(prefill?.text ?? "");
  const [title, setTitle] = useState(forMatch?.title ?? prefill?.title ?? "");
  const [company, setCompany] = useState(forMatch?.company ?? prefill?.company ?? "");
  const [link, setLink] = useState(prefill?.link ?? "");

  // A slow request: set from onSubmit, not a form action, so the waiting state shows at once.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await loggedFetch("/api/cv-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, title, company, link, ...(forMatch ? { matchId: forMatch.id } : {}) }),
    });
    const body = (await res.json().catch(() => ({}))) as { requestId?: number; matchId?: number; error?: string };
    if (!res.ok || !body.requestId || !body.matchId) {
      setError(body.error ?? "Couldn't start that. Try again shortly.");
      setBusy(false);
      return;
    }
    router.push(`/dashboard?job=${body.matchId}`);
  };

  const outOfCvs = !allowance.unlimited && allowance.left === 0;

  return (
    <main className="page narrow-page">
      <div className="stack" style={{ gap: 8 }}>
        <h1>{forMatch ? `Paste the posting for ${forMatch.title}` : "Add a job"}</h1>
        <p className="muted">
          {forMatch
            ? "We don't have this posting's text. Copy it from the original and paste it here."
            : prefill
              ? "We've filled this in from All jobs. Check it, then we'll write a CV for it."
              : "Found a job somewhere else? Paste the posting and we'll write a CV for it from your profile."}
        </p>
      </div>

      {outOfCvs ? (
        <div className="stack">
          <div className="notice">You've used all your CVs. Your matches stay free.</div>
          <div>
            <Link className="button primary" href="/pricing">
              Get more CVs
            </Link>
          </div>
        </div>
      ) : (
        <form className="stack" style={{ gap: 16 }} onSubmit={(e) => void submit(e)}>
          {error ? (
            <div className="notice bad" role="alert">
              {error}
            </div>
          ) : null}
          <label>
            The posting
            <textarea className="big" required placeholder="Paste the whole job posting here" value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="two">
            <label>
              <span>
                Job title <span className="opt">(optional)</span>
              </span>
              <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              <span>
                Company <span className="opt">(optional)</span>
              </span>
              <input value={company} maxLength={120} onChange={(e) => setCompany(e.target.value)} />
            </label>
          </div>
          {forMatch ? null : (
            <label>
              <span>
                Link to apply <span className="opt">(optional, it becomes your Apply button)</span>
              </span>
              <input type="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
            </label>
          )}
          <div className="acts">
            <button className="primary" type="submit" disabled={busy}>
              {busy ? <i className="spinner" /> : null}
              {busy ? "Adding" : "Add and tailor my CV"}
            </button>
            <Link className="button quiet" href="/dashboard">
              Cancel
            </Link>
          </div>
          <p className="hint">
            We only use what you paste, and we won't open the link. Every CV is checked against your profile before you see it.
            {allowance.unlimited ? null : ` This uses 1 of your ${allowance.left} CVs. If it can't be written, you get it back.`}
          </p>
        </form>
      )}
    </main>
  );
}
