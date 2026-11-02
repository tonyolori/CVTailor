"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { verifyResume, type FactLibrary, type Resume, type VerifyIssue } from "@jobtailor/core";
import { addToLibrary, saveResumeVersion } from "@/app/actions";

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
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

/**
 * Form-based editing with a live preview. Checks here are advice, never a block: this is
 * the user's own CV. Only AI drafts are held to the verifier as a hard rule.
 */
export function ResumeEditor({
  matchId,
  initial,
  versions,
  library,
}: {
  matchId: number;
  initial: Resume;
  versions: VersionMeta[];
  library: FactLibrary;
}) {
  const [resume, setResume] = useState<Resume>(clone(initial));
  const [lib, setLib] = useState(library);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, startSave] = useTransition();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const requestId = useRef(0);

  const update = (fn: (r: Resume) => void) =>
    setResume((prev) => {
      const next = clone(prev);
      fn(next);
      return next;
    });

  const warnings = useMemo(() => verifyResume(resume, lib).issues, [resume, lib]);

  const refreshPreview = useCallback(async (doc: Resume) => {
    const id = ++requestId.current;
    const res = await fetch("/api/resume/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
    if (!res.ok || id !== requestId.current) return;
    setPages(Number(res.headers.get("x-pdf-pages")) || null);
    const url = URL.createObjectURL(await res.blob());
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return url;
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void refreshPreview(resume), 600);
    return () => clearTimeout(t);
  }, [resume, refreshPreview]);

  const save = () =>
    startSave(async () => {
      const r = await saveResumeVersion(matchId, resume);
      setStatus({ ok: r.ok, text: r.message ?? "" });
    });

  const aiDraft = versions.find((v) => v.source === "ai");

  return (
    <div className="split">
      <div className="stack">
        {resume.summarySuggestion ? (
          <details className="card">
            <summary>
              <b>Summary suggestions</b> <small className="muted">(not on the CV)</small>
            </summary>
            <p>
              <b>Describe yourself as:</b> {resume.summarySuggestion.identity}
            </p>
            <p>
              <b>Lead with:</b> {resume.summarySuggestion.hook}
            </p>
            <p>
              <b>Tie it to:</b> {resume.summarySuggestion.fit}
            </p>
            {resume.summarySuggestion.keywords.length ? (
              <p>
                <b>Work in:</b> {resume.summarySuggestion.keywords.join(", ")}
              </p>
            ) : null}
            {resume.summarySuggestion.leaveOut.length ? (
              <p>
                <b>Leave out:</b> {resume.summarySuggestion.leaveOut.join(", ")}
              </p>
            ) : null}
          </details>
        ) : null}

        <div className="card">
          <label>
            Title under your name
            <input value={resume.header.roleTitle} onChange={(e) => update((r) => void (r.header.roleTitle = e.target.value))} />
          </label>
          <label>
            Summary
            <textarea rows={4} value={resume.summary} onChange={(e) => update((r) => void (r.summary = e.target.value))} />
          </label>
        </div>

        <div className="card">
          <h2>Skills</h2>
          {resume.skills.map((g, i) => (
            <div className="grid2" key={i}>
              <label>
                Group
                <input value={g.group} onChange={(e) => update((r) => void (r.skills[i]!.group = e.target.value))} />
              </label>
              <label>
                Items, separated by commas
                <input
                  defaultValue={g.items.join(", ")}
                  onBlur={(e) =>
                    update((r) => {
                      const items = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                      r.skills[i]!.items = items.length ? items : r.skills[i]!.items;
                    })
                  }
                />
              </label>
            </div>
          ))}
          <div>
            <button type="button" onClick={() => update((r) => void r.skills.push({ group: "New group", items: ["Skill"] }))}>
              Add a group
            </button>
          </div>
        </div>

        <div className="card">
          <h2>Experience</h2>
          {resume.experience.map((x, i) => (
            <fieldset key={i}>
              <legend>{x.title}, {x.company}</legend>
              <div className="grid2">
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
              <label>
                Bullets, one per line
                <textarea
                  rows={Math.max(3, x.bullets.length + 1)}
                  defaultValue={x.bullets.join("\n")}
                  onBlur={(e) => update((r) => void (r.experience[i]!.bullets = lines(e.target.value)))}
                />
              </label>
            </fieldset>
          ))}
        </div>

        {resume.projects.length ? (
          <div className="card">
            <h2>Projects</h2>
            {resume.projects.map((p, i) => (
              <label key={i}>
                {p.name}: bullets, one per line
                <textarea defaultValue={p.bullets.join("\n")} onBlur={(e) => update((r) => void (r.projects[i]!.bullets = lines(e.target.value)))} />
              </label>
            ))}
          </div>
        ) : null}

        {warnings.length ? (
          <div className="card">
            <h2>Worth checking</h2>
            <p className="muted">These aren't in your library. You can keep them, but make sure you can stand behind them in an interview.</p>
            {warnings.map((w, i) => {
              const action = libraryAction(w, resume);
              return (
                <div className="notice warn row between" key={`${w.path}${i}`}>
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

        {status ? <div className={`notice ${status.ok ? "ok" : "bad"}`}>{status.text}</div> : null}
        <div className="row">
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
        </div>

        <details className="card">
          <summary>
            <b>Version history</b> <small className="muted">({versions.length})</small>
          </summary>
          {versions.map((v) => (
            <div className="row between" key={v.id}>
              <small>
                {new Date(v.created_at).toLocaleString()} <span className="chip">{v.source === "ai" ? "AI draft" : "Your edit"}</span>
              </small>
              <div className="row">
                <button type="button" onClick={() => setResume(clone(v.json))}>
                  Load
                </button>
                <a className="button" href={`/api/documents/${matchId}?kind=resume&version=${v.id}`}>
                  PDF
                </a>
              </div>
            </div>
          ))}
        </details>
      </div>

      <div className="stack sticky">
        <div className="row between">
          <h2>Preview</h2>
          {pages ? <span className={`chip ${pages > 2 ? "warn" : "ok"}`}>{pages} page{pages === 1 ? "" : "s"}</span> : null}
        </div>
        {previewUrl ? <iframe className="preview" title="CV preview" src={previewUrl} /> : <div className="preview" />}
      </div>
    </div>
  );
}
