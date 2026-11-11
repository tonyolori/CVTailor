"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CvStyle, Resume } from "@cvtailor/core";
import { setTrackerStatus } from "@/app/actions";
import { CvSheet } from "@/components/CvSheet";
import { pollCvRequest } from "@/components/CvWait";
import type { CvAllowance } from "@/lib/entitlement";
import { loggedFetch } from "@/lib/log";
import { MATCH_LEVELS, sourceLabel, STAGE_KEYS, STAGES, stageOf, STATUS_LABELS } from "@/lib/views";

export interface BoardRow {
  id: number;
  decision: string;
  reason: string | null;
  trackerStatus: string;
  tailorStatus: string;
  tailorError: string | null;
  cvStyle: CvStyle | null;
  title: string;
  company: string;
  /** Town and way of working, as one short line. */
  where: string;
  /** When the match was made, in words, and in full for a hover title. */
  found: string;
  foundExact: string;
  original: string | null;
  apply: string | null;
  locationQuote: string;
  instructions: string[];
  hasPosting: boolean;
  /** A CV being written for this job right now. */
  requestId: number | null;
}

export interface Detail {
  resume: Resume | null;
  hasLetter: boolean;
  posting: { text: string | null; mustHaves: string[]; source: string };
  job: { title: string; company: string; apply: string | null };
}

interface Toast {
  text: string;
  /** Puts a moved job back where it was. */
  undo?: () => void;
}

