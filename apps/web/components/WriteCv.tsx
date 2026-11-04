"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CvStyle, Resume } from "@jobtailor/core";
import { CvSheet } from "@/components/CvSheet";
import { pollTask } from "@/components/TaskWait";
import type { CvAllowance } from "@/lib/entitlement";

type Stage = "form" | "working" | "done";

const STILL_WAITING = "It's taking longer than usual. We'll keep going, and your CV will appear under Pasted jobs when it's ready.";

export function WriteCv({ allowance, style, forMatch }: { allowance: CvAllowance; style: CvStyle; forMatch: { id: number; title: string; company: string } | null }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("form");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState(forMatch?.title ?? "");
  const [company, setCompany] = useState(forMatch?.company ?? "");
  const [link, setLink] = useState("");
  const [matchId, setMatchId] = useState<number | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);
  const [hasLetter, setHasLetter] = useState(false);
  const [job, setJob] = useState<{ title: string; company: string; apply: string | null } | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/cv-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, title, company, link, ...(forMatch ? { matchId: forMatch.id } : {}) }),
    });
    const body = (await res.json().catch(() => ({}))) as { taskId?: number; matchId?: number; error?: string };
    if (!res.ok || !body.taskId || !body.matchId) {
      setError(body.error ?? "Couldn't start that. Try again shortly.");
      return;
    }
    setMatchId(body.matchId);
    setStage("working");
    router.refresh();

    abort.current = new AbortController();
    const result = await pollTask<{ matchId: number }>(body.taskId, undefined, abort.current.signal, STILL_WAITING);
    if (result.status === "cancelled") return;
    if (result.status !== "done") {
      setError(result.error ?? "We couldn't write this CV just now. Try again in a little while.");
      setStage("form");
      router.refresh();
      return;
    }
    const detail = await fetch(`/api/matches/${body.matchId}`);
    const d = detail.ok ? ((await detail.json()) as { resume: Resume | null; hasLetter: boolean; job: { title: string; company: string; apply: string | null } }) : null;
    setResume(d?.resume ?? null);
    setJob(d?.job ?? null);
    setHasLetter(Boolean(d?.hasLetter));
    setStage("done");
    router.refresh();
  };

  const another = () => {
    setStage("form");
    setText("");
    setTitle("");
    setCompany("");
    setLink("");
    setMatchId(null);
    setResume(null);
    setJob(null);
    setError(null);
    if (forMatch) router.replace("/write");
  };

  return (
    <div className="write">
      <section className="list" aria-live="polite">
        {stage === "form" ? (
          <>
            <h1>Write a CV for any job</h1>
            <p className="sub" style={{ marginBottom: 16 }}>
              {forMatch ? `Paste the posting for ${forMatch.title} and we'll write a CV for it, using only what's in your library.` : "Found a job somewhere else? Paste it here and we'll write a CV for it, using only what's in your library."}
            </p>
            {!allowance.unlimited && allowance.left === 0 && stage === "form" && !matchId ? (
              <div className="stack">
                <div className="notice">You've used all your CVs. Your matches stay free.</div>
                <div>
                  <Link className="button primary" href="/pricing">
                    Get more CVs
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={(e) => void submit(e)}>
                {error ? (
                  <div className="notice bad" role="alert">
                    {error}
                  </div>
                ) : null}
                <label>
                  The job posting
                  <textarea className="big" required placeholder="Paste the full job posting here" value={text} onChange={(e) => setText(e.target.value)} />
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
                      Link to the job <span className="opt">(optional, for your Apply button)</span>
                    </span>
                    <input type="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
                  </label>
                )}
                <div>
                  <button className="primary" type="submit">
                    Write my CV
                  </button>
                </div>
                <p className="hint" style={{ marginTop: 0 }}>
                  We check every CV against your library before you see it. We only use what you paste, and we won't open the link.
                  {allowance.unlimited ? null : ` This uses 1 of your ${allowance.left} CVs, and you get it back if it can't be written.`}
                </p>
              </form>
            )}
          </>
        ) : null}

        {stage === "working" ? (
          <>
            <h1>Write a CV for any job</h1>
            {title ? <div className="ptit" style={{ marginTop: 22 }}>{title}</div> : null}
            <div className="genbar" style={{ marginTop: 14 }}>
              <i className="spinner" />
              <span>Writing your CV. This can take a minute or two. You can leave this page, and it will be waiting {forMatch ? "on the job" : "under Pasted jobs"}.</span>
            </div>
          </>
        ) : null}

        {stage === "done" ? (
          <>
            <p className="pok">Your CV is ready and checked against your library.</p>
            <div className="ptit">{job?.title || title}</div>
            {job?.company ? <div className="cm" style={{ marginTop: 6 }}>{job.company}</div> : null}
            <div className="acts">
              {matchId ? (
                <>
                  {job?.apply ? (
                    <a className="button primary" href={job.apply} target="_blank" rel="noreferrer">
                      Apply
                    </a>
                  ) : null}
                  <Link className={`button ${job?.apply ? "" : "primary"}`} href={`/matches/${matchId}`}>
                    Edit CV
                  </Link>
                  <a className="button" href={`/api/documents/${matchId}?kind=resume`}>
                    Download PDF
                  </a>
                  {hasLetter ? (
                    <a className="button" href={`/api/documents/${matchId}?kind=cover_letter`}>
                      Cover letter
                    </a>
                  ) : null}
                  <Link className="button" href={forMatch ? `/dashboard?job=${matchId}` : `/dashboard?view=pasted&job=${matchId}`}>
                    {forMatch ? "Back to the job" : "See it under Pasted jobs"}
                  </Link>
                </>
              ) : null}
            </div>
            <p style={{ marginTop: 14 }}>
              <button className="link" type="button" onClick={another}>
                Write a CV for another job
              </button>
            </p>
          </>
        ) : null}
      </section>

      <section className="pane" aria-label="Your CV">
        {stage === "done" && resume ? (
          <div className="box">
            <CvSheet resume={resume} style={style} label="Your new CV" />
          </div>
        ) : (
          <div className="sheet blank">
            {stage === "working" ? (
              <div className="skel" aria-hidden="true">
                {Array.from({ length: 15 }, (_, i) => (
                  <i key={i} />
                ))}
              </div>
            ) : (
              "Your CV will appear here."
            )}
          </div>
        )}
      </section>
    </div>
  );
}
