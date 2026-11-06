"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CvStyle, Resume } from "@cvtailor/core";
import { setTrackerStatus } from "@/app/actions";
import { CvSheet } from "@/components/CvSheet";
import { pollCvRequest } from "@/components/CvWait";
import type { CvAllowance } from "@/lib/entitlement";
import { loggedFetch } from "@/lib/log";
import { sourceLabel, STATUS_LABELS, TRACKED_DECISIONS, VIEWS } from "@/lib/views";

export interface BoardRow {
  id: number;
  decision: string;
  score: number | null;
  reason: string | null;
  tier: string | null;
  trackerStatus: string;
  tailorStatus: string;
  tailorError: string | null;
  verified: boolean | null;
  cvStyle: CvStyle | null;
  title: string;
  company: string;
  original: string | null;
  apply: string | null;
  locationQuote: string;
  instructions: string[];
  hasPosting: boolean;
  /** A CV being written for this job right now. */
  requestId: number | null;
}

interface Detail {
  resume: Resume | null;
  hasLetter: boolean;
  posting: { text: string | null; mustHaves: string[]; source: string };
  job: { title: string; company: string; apply: string | null };
}

function failureText(row: BoardRow): string | null {
  if (row.tailorStatus !== "failed") return null;
  switch (row.tailorError) {
    case "failed_fact_check":
      return "A CV for this role kept including things that aren't in your library, so it wasn't delivered. You can still apply.";
    case "daily_limit":
      return "You'd reached the daily limit for writing CVs. Try again tomorrow.";
    case "not_entitled":
      return "You'd run out of CVs when this was requested. It didn't use one up.";
    case "timed_out":
      return "Writing this CV took too long, so we stopped. Try again, and it won't use up a CV.";
    default:
      return "A CV couldn't be written for this role. You can still apply.";
  }
}