function failureText(row: BoardRow): string | null {
  if (row.tailorStatus !== "failed") return null;
  switch (row.tailorError) {
    case "failed_fact_check":
      return "A CV for this role kept including things that aren't in your profile, so it wasn't delivered. You can still apply.";
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

const LEVEL_FILTERS: [string, string][] = [
  ["all", "Every match"],
  ["picked", "Strong matches"],
  ["worth-a-look", "Close matches"],
  ["unscored", "Not scored"],
  ["pasted", "Added by you"],
];

function Level({ decision }: { decision: string }) {
  const level = MATCH_LEVELS[decision];
  if (!level) return null;
  return <span className={`lvl ${level.tone}`}>{level.label}</span>;
}

function Outbound() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

export function JobsBoard(props: {
  stageKey: string;
  rows: BoardRow[];
  counts: Record<string, number>;
  initialSelected: number | null;
  initialDetail: Detail | null;
  /** On a phone the panel covers the list, so it opens only when a link asked for one job. */
  initialOpen: boolean;
  defaultStyle: CvStyle;
  allowance: CvAllowance;
  lastRun: string | null;
  gaps: string[];
  notes: string[];
  closeCalls: { company: string; title: string; reason: string; link?: string }[];
  sources: string[];
}) {
  const { stageKey, defaultStyle, allowance } = props;
  const canWrite = allowance.unlimited || allowance.left > 0;
  const router = useRouter();
  const stage = STAGES[stageKey]!;
  const [rows, setRows] = useState(props.rows);
  const [counts, setCounts] = useState(props.counts);
  const [selected, setSelected] = useState(props.initialSelected);
  const [open, setOpen] = useState(props.initialOpen);
  const [details, setDetails] = useState<Map<number, Detail>>(() => new Map(props.initialSelected && props.initialDetail ? [[props.initialSelected, props.initialDetail]] : []));
  const [tab, setTab] = useState<"cv" | "posting" | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [errors, setErrors] = useState<Map<number, string>>(new Map());
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const polling = useRef(new Set<number>());
  const panelRef = useRef<HTMLElement>(null);

  // Server data wins after a refresh, such as a CV that finished while this page was open.
  useEffect(() => setRows(props.rows), [props.rows]);
  useEffect(() => setCounts(props.counts), [props.counts]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // On a phone the panel is a full screen of its own, so Escape and the close button both leave it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open]);

  const load = useCallback(
    async (id: number, force = false) => {
      if (!force && details.has(id)) return details.get(id)!;
      const res = await loggedFetch(`/api/matches/${id}`);
      if (!res.ok) return null;
      const d = (await res.json()) as Detail;
      setDetails((m) => new Map(m).set(id, d));
      return d;
    },
    [details],
  );

  const row = rows.find((r) => r.id === selected) ?? null;
  const detail = selected ? (details.get(selected) ?? null) : null;
  // Until the details arrive, go by the status, so the panel doesn't flash the wrong tab.
  const hasCv = row ? row.tailorStatus !== "failed" && (detail ? Boolean(detail.resume) : row.tailorStatus === "rendered") : false;
  const shownTab = tab ?? (hasCv ? "cv" : "posting");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => (level === "all" || r.decision === level) && (!q || r.title.toLowerCase().includes(q) || r.company.toLowerCase().includes(q)));
  }, [rows, query, level]);

  const pick = (id: number) => {
    setSelected(id);
    setOpen(true);
    setTab(null);
    setAsking(null);
    history.replaceState(null, "", `/dashboard?view=${stageKey}&job=${id}`);
    void load(id);
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
  };

  const follow = useCallback(
    async (id: number, requestId: number) => {
      if (polling.current.has(id)) return;
      polling.current.add(id);
      const result = await pollCvRequest(requestId);
      polling.current.delete(id);
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, requestId: null } : r)));
      if (result.status === "done") {
        await load(id, true);
        setTab("cv");
        setToast({ text: "Your CV is ready" });
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

  const changeStatus = async (r: BoardRow, status: string, undoable = true) => {
    const from = r.trackerStatus;
    if (from === status) return;
    const index = rows.findIndex((x) => x.id === r.id);
    const stays = stage.statuses.includes(status);
    const moved = { ...r, trackerStatus: status };
    setAsking(null);
    setRows((rs) => (stays ? rs.map((x) => (x.id === r.id ? moved : x)) : rs.filter((x) => x.id !== r.id)));
    setCounts((c) => {
      const to = stageOf(status);
      const was = stageOf(from);
      return to === was ? c : { ...c, [was]: Math.max(0, (c[was] ?? 1) - 1), [to]: (c[to] ?? 0) + 1 };
    });
    if (!stays && selected === r.id) {
      const next = shown.find((x) => x.id !== r.id)?.id ?? null;
      setSelected(next);
      setOpen(false);
      setTab(null);
      if (next) void load(next);
    }
    const undo = undoable
      ? () => {
          setRows((rs) => (rs.some((x) => x.id === r.id) ? rs.map((x) => (x.id === r.id ? r : x)) : [...rs.slice(0, index), r, ...rs.slice(index)]));
          setSelected(r.id);
          void changeStatus(moved, from, false);
        }
      : undefined;
    setToast({ text: status === "dismissed" ? "Moved to Closed" : `Moved to ${STAGES[stageOf(status)]!.label}`, undo });
    const result = await setTrackerStatus(r.id, status);
    if (!result.ok) setToast({ text: result.message ?? "Couldn't update that." });
    router.refresh();
  };

  const style = row?.cvStyle ?? defaultStyle;
  const failure = row ? failureText(row) : null;
  const asked = row ? errors.get(row.id) : undefined;

  const actions = (r: BoardRow) => {
    const notForMe =
      r.trackerStatus === "to_apply" ? (
        <button className="quiet" type="button" onClick={() => void changeStatus(r, "dismissed")}>
          Not for me
        </button>
      ) : null;
    if (r.requestId) {
      return (
        <>
          <div className="acts">
            <button className="primary" type="button" disabled>
              <i className="spinner" />
              Writing your CV
            </button>
          </div>
          <p className="hint">This takes a minute or two. Every line is checked against your profile. You can leave this page.</p>
        </>
      );
    }
    if (hasCv) {
      return (
        <div className="acts">
          {r.apply ? (
            <a className="button primary" href={r.apply} target="_blank" rel="noreferrer" onClick={() => r.trackerStatus === "to_apply" && setAsking(r.id)}>
              Apply
              <Outbound />
            </a>
          ) : null}
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
          {notForMe}
        </div>
      );
    }
    if (!r.hasPosting) {
      return (
        <>
          <div className="acts">
            <Link className="button primary" href={`/write?match=${r.id}`}>
              Paste the posting
            </Link>
            {notForMe}
          </div>
          <p className="hint">We don't have this posting's text. Copy it from the original and paste it in, and we'll write the CV from that.</p>
        </>
      );
    }
    if (!canWrite) {
      return (
        <>
          <div className="acts">
            <Link className="button primary" href="/pricing">
              Get more CVs
            </Link>
            {r.apply ? (
              <a className="button" href={r.apply} target="_blank" rel="noreferrer">
                Apply without one
              </a>
            ) : null}
            {notForMe}
          </div>
          <p className="hint">You've used all your CVs. Your matches stay free.</p>
        </>
      );
    }
    return (
      <>
        <div className="acts">
          <button className="primary" type="button" onClick={() => void generate(r)}>
            {r.tailorStatus === "failed" ? "Try tailoring again" : "Tailor my CV"}
          </button>
          {r.apply ? (
            <a className="button" href={r.apply} target="_blank" rel="noreferrer">
              Apply without one
            </a>
          ) : null}
          {notForMe}
        </div>
        <p className="hint">
          Written from this posting and your profile, and checked before you see it.
          {allowance.unlimited ? null : ` Uses 1 of your ${allowance.left} CVs. If it can't be written, you get it back.`}
        </p>
      </>
    );
  };

  return (
    <div className={`jobs ${rows.length ? "" : "solo"}`}>
      <main className="jobs-main">
        <div className="jobs-head">
          <h1>Jobs</h1>
          <p>
            {props.lastRun ? `Last searched ${props.lastRun}. ` : ""}
            <Link href="/jobs">Browse every open job</Link>
          </p>
        </div>

        <div className="jobs-bar">
          <nav className="stages" aria-label="Stage">
            {STAGE_KEYS.map((k) => (
              <Link key={k} href={`/dashboard?view=${k}`} aria-current={k === stageKey ? "page" : undefined}>
                {STAGES[k]!.label}
                <span>{counts[k] ?? 0}</span>
              </Link>
            ))}
          </nav>
          {props.rows.length ? (
            <div className="jobs-tools">
              <select aria-label="Show" value={level} onChange={(e) => setLevel(e.target.value)}>
                {LEVEL_FILTERS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <input type="search" aria-label="Search jobs" placeholder="Search title or company" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          ) : null}
        </div>

        {shown.length ? (
          <div className="table-wrap">
            <table className="jt">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Match</th>
                  <th className="wide">Where</th>
                  <th>CV</th>
                  <th className="r wide">Found</th>
                </tr>
              </thead>
              <tbody aria-live="polite">
                {shown.map((r) => (
                  <tr key={r.id} className={r.id === selected ? "on" : undefined} onClick={() => pick(r.id)}>
                    <td>
                      <button className="t" type="button" aria-current={r.id === selected ? "true" : undefined} onClick={(e) => (e.stopPropagation(), pick(r.id))}>
                        {r.title}
                      </button>
                      <span className="co">{r.company}</span>
                    </td>
                    <td>
                      <Level decision={r.decision} />
                    </td>
                    <td className="wide">{r.where || "Not stated"}</td>
                    <td>
                      {r.requestId ? (
                        <span className="cvst">
                          <i className="spinner" />
                          Writing
                        </span>
                      ) : r.tailorStatus === "rendered" ? (
                        <span className="cvst ready">Ready</span>
                      ) : r.tailorStatus === "failed" ? (
                        <span className="cvst bad">Not written</span>
                      ) : (
                        <span className="cvst">None yet</span>
                      )}
                    </td>
                    <td className="r wide">
                      <time title={r.foundExact}>{r.found}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="jobs-empty">
            {props.rows.length ? "No jobs here match that search." : !props.lastRun && stageKey === "to_apply" ? "Your first matches arrive after the next morning search, at the time set in Settings. We'll email you." : stage.empty}
          </p>
        )}

        <div className="jobs-foot">
          {props.sources.length ? <p>Searched {props.sources.join(", ")}.</p> : null}
          {props.gaps.length || props.notes.length ? (
            <details>
              <summary>
                {props.gaps.length + props.notes.length === 1 ? "1 note" : `${props.gaps.length + props.notes.length} notes`} on what we can't search yet
              </summary>
              <div>
                {[...props.gaps, ...props.notes].map((g) => (
                  <p key={g}>{g}</p>
                ))}
              </div>
            </details>
          ) : null}
          {props.closeCalls.length ? (
            <details>
              <summary>Close calls ({props.closeCalls.length})</summary>
              <div>
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
            </details>
          ) : null}
        </div>
      </main>

      <aside className={`panel ${open && row ? "open" : ""}`} aria-label="Selected job" ref={panelRef} tabIndex={-1}>
        {row ? (
          <>
            <div className="panel-top">
              <Level decision={row.decision} />
              <button className="x" type="button" aria-label="Close" onClick={() => (setOpen(false), setSelected(null))}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            <div className="panel-head">
              <h2>{row.title}</h2>
              <p>{[row.company, row.where].filter(Boolean).join(" · ")}</p>
            </div>

            <div className="panel-do">
              {actions(row)}
              {asking === row.id ? (
                <div className="ask" role="status">
                  <span>
                    <b>Did you apply?</b> We'll move it to Applied so you can follow it up.
                  </span>
                  <div>
                    <button className="sm" type="button" onClick={() => void changeStatus(row, "applied")}>
                      Yes, I applied
                    </button>
                    <button className="sm quiet" type="button" onClick={() => setAsking(null)}>
                      Not yet
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {row.instructions.length ? (
              <div className="notice asks">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v5M12 16.5v.01" />
                </svg>
                <span>
                  <b>The posting asks applicants:</b> {row.instructions.join(" ")}
                </span>
              </div>
            ) : null}
            {failure && !row.requestId && !asked ? <div className="notice bad">{failure}</div> : null}
            {asked ? <div className="notice bad">{asked}</div> : null}

            <div className="panel-why">
              <h3>{row.decision === "pasted" ? "About this job" : "Why it matches"}</h3>
              <p>{row.reason ?? (row.decision === "unscored" ? "We couldn't score this one. Read the posting and decide for yourself." : row.decision === "pasted" ? "You added this job yourself." : "No reason was recorded for this match.")}</p>
              {row.locationQuote ? <p className="hint">Where, in the posting's words: {row.locationQuote}</p> : null}
            </div>

            <label className="stage">
              Stage
              <select value={row.trackerStatus} onChange={(e) => void changeStatus(row, e.target.value)}>
                {Object.entries(STATUS_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <div className="stages" role="tablist" aria-label="CV and posting">
              {hasCv ? (
                <button type="button" role="tab" aria-selected={shownTab === "cv"} onClick={() => setTab("cv")}>
                  Your CV
                </button>
              ) : null}
              <button type="button" role="tab" aria-selected={shownTab === "posting"} onClick={() => setTab("posting")}>
                The posting
              </button>
            </div>

            {shownTab === "cv" && hasCv ? (
              detail?.resume ? <CvSheet resume={detail.resume} style={style} label={`Your CV for ${row.title}`} /> : <p className="hint">Loading your CV...</p>
            ) : (
              <div className="posting">
                {detail?.posting.mustHaves.length ? (
                  <>
                    <h3>What they ask for</h3>
                    <ul>
                      {detail.posting.mustHaves.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {/* Posting text is untrusted, so it only ever appears as plain text. */}
                <div className="tx">{detail ? (detail.posting.text ?? "We don't have the text of this posting. Open the original to read it.") : "Loading..."}</div>
                {row.original ? (
                  <a href={row.original} target="_blank" rel="noreferrer">
                    Open the original posting
                  </a>
                ) : null}
                {sourceLabel(detail?.posting.source) ? <p className="from">Found through {sourceLabel(detail?.posting.source)}.</p> : null}
              </div>
            )}
          </>
        ) : (
          <p className="panel-none">{shown.length ? "Pick a job to see why it matches, its posting and your CV." : null}</p>
        )}
      </aside>

      {toast ? (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo ? (
            <button type="button" onClick={() => (toast.undo!(), setToast(null))}>
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
