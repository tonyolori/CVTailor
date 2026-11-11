"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { dateRange, FactLibrarySchema, SECTION_TITLES, titlesFromLibrary, type CvStyle, type FactEntry, type FactLibrary } from "@cvtailor/core";
import { saveFacts } from "@/app/actions";

/** What the side panel is editing. Nothing picked shows the checklist. */
type Pick = { kind: "contact" } | { kind: "entry"; id: string } | { kind: "credential"; id: string } | { kind: "skills" } | { kind: "languages" } | null;

type Kind = FactEntry["kind"];

const KIND: Record<Kind, { label: string; title: string; org: string; section: "experience" | "projects" | "education" | "volunteering" }> = {
  role: { label: "Job", title: "Job title", org: "Employer", section: "experience" },
  project: { label: "Project", title: "What you did", org: "Project name", section: "projects" },
  education: { label: "Education", title: "Qualification", org: "School or university", section: "education" },
  volunteering: { label: "Volunteering", title: "Role", org: "Organisation", section: "volunteering" },
};
const ORDER: Kind[] = ["role", "education", "project", "volunteering"];

/** A fact longer than this reads as a paragraph on a CV. */
const LONG_FACT = 220;

let seq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`;

const blankEntry = (kind: Kind): FactEntry => ({ id: newId("entry"), kind, title: "", org: "", facts: [], variants: [], doNotClaim: [], notes: [], tags: [] });

interface Check {
  text: string;
  pick: Pick;
}

/** Things that make CVs weaker, worth fixing first. */
function checklist(lib: FactLibrary): Check[] {
  const out: Check[] = [];
  for (const e of lib.entries) {
    const name = e.title || KIND[e.kind].label;
    if ((e.kind === "role" || e.kind === "project" || e.kind === "volunteering") && e.facts.length === 0) {
      out.push({ text: `${name} has no facts yet, so CVs can't say anything about it.`, pick: { kind: "entry", id: e.id } });
    }
    const long = e.facts.filter((f) => f.text.length > LONG_FACT).length;
    if (long) out.push({ text: `${name} has ${long === 1 ? "a long fact" : `${long} long facts`}. One achievement per fact makes sharper CVs.`, pick: { kind: "entry", id: e.id } });
  }
  if (!lib.entries.some((e) => e.kind === "role")) out.push({ text: "Add the jobs you've had. They're what most CVs are built from.", pick: null });
  if (!lib.contact.phone) out.push({ text: "No phone number. Many employers expect one on a CV.", pick: { kind: "contact" } });
  return out;
}

/** The first problem that stops a save, in words, and where to fix it. */
function firstProblem(lib: FactLibrary): { text: string; pick: Pick } | null {
  if (!lib.contact.name.trim()) return { text: "Add your name.", pick: { kind: "contact" } };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lib.contact.email)) return { text: "Add the email address to put on your CVs.", pick: { kind: "contact" } };
  for (const e of lib.entries) {
    if (!e.title.trim()) return { text: `This ${KIND[e.kind].label.toLowerCase()} needs a ${KIND[e.kind].title.toLowerCase()}.`, pick: { kind: "entry", id: e.id } };
    if (!e.org.trim()) return { text: `Add the ${KIND[e.kind].org.toLowerCase()} for ${e.title}.`, pick: { kind: "entry", id: e.id } };
  }
  for (const c of lib.credentials) if (!c.name.trim()) return { text: "A licence or certification needs a name.", pick: { kind: "credential", id: c.id } };
  for (const l of [...lib.contact.links]) if (!/^https?:\/\//.test(l.url)) return { text: `The link "${l.label}" needs a full web address, starting https://`, pick: { kind: "contact" } };
  return null;
}

/** Empty lines and facts dropped, so a half-typed row doesn't block a save. */
function tidy(lib: FactLibrary): FactLibrary {
  const clean = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);
  return {
    ...lib,
    contact: { ...lib.contact, links: lib.contact.links.filter((l) => l.label.trim() || l.url.trim()) },
    entries: lib.entries.map((e) => ({ ...e, facts: e.facts.map((f) => ({ ...f, text: f.text.trim() })).filter((f) => f.text), variants: clean(e.variants), doNotClaim: clean(e.doNotClaim), tags: clean(e.tags) })),
    skills: clean(lib.skills),
    languages: lib.languages.filter((l) => l.name.trim()),
  };
}

