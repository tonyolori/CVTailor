"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CV_STYLES, verifyResume, type CvStyle, type FactLibrary, type Resume, type VerifyIssue } from "@cvtailor/core";
import { addToLibrary, saveResumeVersion, setMatchCvStyle } from "@/app/actions";
import { CvSheet } from "@/components/CvSheet";
import { loggedFetch } from "@/lib/log";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export interface VersionMeta {
  id: number;
  source: string;
  created_at: string;
  json: Resume;
}

/** What "add to my library" should do for a warning, when the warning has a simple answer. */
export function libraryAction(issue: VerifyIssue, resume: Resume): { skill?: string; fact?: { text: string; org: string } } | null {
  const skill = issue.path.match(/^skills\[(\d+)\]\.items\[(\d+)\]$/);
  if (skill) return { skill: resume.skills[Number(skill[1])]?.items[Number(skill[2])] ?? "" };
  const bullet = issue.path.match(/^experience\[(\d+)\]\.bullets\[(\d+)\]$/);
  if (bullet && /^Number /.test(issue.message)) {
    const x = resume.experience[Number(bullet[1])];
    return x ? { fact: { text: x.bullets[Number(bullet[2])] ?? "", org: x.company } } : null;
  }
  return null;
}

/** Bullets can be blank while being typed. Saving and previewing use only the written ones. */
const written = (bullets: string[]) => bullets.map((b) => b.trim()).filter(Boolean);
function tidy(r: Resume): Resume {
  const out = clone(r);
  out.experience.forEach((x) => (x.bullets = written(x.bullets)));
  out.projects.forEach((p) => (p.bullets = written(p.bullets)));
  return out;
}

function BulletRows({ items, label, warned, onChange }: { items: string[]; label: string; warned: (n: number) => boolean; onChange: (next: string[]) => void }) {
  const set = (fn: (b: string[]) => void) => {
    const next = [...items];
    fn(next);
    onChange(next);
  };
  return (
    <>
      {items.map((b, n) => (
        <div className="bl" key={n}>
          <input className={warned(n) ? "off" : ""} aria-label={`${label}, bullet ${n + 1}`} value={b} onChange={(e) => set((x) => void (x[n] = e.target.value))} />
          <div className="blb">
            <button type="button" aria-label={`Move bullet ${n + 1} up`} disabled={n === 0} onClick={() => set((x) => void ([x[n - 1], x[n]] = [x[n]!, x[n - 1]!]))}>
              &uarr;
            </button>
            <button type="button" aria-label={`Move bullet ${n + 1} down`} disabled={n === items.length - 1} onClick={() => set((x) => void ([x[n + 1], x[n]] = [x[n]!, x[n + 1]!]))}>
              &darr;
            </button>
            <button type="button" aria-label={`Remove bullet ${n + 1}`} onClick={() => set((x) => void x.splice(n, 1))}>
              &times;
            </button>
          </div>
        </div>
      ))}
      <div>
        <button className="link" type="button" onClick={() => set((x) => void x.push(""))}>
          Add a bullet
        </button>
      </div>
    </>
  );
}

/**
 * Form-based editing with a live preview. Checks here are advice, never a block: this is
 * the user's own CV. Only AI drafts are held to the verifier as a hard rule.
 */