export function MatchBoard(props: {
  viewKey: string;
  rows: BoardRow[];
  initialSelected: number | null;
  initialDetail: Detail | null;
  defaultStyle: CvStyle;
  allowance: CvAllowance;
  lastRun: string | null;
  gaps: string[];
  notes: string[];
  closeCalls: { company: string; title: string; reason: string; link?: string }[];
  sources: string[];
}) {
  const { viewKey, defaultStyle, allowance } = props;
  const canWrite = allowance.unlimited || allowance.left > 0;
  const router = useRouter();
  const view = VIEWS[viewKey]!;
  const [rows, setRows] = useState(props.rows);
  const [selected, setSelected] = useState(props.initialSelected);
  const [details, setDetails] = useState<Map<number, Detail>>(() => new Map(props.initialSelected && props.initialDetail ? [[props.initialSelected, props.initialDetail]] : []));
  const [postOpen, setPostOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [errors, setErrors] = useState<Map<number, string>>(new Map());
  const [lastResume, setLastResume] = useState<Resume | null>(props.initialDetail?.resume ?? null);
  const postRef = useRef<HTMLDivElement>(null);
  const polling = useRef(new Set<number>());

  // Server data wins after a refresh, such as a CV that finished while this page was open.
  useEffect(() => setRows(props.rows), [props.rows]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async (id: number, force = false) => {
    if (!force && details.has(id)) return details.get(id)!;
    const res = await loggedFetch(`/api/matches/${id}`);
    if (!res.ok) return null;
    const d = (await res.json()) as Detail;
    setDetails((m) => new Map(m).set(id, d));
    return d;
  }, [details]);

  const row = rows.find((r) => r.id === selected) ?? null;
  const detail = selected ? (details.get(selected) ?? null) : null;

  const pick = (id: number) => {
    setSelected(id);
    setPostOpen(false);
    history.replaceState(null, "", `/dashboard?view=${viewKey}&job=${id}`);
    void load(id);
  };

  // Keep the same page on screen while the next one loads, so the CV can be seen changing.
  useEffect(() => {
    if (detail?.resume) setLastResume(detail.resume);
  }, [detail]);

  // Until the details arrive, go by the status, so the posting doesn't flash across the CV.
  const hasCv = row ? (detail ? Boolean(detail.resume) : row.tailorStatus === "rendered") && row.tailorStatus !== "failed" : false;
  const open = !hasCv || postOpen;

  useEffect(() => {
    if (!postOpen) return;
    postRef.current?.focus({ preventScroll: true });
    if (innerWidth <= 1100) postRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPostOpen(false);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [postOpen]);

  const follow = useCallback(
    async (id: number, requestId: number) => {
      if (polling.current.has(id)) return;
      polling.current.add(id);
      const result = await pollCvRequest(requestId);
      polling.current.delete(id);
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, requestId: null } : r)));
      if (result.status === "done") {
        await load(id, true);
        setPostOpen(false);
        setToast("Your CV is ready");
      } else if (result.error) {
        setErrors((m) => new Map(m).set(id, result.error!));
      }
      router.refresh();
    },
    [load, router],
  );

  // A tab switch doesn't wait on the server for these, so the list shows sooner. Fetch them here.
  useEffect(() => {
    if (selected && !details.has(selected)) void load(selected);
  }, [selected, details, load]);

  // Pick up anything still being written when the page opens.
  useEffect(() => {
    for (const r of props.rows) if (r.requestId) void follow(r.id, r.requestId);
  }, [props.rows, follow]);

  const generate = async (r: BoardRow) => {
    setErrors((m) => {
      const n = new Map(m);
      n.delete(r.id);
      return n;
    });
    const res = await loggedFetch("/api/cv-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ matchId: r.id }) });
    const body = (await res.json().catch(() => ({}))) as { requestId?: number; error?: string };
    if (!res.ok || !body.requestId) {
      setErrors((m) => new Map(m).set(r.id, body.error ?? "Couldn't start that. Try again shortly."));
      return;
    }
    setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, requestId: body.requestId!, tailorStatus: "pending", tailorError: null } : x)));
    void follow(r.id, body.requestId);
  };

  const changeStatus = async (r: BoardRow, status: string) => {
    const moved = { ...r, trackerStatus: status };
    const stays = view.holds({ decision: r.decision, tracker_status: status });
    setRows((rs) => (stays ? rs.map((x) => (x.id === r.id ? moved : x)) : rs.filter((x) => x.id !== r.id)));
    if (!stays && selected === r.id) {
      const next = rows.find((x) => x.id !== r.id)?.id ?? null;
      setSelected(next);
      setPostOpen(false);
      if (next) void load(next);
    }
    setToast(`Moved to ${STATUS_LABELS[status]}`);
    const result = await setTrackerStatus(r.id, status);
    if (!result.ok) setToast(result.message ?? "Couldn't update that.");
    router.refresh();
  };

  const genButton = (r: BoardRow) => {
    if (hasCv && r.id === selected) return null;
    if (r.tailorStatus === "rendered") return null;
    if (r.requestId) {
      return (
        <button className="gen" type="button" disabled>
          <i className="spinner" />
          Writing your CV
        </button>
      );
    }
    if (!r.hasPosting) return null;
    if (!canWrite) {
      return (
        <Link className="button dark" href="/pricing">
          Get more CVs
        </Link>
      );
    }
    return (
      <button className="dark" type="button" onClick={() => void generate(r)}>
        {r.tailorStatus === "failed" ? "Try writing the CV again" : "Write my CV"}
      </button>
    );
  };

  const genHint = (r: BoardRow) => {
    if (r.tailorStatus === "rendered" || (hasCv && r.id === selected)) return null;
    if (r.requestId) {
      return <p className="hint">This can take a minute or two. You can leave this page, and the CV will be here when it's ready.</p>;
    }
    if (!r.hasPosting) {
      return (
        <p className="hint">
          We don't have this posting's text. Copy it from the original, then <Link href={`/write?match=${r.id}`}>paste it to write a CV</Link>.
        </p>
      );
    }
    if (!canWrite) return <p className="hint">You've used all your CVs. Your matches stay free.</p>;
    return (
      <p className="hint">
        We'll write it from this posting and your library, and check it before you see it.
        {allowance.unlimited ? null : ` This uses 1 of your ${allowance.left} CVs, and you get it back if it can't be written.`}
      </p>
    );
  };

  const shownResume = detail?.resume ?? lastResume;
  const style = row?.cvStyle ?? defaultStyle;

  return (
    <div className="board">
      <section className="list" aria-live="polite">
        <div className="list-top">
          <h1>{view.label}</h1>
          {props.lastRun ? <span>Last run {props.lastRun}</span> : null}
        </div>
        <p className="sub">{view.sub}</p>
        {viewKey === "to_apply" ? (
          <>
            {props.gaps.map((g) => (
              <div className="notice warn" key={g}>
                {g}
              </div>
            ))}
            {props.notes.map((n) => (
              <div className="notice" key={n}>
                {n}
              </div>
            ))}
          </>
        ) : null}

        {rows.length === 0 ? <p className="empty">{!props.lastRun && viewKey === "to_apply" ? "Your first results will appear after the next daily run. They usually land in the morning, at the time set in your settings." : view.empty}</p> : null}

        {rows.map((r) => {
          const on = r.id === selected;
          const failure = failureText(r);
          const asked = errors.get(r.id);
          const tracked = TRACKED_DECISIONS.includes(r.decision);
          return (
            <article className={`jb ${on ? "on" : ""}`} key={r.id}>
              <button className="plain hd" type="button" aria-expanded={on} onClick={() => pick(r.id)}>
                <span>{r.title}</span>
                {r.score != null ? <b aria-label={`Score ${r.score} out of 10`}>{r.score}</b> : null}
              </button>
              {on ? (
                <div className="mo">
                  <div className="cm">{r.company}</div>
                  {(r.tier && r.tier !== "core") || r.verified === false || r.tailorStatus === "failed" ? (
                    <div className="tags">
                      {r.tier && r.tier !== "core" ? <span className="chip">Tier {r.tier.toUpperCase()}</span> : null}
                      {r.verified === false ? <span className="chip bad">Unverified</span> : null}
                      {r.tailorStatus === "failed" ? <span className="chip bad">No CV</span> : null}
                    </div>
                  ) : null}
                  {r.reason ? <p className="why">{r.reason}</p> : null}
                  {r.locationQuote ? <p className="loc">Location: {r.locationQuote}</p> : null}
                  {r.instructions.length ? <div className="notice warn">The posting asks applicants: {r.instructions.join(" ")}</div> : null}
                  {failure && !r.requestId && !asked ? <div className="notice bad">{failure}</div> : null}
                  {asked ? <div className="notice bad">{asked}</div> : null}
                  <div className="acts">
                    {r.apply ? (
                      <a className="button primary" href={r.apply} target="_blank" rel="noreferrer">
                        Apply
                      </a>
                    ) : null}
                    {hasCv ? (
                      <>
                        <button type="button" aria-expanded={postOpen} onClick={() => setPostOpen((v) => !v)}>
                          {postOpen ? "Back to CV" : "View job"}
                        </button>
                        <Link className="button" href={`/matches/${r.id}`}>
                          Edit CV
                        </Link>
                        <a className="button" href={`/api/documents/${r.id}?kind=resume`}>
                          Download PDF
                        </a>
                        {detail?.hasLetter ? (
                          <a className="button" href={`/api/documents/${r.id}?kind=cover_letter`}>
                            Cover letter
                          </a>
                        ) : null}
                      </>
                    ) : null}
                    {genButton(r)}
                    {tracked ? (
                      <select aria-label="Application status" value={r.trackerStatus} onChange={(e) => void changeStatus(r, e.target.value)}>
                        {Object.entries(STATUS_LABELS).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                  {genHint(r)}
                </div>
              ) : null}
            </article>
          );
        })}

        {props.closeCalls.length ? (
          <div className="close">
            <h2>Close calls</h2>
            {props.closeCalls.map((c) => (
              <p key={`${c.company}${c.title}`}>
                {c.link ? (
                  <a href={c.link} target="_blank" rel="noreferrer">
                    {c.title}, {c.company}.
                  </a>
                ) : (
                  `${c.title}, ${c.company}.`
                )}{" "}
                {c.reason}
              </p>
            ))}
          </div>
        ) : null}
        {props.sources.length ? <p className="src">Sources searched: {props.sources.join(", ")}.</p> : null}
      </section>

      <section className="pane" aria-label="CV and job posting">
        {row ? (
          <div className={`box ${open ? "open" : ""} ${hasCv ? "" : "nocv"}`}>
            {shownResume ? <CvSheet resume={shownResume} style={style} label={`Your CV for ${row.title}`} /> : null}
            <div className="post" ref={postRef} tabIndex={-1}>
              {row.requestId ? (
                <div className="genbar">
                  <i className="spinner" />
                  <span>Writing your CV from this posting. It will appear here when it's ready.</span>
                </div>
              ) : null}
              <div className="ph">
                <div>
                  <h2>{row.title}</h2>
                  <div className="cc">{row.company}</div>
                </div>
                {hasCv ? (
                  <button type="button" onClick={() => setPostOpen(false)}>
                    Back to CV
                  </button>
                ) : null}
              </div>
              {detail?.posting.mustHaves.length ? (
                <>
                  <h3>Must-haves</h3>
                  <ul>
                    {detail.posting.mustHaves.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              <h3>The posting</h3>
              {/* Posting text is untrusted, so it only ever appears as plain text. */}
              <div className="tx">{detail ? (detail.posting.text ?? "We don't have the text of this posting. Open the original to read it.") : "Loading..."}</div>
              {row.original ? (
                <a className="lk" href={row.original} target="_blank" rel="noreferrer">
                  Open the original posting
                </a>
              ) : null}
              {sourceLabel(detail?.posting.source) ? <span className="from">Found through {sourceLabel(detail?.posting.source)}.</span> : null}
              {!hasCv && !row.requestId ? (
                row.hasPosting ? (
                  canWrite ? (
                    <div className="postgen">
                      <button className="dark" type="button" onClick={() => void generate(row)}>
                        {row.tailorStatus === "failed" ? "Try writing the CV again" : "Write my CV"}
                      </button>
                    </div>
                  ) : (
                    <div className="postgen">
                      <Link className="button dark" href="/pricing">
                        Get more CVs
                      </Link>
                    </div>
                  )
                ) : (
                  <div className="postgen">
                    <Link className="button dark" href={`/write?match=${row.id}`}>
                      Paste the posting to write a CV
                    </Link>
                  </div>
                )
              ) : null}
            </div>
          </div>
        ) : (
          <div className="sheet blank">Choose a job to see its CV.</div>
        )}
      </section>
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