function Block({ on, label, onPick, children, className = "" }: { on: boolean; label: string; onPick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`blk ${on ? "on" : ""} ${className}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={on}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
    >
      {children}
    </div>
  );
}

/** A list of short lines edited one row each, such as facts or ready-made bullets. */
function LineList({ items, onChange, add, placeholder, warnAt }: { items: string[]; onChange: (next: string[]) => void; add: string; placeholder: string; warnAt?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const added = useRef(false);
  // A row just added gets the cursor, so typing goes straight into it.
  useEffect(() => {
    if (!added.current) return;
    added.current = false;
    const rows = box.current?.querySelectorAll("textarea");
    rows?.[rows.length - 1]?.focus();
  }, [items.length]);
  return (
    <div className="ll" ref={box}>
      {items.map((text, i) => (
        <div className="ll-row" key={i}>
          <div className="ll-field">
            <textarea
              rows={Math.min(5, Math.max(2, Math.ceil(text.length / 48)))}
              value={text}
              placeholder={placeholder}
              aria-label={`${placeholder} ${i + 1}`}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            />
            {warnAt && text.length > warnAt ? <span className="ll-warn">Long. Could this be two facts?</span> : null}
          </div>
          <div className="ll-tools">
            <button type="button" className="ico" aria-label="Move up" disabled={i === 0} onClick={() => onChange(items.map((x, j) => (j === i - 1 ? items[i]! : j === i ? items[i - 1]! : x)))}>
              ↑
            </button>
            <button type="button" className="ico" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="sm add"
        onClick={() => {
          added.current = true;
          onChange([...items, ""]);
        }}
      >
        + {add}
      </button>
    </div>
  );
}

/**
 * The fact library, shown as a CV page in the person's own style. Clicking any part opens it in
 * the side panel. Everything saves together, the same as before.
 */
export function ProfileEditor({ initial, style, next, saveLabel = "Save changes" }: { initial: FactLibrary; style: CvStyle; next?: string; saveLabel?: string }) {
  const [lib, setLib] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pick, setPick] = useState<Pick>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const panelRef = useRef<HTMLElement>(null);
  const dirty = lib !== saved;
  const checks = useMemo(() => checklist(lib), [lib]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);

  const choose = (p: Pick) => {
    setPick(p);
    setMessage(null);
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
  };
  const is = (p: NonNullable<Pick>) => pick?.kind === p.kind && ("id" in p ? (pick as { id?: string }).id === p.id : true);

  const update = (patch: Partial<FactLibrary>) => setLib((l) => ({ ...l, ...patch }));
  const setContact = (patch: Partial<FactLibrary["contact"]>) => setLib((l) => ({ ...l, contact: { ...l.contact, ...patch } }));
  const setEntry = (id: string, patch: Partial<FactEntry>) => setLib((l) => ({ ...l, entries: l.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  const addEntry = (kind: Kind) => {
    const e = blankEntry(kind);
    setLib((l) => ({ ...l, entries: [e, ...l.entries] }));
    choose({ kind: "entry", id: e.id });
  };
  const addCredential = () => {
    const id = newId("credential");
    setLib((l) => ({ ...l, credentials: [...l.credentials, { id, name: "" }] }));
    choose({ kind: "credential", id });
  };

  const save = () => {
    const ready = tidy(lib);
    const problem = firstProblem(ready);
    if (problem) {
      setMessage({ ok: false, text: problem.text });
      setPick(problem.pick);
      return;
    }
    const parsed = FactLibrarySchema.safeParse(ready);
    if (!parsed.success) {
      setMessage({ ok: false, text: "Something here can't be saved yet. Check the part you changed last." });
      return;
    }
    start(async () => {
      const r = await saveFacts(parsed.data, next);
      if (r.ok) {
        setLib(parsed.data);
        setSaved(parsed.data);
      }
      setMessage({ ok: r.ok, text: r.ok ? "Saved. Your next CVs will use this." : (r.message ?? "Couldn't save.") });
    });
  };

  const heading = titlesFromLibrary(lib, 1)[0] ?? "";
  const contactLine = [lib.contact.location, lib.contact.phone, lib.contact.email, ...lib.contact.links.map((l) => l.label)].filter(Boolean).join(", ");
  const entriesOf = (kind: Kind) => lib.entries.filter((e) => e.kind === kind);
  const entry = pick?.kind === "entry" ? lib.entries.find((e) => e.id === pick.id) : undefined;
  const credential = pick?.kind === "credential" ? lib.credentials.find((c) => c.id === pick.id) : undefined;

  const entryBlock = (e: FactEntry) => (
    <Block key={e.id} on={is({ kind: "entry", id: e.id })} label={`Edit ${e.title || KIND[e.kind].label}`} onPick={() => choose({ kind: "entry", id: e.id })} className="ent">
      <div className="eh">
        <b>{e.title || <i className="ph">{KIND[e.kind].title}</i>}</b>
        <span>{dateRange(e.start, e.end, e.kind !== "education")}</span>
      </div>
      <div className="org">{[e.org, e.location].filter(Boolean).join(", ") || <i className="ph">{KIND[e.kind].org}</i>}</div>
      {e.kind === "education" ? null : e.facts.length ? (
        <ul>
          {e.facts.map((f) => (
            <li key={f.id} className={f.text.length > LONG_FACT ? "long" : undefined}>
              {f.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ph">No facts yet. Click to add what you did here.</p>
      )}
    </Block>
  );

  return (
    <div className="pe">
      <div className="pe-doc">
        <div className="pe-add" role="group" aria-label="Add to your profile">
          <span>Add</span>
          {ORDER.map((k) => (
            <button key={k} type="button" className="sm" onClick={() => addEntry(k)}>
              {KIND[k].label}
            </button>
          ))}
          <button type="button" className="sm" onClick={addCredential}>
            Licence or certificate
          </button>
        </div>

        <div className="sheet" data-style={style}>
          <div className="cvi">
            <Block on={is({ kind: "contact" })} label="Edit your contact details" onPick={() => choose({ kind: "contact" })}>
              <div className="nm">{lib.contact.name || <i className="ph">Your name</i>}</div>
              {heading ? <div className="hl">{heading}</div> : null}
              <div className="ct">{contactLine || <i className="ph">Where you live, phone, email</i>}</div>
            </Block>

            {(["role", "project", "volunteering", "education"] as Kind[]).map((k) =>
              entriesOf(k).length ? (
                <section key={k}>
                  <h4>{SECTION_TITLES[KIND[k].section]}</h4>
                  {entriesOf(k).map(entryBlock)}
                </section>
              ) : null,
            )}

            {lib.credentials.length ? (
              <section>
                <h4>{SECTION_TITLES.credentials}</h4>
                {lib.credentials.map((c) => (
                  <Block key={c.id} on={is({ kind: "credential", id: c.id })} label={`Edit ${c.name || "this licence"}`} onPick={() => choose({ kind: "credential", id: c.id })} className="ent">
                    <div className="eh">
                      <b>{c.name || <i className="ph">Name</i>}</b>
                      <span>{c.year}</span>
                    </div>
                    {c.issuer || c.reference ? <div className="org">{[c.issuer, c.reference].filter(Boolean).join(", ")}</div> : null}
                  </Block>
                ))}
              </section>
            ) : null}

            <section>
              <h4>{SECTION_TITLES.skills}</h4>
              <Block on={is({ kind: "skills" })} label="Edit your skills" onPick={() => choose({ kind: "skills" })}>
                <p>{lib.skills.length ? lib.skills.join(", ") : <i className="ph">Skills you can show</i>}</p>
              </Block>
            </section>

            <section>
              <h4>{SECTION_TITLES.languages}</h4>
              <Block on={is({ kind: "languages" })} label="Edit your languages" onPick={() => choose({ kind: "languages" })}>
                <p>{lib.languages.length ? lib.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(", ") : <i className="ph">Languages you speak</i>}</p>
              </Block>
            </section>
          </div>
        </div>
      </div>

      <aside className={`pe-panel ${pick ? "open" : ""}`} ref={panelRef} tabIndex={-1} aria-label="Edit">
        {pick ? (
          <div className="pe-top">
            <button type="button" className="sm quiet" onClick={() => setPick(null)}>
              ← Checklist
            </button>
          </div>
        ) : null}

        {!pick ? (
          <div className="pe-sec">
            <h2>Click any part of the page to change it</h2>
            <p className="muted">This is everything a CV can say about you. For each job we pick the facts that fit and reword them, and check every line against this page before you see it.</p>
            {checks.length ? (
              <>
                <h3>Worth fixing</h3>
                <ul className="pe-checks">
                  {checks.map((c) => (
                    <li key={c.text}>
                      {c.pick ? (
                        <button type="button" className="link" onClick={() => choose(c.pick)}>
                          {c.text}
                        </button>
                      ) : (
                        c.text
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="pe-good">Nothing to fix. Your profile is in good shape.</p>
            )}
          </div>
        ) : null}

        {pick?.kind === "contact" ? (
          <div className="pe-sec">
            <h2>Contact details</h2>
            <label>
              Name
              <input value={lib.contact.name} onChange={(e) => setContact({ name: e.target.value })} />
            </label>
            <label>
              Email on your CVs
              <input type="email" value={lib.contact.email} onChange={(e) => setContact({ email: e.target.value })} />
            </label>
            <div className="two">
              <label>
                Phone
                <input value={lib.contact.phone ?? ""} onChange={(e) => setContact({ phone: e.target.value || undefined })} />
              </label>
              <label>
                Where you live
                <input value={lib.contact.location ?? ""} placeholder="Town, country" onChange={(e) => setContact({ location: e.target.value || undefined })} />
              </label>
            </div>
            <fieldset>
              <legend>Links</legend>
              {lib.contact.links.map((l, i) => (
                <div className="pe-link" key={i}>
                  <input aria-label="Link label" placeholder="LinkedIn" value={l.label} onChange={(e) => setContact({ links: lib.contact.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <input aria-label="Web address" placeholder="https://" value={l.url} onChange={(e) => setContact({ links: lib.contact.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                  <button type="button" className="ico" aria-label="Remove link" onClick={() => setContact({ links: lib.contact.links.filter((_, j) => j !== i) })}>
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="sm add" onClick={() => setContact({ links: [...lib.contact.links, { label: "", url: "" }] })}>
                + Add a link
              </button>
            </fieldset>
          </div>
        ) : null}

        {entry ? (
          <div className="pe-sec">
            <h2>{entry.title || `New ${KIND[entry.kind].label.toLowerCase()}`}</h2>
            <div className="seg" role="radiogroup" aria-label="Type">
              {ORDER.map((k) => (
                <label key={k} className={entry.kind === k ? "on" : ""}>
                  <input type="radio" name="kind" checked={entry.kind === k} onChange={() => setEntry(entry.id, { kind: k })} />
                  {KIND[k].label}
                </label>
              ))}
            </div>
            <label>
              {KIND[entry.kind].title}
              <input value={entry.title} onChange={(e) => setEntry(entry.id, { title: e.target.value })} />
            </label>
            <label>
              {KIND[entry.kind].org}
              <input value={entry.org} onChange={(e) => setEntry(entry.id, { org: e.target.value })} />
            </label>
            <div className="two">
              <label>
                From
                <input value={entry.start ?? ""} placeholder="2018-09" onChange={(e) => setEntry(entry.id, { start: e.target.value || undefined })} />
              </label>
              <label>
                To
                <input value={entry.end ?? ""} placeholder={entry.kind === "education" ? "2018" : "Blank if current"} onChange={(e) => setEntry(entry.id, { end: e.target.value || null })} />
              </label>
            </div>
            {entry.kind === "education" ? null : (
              <div className="pe-facts">
                <h3>What you did</h3>
                <p className="hint">One achievement each, with the numbers you can stand behind. Only these can appear on a CV.</p>
                <LineList
                  items={entry.facts.map((f) => f.text)}
                  add="Add a fact"
                  placeholder="Fact"
                  warnAt={LONG_FACT}
                  onChange={(texts) =>
                    setEntry(entry.id, {
                      facts: texts.map((text, i) => ({ id: entry.facts[i]?.id ?? newId(`${entry.id}-f`), text, designCapacity: entry.facts[i]?.designCapacity ?? false })),
                    })
                  }
                />
              </div>
            )}
            <details className="pe-more">
              <summary>More options</summary>
              <label>
                Where
                <input value={entry.location ?? ""} onChange={(e) => setEntry(entry.id, { location: e.target.value || undefined })} />
              </label>
              <div>
                <h3>Never say</h3>
                <p className="hint">Things a CV must not claim about this, such as work someone else led.</p>
                <LineList items={entry.doNotClaim} add="Add a phrase" placeholder="Phrase" onChange={(doNotClaim) => setEntry(entry.id, { doNotClaim })} />
              </div>
              <div>
                <h3>Ready-made bullets</h3>
                <p className="hint">Wording you like, to start from. Optional.</p>
                <LineList items={entry.variants} add="Add a bullet" placeholder="Bullet" onChange={(variants) => setEntry(entry.id, { variants })} />
              </div>
              <label>
                Skills this shows, separated by commas
                <input value={entry.tags.join(", ")} onChange={(e) => setEntry(entry.id, { tags: e.target.value.split(",").map((t) => t.trimStart()) })} />
              </label>
            </details>
            <div>
              <button
                type="button"
                className="sm danger"
                onClick={() => {
                  setLib((l) => ({ ...l, entries: l.entries.filter((x) => x.id !== entry.id) }));
                  setPick(null);
                }}
              >
                Remove this {KIND[entry.kind].label.toLowerCase()}
              </button>
            </div>
          </div>
        ) : null}

        {credential ? (
          <div className="pe-sec">
            <h2>{credential.name || "New licence or certificate"}</h2>
            <p className="hint">CVs list these exactly as written here, and never add one that isn&apos;t.</p>
            {(
              [
                ["name", "Name"],
                ["issuer", "Issued by"],
                ["year", "Year"],
                ["reference", "Licence or registration number (only if you want it on CVs)"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  value={credential[key] ?? ""}
                  onChange={(e) => update({ credentials: lib.credentials.map((c) => (c.id === credential.id ? { ...c, [key]: key === "name" ? e.target.value : e.target.value || undefined } : c)) })}
                />
              </label>
            ))}
            <div>
              <button
                type="button"
                className="sm danger"
                onClick={() => {
                  update({ credentials: lib.credentials.filter((c) => c.id !== credential.id) });
                  setPick(null);
                }}
              >
                Remove this
              </button>
            </div>
          </div>
        ) : null}

        {pick?.kind === "skills" ? (
          <div className="pe-sec">
            <h2>Skills</h2>
            <p className="hint">Skills you can show. The skills on each job count too.</p>
            <LineList items={lib.skills} add="Add a skill" placeholder="Skill" onChange={(skills) => update({ skills })} />
          </div>
        ) : null}

        {pick?.kind === "languages" ? (
          <div className="pe-sec">
            <h2>Languages</h2>
            {lib.languages.map((l, i) => (
              <div className="pe-link" key={i}>
                <input aria-label="Language" placeholder="Language" value={l.name} onChange={(e) => update({ languages: lib.languages.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <input aria-label="Level" placeholder="Level, such as Fluent" value={l.level ?? ""} onChange={(e) => update({ languages: lib.languages.map((x, j) => (j === i ? { ...x, level: e.target.value || undefined } : x)) })} />
                <button type="button" className="ico" aria-label="Remove language" onClick={() => update({ languages: lib.languages.filter((_, j) => j !== i) })}>
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="sm add" onClick={() => update({ languages: [...lib.languages, { name: "" }] })}>
              + Add a language
            </button>
          </div>
        ) : null}

        <div className="pe-save">
          {message ? (
            <p className={message.ok ? "ok" : "bad"} role="status">
              {message.text}
            </p>
          ) : (
            <p>{dirty ? "You have unsaved changes." : "Everything is saved."}</p>
          )}
          <div className="acts">
            <button type="button" className="primary" disabled={pending || (!dirty && !next)} onClick={save}>
              {pending ? "Saving..." : saveLabel}
            </button>
            {dirty ? (
              <button type="button" className="quiet" onClick={() => (setLib(saved), setMessage(null))}>
                Undo changes
              </button>
            ) : null}
            {pick ? (
              <button type="button" className="quiet pe-done" onClick={() => setPick(null)}>
                Done
              </button>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