export function ResumeEditor({
  matchId,
  title,
  company,
  apply,
  back,
  hasLetter,
  initial,
  versions: initialVersions,
  library,
  defaultStyle,
  initialStyle,
}: {
  matchId: number;
  title: string;
  company: string;
  apply: string | null;
  back: { href: string; label: string };
  hasLetter: boolean;
  initial: Resume;
  versions: VersionMeta[];
  library: FactLibrary;
  defaultStyle: CvStyle;
  initialStyle: CvStyle | null;
}) {
  const [resume, setResume] = useState<Resume>(clone(initial));
  const [versions, setVersions] = useState(initialVersions);
  const [lib, setLib] = useState(library);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, startSave] = useTransition();
  const [pages, setPages] = useState<number | null>(null);
  const [override, setOverride] = useState<CvStyle | null>(initialStyle);
  const requestId = useRef(0);
  const style = override ?? defaultStyle;

  const update = (fn: (r: Resume) => void) => {
    setStatus({ ok: true, text: "Unsaved changes" });
    setResume((prev) => {
      const next = clone(prev);
      fn(next);
      return next;
    });
  };

  const clean = useMemo(() => tidy(resume), [resume]);
  const warnings = useMemo(() => verifyResume(clean, lib).issues, [clean, lib]);
  const warnedBullet = (i: number, n: number) => warnings.some((w) => w.path === `experience[${i}].bullets[${n}]`);

  // The real page count comes from rendering the real PDF, a moment after typing stops.
  const countPages = useCallback(
    async (doc: Resume) => {
      const id = ++requestId.current;
      const res = await loggedFetch(`/api/resume/preview?style=${style}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) }).catch(() => null);
      if (res?.ok && id === requestId.current) setPages(Number(res.headers.get("x-pdf-pages")) || null);
    },
    [style],
  );
  useEffect(() => {
    const t = setTimeout(() => void countPages(clean), 600);
    return () => clearTimeout(t);
  }, [clean, countPages]);

  const save = () =>
    startSave(async () => {
      const r = await saveResumeVersion(matchId, clean);
      setStatus({ ok: r.ok, text: r.message ?? "" });
      if (r.ok && r.versionId) setVersions((v) => [{ id: r.versionId!, source: "user", created_at: new Date().toISOString(), json: clone(clean) }, ...v]);
    });

  const changeStyle = async (value: string) => {
    const next = (value || null) as CvStyle | null;
    setOverride(next);
    const r = await setMatchCvStyle(matchId, next);
    if (!r.ok) setStatus({ ok: false, text: r.message ?? "" });
  };

  const aiDraft = versions.find((v) => v.source === "ai");
  const s = resume.summarySuggestion;

  return (
    <div className="ed">
      <section className="edl">
        <div className="edtop">
          <Link className="back" href={back.href}>
            Back to {back.label}
          </Link>
          <h1>{title}</h1>
          <div className="cm">{company}</div>
          <div className="acts" style={{ marginTop: 10 }}>
            <button className="primary" type="button" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save this version"}
            </button>
            {aiDraft ? (
              <button
                type="button"
                onClick={() => {
                  setResume(clone(aiDraft.json));
                  setStatus({ ok: true, text: "Back to the AI draft. Save to keep it." });
                }}
              >
                Revert to AI draft
              </button>
            ) : null}
            <a className="button" href={`/api/documents/${matchId}?kind=resume`}>
              Download PDF
            </a>
            {hasLetter ? (
              <a className="button" href={`/api/documents/${matchId}?kind=cover_letter`}>
                Cover letter
              </a>
            ) : null}
            {apply ? (
              <a className="button" href={apply} target="_blank" rel="noreferrer">
                Apply
              </a>
            ) : null}
            {status ? (
              <span className="edst" role="status" style={status.ok ? undefined : { color: "var(--bad)" }}>
                {status.text}
              </span>
            ) : null}
          </div>
        </div>

        {s ? (
          <details className="sec">
            <summary>
              Summary suggestions <small className="muted">(not on the CV)</small>
            </summary>
            <dl className="sg">
              <dt>Describe yourself as</dt>
              <dd>{s.identity}</dd>
              <dt>Lead with</dt>
              <dd>{s.hook}</dd>
              <dt>Tie it to</dt>
              <dd>{s.fit}</dd>
              {s.keywords.length ? (
                <>
                  <dt>Work in</dt>
                  <dd>{s.keywords.join(", ")}</dd>
                </>
              ) : null}
              {s.leaveOut.length ? (
                <>
                  <dt>Leave out</dt>
                  <dd>{s.leaveOut.join(", ")}</dd>
                </>
              ) : null}
            </dl>
          </details>
        ) : null}

        <div className="sec">
          <label>
            Title under your name
            <input value={resume.header.roleTitle} onChange={(e) => update((r) => void (r.header.roleTitle = e.target.value))} />
          </label>
          <label>
            Summary
            <textarea rows={4} value={resume.summary} onChange={(e) => update((r) => void (r.summary = e.target.value))} />
          </label>
        </div>

        <div className="sec">
          <h2>Skills</h2>
          {resume.skills.map((g, i) => (
            <div className="two" key={i}>
              <label>
                Group
                <input value={g.group} onChange={(e) => update((r) => void (r.skills[i]!.group = e.target.value))} />
              </label>
              <label>
                Items, separated by commas
                <input
                  key={g.items.join(",")}
                  defaultValue={g.items.join(", ")}
                  onBlur={(e) =>
                    update((r) => {
                      const items = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
                      r.skills[i]!.items = items.length ? items : r.skills[i]!.items;
                    })
                  }
                />
              </label>
            </div>
          ))}
          <div>
            <button className="link" type="button" onClick={() => update((r) => void r.skills.push({ group: "New group", items: ["Skill"] }))}>
              Add a group
            </button>
          </div>
        </div>

        <div className="sec">
          <h2>Experience</h2>
          {resume.experience.map((x, i) => (
            <div className="role-e" key={i}>
              <div className="two four">
                <label>
                  Title
                  <input value={x.title} onChange={(e) => update((r) => void (r.experience[i]!.title = e.target.value))} />
                </label>
                <label>
                  Employer
                  <input value={x.company} onChange={(e) => update((r) => void (r.experience[i]!.company = e.target.value))} />
                </label>
                <label>
                  Start
                  <input value={x.start} onChange={(e) => update((r) => void (r.experience[i]!.start = e.target.value))} />
                </label>
                <label>
                  End (blank if current)
                  <input value={x.end ?? ""} onChange={(e) => update((r) => void (r.experience[i]!.end = e.target.value || null))} />
                </label>
              </div>
              <BulletRows items={x.bullets} label={x.title} warned={(n) => warnedBullet(i, n)} onChange={(next) => update((r) => void (r.experience[i]!.bullets = next))} />
            </div>
          ))}
        </div>

        {resume.projects.length ? (
          <div className="sec">
            <h2>Projects</h2>
            {resume.projects.map((p, i) => (
              <div className="role-e" key={i}>
                <b>{p.name}</b>
                <BulletRows items={p.bullets} label={p.name} warned={() => false} onChange={(next) => update((r) => void (r.projects[i]!.bullets = next))} />
              </div>
            ))}
          </div>
        ) : null}

        {warnings.length ? (
          <div className="sec">
            <h2>Worth checking</h2>
            <p className="muted">These aren't in your library. You can keep them, but make sure you can stand behind them in an interview.</p>
            {warnings.map((w, i) => {
              const action = libraryAction(w, clean);
              return (
                <div className="chk" key={`${w.path}${i}`}>
                  <span className="overflow-wrap">{w.message}</span>
                  {action ? (
                    <button
                      type="button"
                      onClick={async () => {
                        const r = await addToLibrary(action);
                        setStatus({ ok: r.ok, text: r.message ?? "" });
                        if (r.ok) {
                          setLib((l) => {
                            const next = clone(l);
                            if (action.skill) next.skills.push(action.skill);
                            const entry = action.fact && next.entries.find((e) => e.org.toLowerCase() === action.fact!.org.toLowerCase());
                            if (entry) entry.facts.push({ id: `user-${Date.now()}`, text: action.fact!.text, designCapacity: false });
                            return next;
                          });
                        }
                      }}
                    >
                      Add to my library
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        <details className="sec">
          <summary>
            Version history <small className="muted">({versions.length})</small>
          </summary>
          {versions.map((v) => (
            <div className="ver" key={v.id}>
              <span>
                {new Date(v.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC, {v.source === "ai" ? "AI draft" : "Your edit"}
              </span>
              <div>
                <button
                  className="link"
                  type="button"
                  onClick={() => {
                    setResume(clone(v.json));
                    setStatus({ ok: true, text: "Version loaded. Save to keep it." });
                  }}
                >
                  Load
                </button>
                <a href={`/api/documents/${matchId}?kind=resume&version=${v.id}`}>PDF</a>
              </div>
            </div>
          ))}
        </details>
      </section>

      <section className="edr" aria-label="CV preview">
        <div className="bar">
          <label>
            CV style
            <select value={override ?? ""} onChange={(e) => void changeStyle(e.target.value)}>
              <option value="">My default ({CV_STYLES.find((c) => c.id === defaultStyle)?.label})</option>
              {CV_STYLES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {pages ? <span className={`chip ${pages > 2 ? "warn" : ""}`}>{pages} page{pages === 1 ? "" : "s"}</span> : null}
        </div>
        <CvSheet resume={clean} style={style} label="CV preview" />
      </section>
    </div>
  );
}
