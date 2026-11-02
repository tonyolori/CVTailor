"use client";

import { useState, useTransition } from "react";
import type { FactEntry, FactLibrary } from "@jobtailor/core";
import { saveFacts } from "@/app/actions";

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const commas = (s: string) => s.split(",").map((l) => l.trim()).filter(Boolean);

const EMPTY_ENTRY = (): FactEntry => ({
  id: `entry-${Date.now()}`,
  kind: "role",
  title: "",
  org: "",
  facts: [],
  variants: [],
  doNotClaim: [],
  notes: [],
  tags: [],
});

function EntryEditor({ entry, onChange, onRemove }: { entry: FactEntry; onChange: (e: FactEntry) => void; onRemove: () => void }) {
  const set = (patch: Partial<FactEntry>) => onChange({ ...entry, ...patch });
  return (
    <fieldset>
      <legend>{entry.title || "New entry"}{entry.org ? `, ${entry.org}` : ""}</legend>
      <div className="grid2">
        <label>
          Type
          <select value={entry.kind} onChange={(e) => set({ kind: e.target.value as FactEntry["kind"] })}>
            <option value="role">Job</option>
            <option value="project">Project</option>
            <option value="education">Education</option>
            <option value="volunteering">Volunteering</option>
          </select>
        </label>
        <label>
          {entry.kind === "education" ? "Qualification" : "Title"}
          <input value={entry.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label>
          {entry.kind === "education" ? "School" : entry.kind === "project" ? "Project name" : "Employer or organisation"}
          <input value={entry.org} onChange={(e) => set({ org: e.target.value })} />
        </label>
        <label>
          Start (YYYY-MM)
          <input value={entry.start ?? ""} onChange={(e) => set({ start: e.target.value || undefined })} />
        </label>
        <label>
          End (blank if current)
          <input value={entry.end ?? ""} onChange={(e) => set({ end: e.target.value || null })} />
        </label>
      </div>
      <label>
        Facts, one per line. Only these can appear on a CV, so include the numbers you can stand behind.
        <textarea
          rows={Math.max(3, entry.facts.length + 1)}
          value={entry.facts.map((f) => f.text).join("\n")}
          onChange={(e) =>
            set({
              facts: lines(e.target.value).map((text, i) => ({
                id: entry.facts[i]?.id ?? `${entry.id}-f${i + 1}`,
                text,
                designCapacity: entry.facts[i]?.designCapacity ?? false,
              })),
            })
          }
        />
      </label>
      <label>
        Ready-made CV bullets, one per line (optional)
        <textarea value={entry.variants.join("\n")} onChange={(e) => set({ variants: lines(e.target.value) })} />
      </label>
      <label>
        Never claim, one per line. Phrases a CV must not say about this, such as work someone else did.
        <textarea value={entry.doNotClaim.join("\n")} onChange={(e) => set({ doNotClaim: lines(e.target.value) })} />
      </label>
      <label>
        Tags, comma-separated: skills and topics this shows
        <input value={entry.tags.join(", ")} onChange={(e) => set({ tags: commas(e.target.value) })} />
      </label>
      <div>
        <button type="button" className="danger" onClick={onRemove}>
          Remove this entry
        </button>
      </div>
    </fieldset>
  );
}

/** Review and edit the fact library, whether proposed from a CV or written by hand. */
export function LibraryEditor({ initial, next, saveLabel = "Save" }: { initial: FactLibrary; next?: string; saveLabel?: string }) {
  const [lib, setLib] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<FactLibrary>) => setLib({ ...lib, ...patch });
  const setContact = (patch: Partial<FactLibrary["contact"]>) => set({ contact: { ...lib.contact, ...patch } });

  const save = () =>
    start(async () => {
      const r = await saveFacts(lib, next);
      setMessage({ ok: r.ok, text: r.message ?? "" });
    });

  return (
    <div className="stack">
      <div className="card">
        <h2>Contact</h2>
        <div className="grid2">
          <label>
            Name
            <input value={lib.contact.name} onChange={(e) => setContact({ name: e.target.value })} />
          </label>
          <label>
            Email on your CV
            <input type="email" value={lib.contact.email} onChange={(e) => setContact({ email: e.target.value })} />
          </label>
          <label>
            Phone
            <input value={lib.contact.phone ?? ""} onChange={(e) => setContact({ phone: e.target.value || undefined })} />
          </label>
          <label>
            Location
            <input value={lib.contact.location ?? ""} onChange={(e) => setContact({ location: e.target.value || undefined })} />
          </label>
        </div>
        <label>
          Links, one per line as "Label https://..."
          <textarea
            value={lib.contact.links.map((l) => `${l.label} ${l.url}`).join("\n")}
            onChange={(e) =>
              setContact({
                links: lines(e.target.value).flatMap((l) => {
                  const i = l.lastIndexOf(" ");
                  return i > 0 ? [{ label: l.slice(0, i).trim(), url: l.slice(i + 1).trim() }] : [];
                }),
              })
            }
          />
        </label>
      </div>

      <div className="card">
        <div className="row between">
          <h2>Experience, projects and education</h2>
          <button type="button" onClick={() => set({ entries: [...lib.entries, EMPTY_ENTRY()] })}>
            Add an entry
          </button>
        </div>
        {lib.entries.length === 0 ? <p className="muted">Nothing yet. Add your jobs and qualifications.</p> : null}
        {lib.entries.map((entry, i) => (
          <EntryEditor
            key={entry.id}
            entry={entry}
            onChange={(e) => set({ entries: lib.entries.map((x, j) => (j === i ? e : x)) })}
            onRemove={() => set({ entries: lib.entries.filter((_, j) => j !== i) })}
          />
        ))}
      </div>

      <div className="card">
        <h2>Licences and certifications</h2>
        <p className="muted">One per line as "Name | Issuer | Year". CVs only ever list what's here, exactly as written.</p>
        <textarea
          rows={Math.max(2, lib.credentials.length + 1)}
          value={lib.credentials.map((c) => [c.name, c.issuer ?? "", c.year ?? ""].join(" | ")).join("\n")}
          onChange={(e) =>
            set({
              credentials: lines(e.target.value).map((l, i) => {
                const [name, issuer, year] = l.split("|").map((p) => p.trim());
                return { id: lib.credentials[i]?.id ?? `credential-${i + 1}`, name: name ?? "", issuer: issuer || undefined, year: year || undefined };
              }),
            })
          }
        />
      </div>

      <div className="card">
        <div className="grid2">
          <label>
            Other skills you can show, comma-separated
            <textarea value={lib.skills.join(", ")} onChange={(e) => set({ skills: commas(e.target.value) })} />
          </label>
          <label>
            Languages, one per line as "Language | Level"
            <textarea
              value={lib.languages.map((l) => (l.level ? `${l.name} | ${l.level}` : l.name)).join("\n")}
              onChange={(e) =>
                set({
                  languages: lines(e.target.value).map((l) => {
                    const [name, level] = l.split("|").map((p) => p.trim());
                    return { name: name ?? "", level: level || undefined };
                  }),
                })
              }
            />
          </label>
        </div>
      </div>

      {message ? <div className={`notice ${message.ok ? "ok" : "bad"}`}>{message.text}</div> : null}
      <div>
        <button className="primary" type="button" disabled={pending} onClick={save}>
          {pending ? "Saving..." : saveLabel}
        </button>
      </div>
    </div>
  );
}
