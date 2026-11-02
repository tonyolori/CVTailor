"use client";

import { useMemo, useState, useTransition } from "react";
import { regionsOfCountry, Region, type Preferences, type PreferencesInput, type WorkMode } from "@jobtailor/core";
import type { TitleSuggestions } from "@jobtailor/core/prompts";
import { savePreferences } from "@/app/actions";
import { pollTask } from "./TaskWait";

const commas = (s: string) => s.split(",").map((l) => l.trim()).filter(Boolean);

function countryOptions(): { code: string; name: string }[] {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const out: { code: string; name: string }[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const name = names.of(code);
      if (name && name !== code && !/^(EU|UN|EZ|QO|XA|XB|AC|CP|DG|EA|IC|TA|UK|DD|SU|YU|BU|CS|FX|TP|ZR|AN)$/.test(code)) out.push({ code, name });
    }
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

function offsetHours(tz: string): number {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round(((local.getTime() - utc.getTime()) / 3_600_000) * 2) / 2;
}

const REGION_LABELS: Record<string, string> = {
  EU: "European Union",
  EUROPE: "Europe",
  UK: "United Kingdom",
  EMEA: "Europe, Middle East and Africa",
  AFRICA: "Africa",
  NORTH_AMERICA: "North America",
  LATAM: "Latin America",
  APAC: "Asia Pacific",
  MENA: "Middle East and North Africa",
};

const SENIORITY: { value: Preferences["excludeSeniority"][number]; label: string }[] = [
  { value: "intern", label: "Intern" },
  { value: "junior", label: "Junior" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead or manager" },
  { value: "executive", label: "Director and above" },
];

const ROLE_TYPES: { value: string; label: string }[] = [
  { value: "sales", label: "Sales" },
  { value: "commission", label: "Commission-based" },
  { value: "research", label: "Research" },
  { value: "training_work", label: "Rating or writing content to train AI" },
  { value: "gig", label: "Gig work" },
  { value: "internship", label: "Internships" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
];

export function PreferencesForm({
  initial,
  categories,
  tz,
  next,
  saveLabel = "Save",
}: {
  initial: Preferences | null;
  categories: { id: string; label: string }[];
  tz: string;
  next?: string;
  saveLabel?: string;
}) {
  const countries = useMemo(countryOptions, []);
  const [p, setP] = useState<PreferencesInput>(
    initial ?? {
      categories: [],
      targetTitles: [],
      workModes: ["remote"],
      remoteScope: "eligible_regions",
      locations: { countries: [], cities: [] },
      eligibility: { country: "", regions: [], utcOffsetHours: offsetHours(tz), workAuthorization: [] },
      employerBase: null,
      minSalary: null,
      languages: [],
      excludeTitleKeywords: [],
      excludeRoleTypes: [],
      excludeSeniority: [],
      maxYearsRequired: null,
      missingCredentialPolicy: "hard_gate",
    },
  );
  const [titles, setTitles] = useState((p.targetTitles ?? []).join(", "));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [suggesting, setSuggesting] = useState(false);
  const set = (patch: Partial<PreferencesInput>) => setP({ ...p, ...patch });
  const modes = (p.workModes ?? []) as WorkMode[];
  const toggleIn = <T,>(list: T[] | undefined, v: T): T[] => ((list ?? []).includes(v) ? (list ?? []).filter((x) => x !== v) : [...(list ?? []), v]);
  const physical = modes.includes("hybrid") || modes.includes("onsite");
  const exp = p.expansionTitles ?? { a: [], b: [], c: [] };
  const eligibility = p.eligibility!;

  async function suggest() {
    setSuggesting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/onboarding/titles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetTitles: commas(titles) }),
      });
      const body = (await res.json()) as { error?: string; suggestions?: TitleSuggestions; taskId?: number };
      if (body.error) throw new Error(body.error);
      let s = body.suggestions;
      if (!s && body.taskId) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 90_000);
        const done = await pollTask<TitleSuggestions>(body.taskId, undefined, controller.signal).catch(() => ({ status: "cancelled" as const }));
        clearTimeout(timer);
        if (done.status === "done" && "output" in done) s = done.output;
        else if (done.status !== "cancelled" && "error" in done && done.error) throw new Error(done.error);
      }
      if (!s) throw new Error("Suggestions aren't available right now, because the background worker may be off. You can type your own.");
      const valid = new Set(categories.map((c) => c.id));
      set({
        expansionTitles: { a: s.a, b: s.b, c: s.c },
        categories: [...new Set([...(p.categories ?? []), ...s.categories.filter((c) => valid.has(c))])],
      });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Couldn't get suggestions." });
    } finally {
      setSuggesting(false);
    }
  }

  function save() {
    const hasPlaces = (p.locations?.countries?.length ?? 0) + (p.locations?.cities?.length ?? 0) > 0;
    if (!eligibility.country) return setMessage({ ok: false, text: "Choose the country you live in." });
    if (commas(titles).length === 0) return setMessage({ ok: false, text: "Add at least one job title." });
    if (modes.length === 0) return setMessage({ ok: false, text: "Choose at least one way of working." });
    if (physical && !hasPlaces) return setMessage({ ok: false, text: "Add a country or city for hybrid and on-site roles." });
    start(async () => {
      const r = await savePreferences({ ...p, targetTitles: commas(titles) }, next);
      setMessage({ ok: r.ok, text: r.message ?? "" });
    });
  }

  return (
    <div className="stack">
      <div className="card">
        <h2>What you do</h2>
        <label>
          Job titles you want, comma-separated
          <input value={titles} onChange={(e) => setTitles(e.target.value)} placeholder="The titles employers use for your work" />
        </label>
        <div>
          <button type="button" onClick={suggest} disabled={suggesting || commas(titles).length === 0}>
            {suggesting ? "Thinking..." : "Suggest similar titles"}
          </button>
        </div>
        <div className="grid2">
          <label>
            Close titles (same work, other names)
            <textarea value={(exp.a ?? []).join(", ")} onChange={(e) => set({ expansionTitles: { ...exp, a: commas(e.target.value) } })} />
          </label>
          <label>
            Adjacent titles
            <textarea value={(exp.b ?? []).join(", ")} onChange={(e) => set({ expansionTitles: { ...exp, b: commas(e.target.value) } })} />
          </label>
          <label>
            Stretch titles
            <textarea value={(exp.c ?? []).join(", ")} onChange={(e) => set({ expansionTitles: { ...exp, c: commas(e.target.value) } })} />
          </label>
        </div>
        <small className="muted">These are searched only when your main titles find too few good matches.</small>
        <fieldset>
          <legend>Fields</legend>
          <div className="grid2">
            {categories.filter((c) => c.id !== "other").map((c) => (
              <label className="check" key={c.id}>
                <input type="checkbox" checked={(p.categories ?? []).includes(c.id)} onChange={() => set({ categories: toggleIn(p.categories, c.id) })} />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="card">
        <h2>Where and how you work</h2>
        <div className="grid2">
          <label>
            Country you live in
            <select
              value={eligibility.country}
              onChange={(e) =>
                set({
                  eligibility: { ...eligibility, country: e.target.value, regions: e.target.value ? regionsOfCountry(e.target.value) : [] },
                })
              }
            >
              <option value="">Choose...</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Your UTC offset, in hours
            <input
              type="number"
              step="0.5"
              min={-12}
              max={14}
              value={eligibility.utcOffsetHours}
              onChange={(e) => set({ eligibility: { ...eligibility, utcOffsetHours: Number(e.target.value) } })}
            />
          </label>
        </div>
        <fieldset>
          <legend>Ways of working you'd accept</legend>
          <div className="row">
            {(["remote", "hybrid", "onsite"] as WorkMode[]).map((m) => (
              <label className="check" key={m}>
                <input type="checkbox" checked={modes.includes(m)} onChange={() => set({ workModes: toggleIn(modes, m) })} />
                {m === "remote" ? "Remote" : m === "hybrid" ? "Hybrid" : "On-site"}
              </label>
            ))}
          </div>
        </fieldset>
        {modes.includes("remote") ? (
          <label>
            Remote roles
            <select value={p.remoteScope} onChange={(e) => set({ remoteScope: e.target.value as Preferences["remoteScope"] })}>
              <option value="eligible_regions">Open to my country or region</option>
              <option value="worldwide_only">Open to anyone in the world only</option>
              <option value="any">Any remote role. I'll check eligibility myself</option>
            </select>
          </label>
        ) : null}
        {modes.includes("remote") ? (
          <label>
            Other countries where you already have the right to work, as two-letter codes (optional)
            <input
              value={(eligibility.workAuthorization ?? []).join(", ")}
              onChange={(e) => set({ eligibility: { ...eligibility, workAuthorization: commas(e.target.value).map((c) => c.toUpperCase()).filter((c) => c.length === 2) } })}
            />
          </label>
        ) : null}
        {physical ? (
          <div className="grid2">
            <label>
              Countries for hybrid and on-site roles, as two-letter codes
              <input
                value={(p.locations?.countries ?? []).join(", ")}
                onChange={(e) =>
                  set({ locations: { ...p.locations, countries: commas(e.target.value).map((c) => c.toUpperCase()).filter((c) => c.length === 2) } })
                }
              />
            </label>
            <label>
              Cities (optional; leave blank for anywhere in those countries)
              <input value={(p.locations?.cities ?? []).join(", ")} onChange={(e) => set({ locations: { ...p.locations, cities: commas(e.target.value) } })} />
            </label>
          </div>
        ) : null}
        <label>
          Languages you can work in, comma-separated
          <input value={(p.languages ?? []).join(", ")} onChange={(e) => set({ languages: commas(e.target.value) })} />
        </label>
      </div>

      <div className="card">
        <h2>Filters (all optional)</h2>
        <div className="grid2">
          <label>
            Most years of experience a role may ask for
            <input
              type="number"
              min={0}
              max={50}
              value={p.maxYearsRequired ?? ""}
              onChange={(e) => set({ maxYearsRequired: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </label>
          <label>
            Minimum salary
            <input
              type="number"
              min={0}
              value={p.minSalary?.amount ?? ""}
              onChange={(e) =>
                set({ minSalary: e.target.value === "" ? null : { amount: Number(e.target.value), currency: p.minSalary?.currency ?? "USD", period: p.minSalary?.period ?? "year" } })
              }
            />
          </label>
          {p.minSalary ? (
            <>
              <label>
                Currency, three-letter code
                <input maxLength={3} value={p.minSalary.currency} onChange={(e) => set({ minSalary: { ...p.minSalary!, currency: e.target.value.toUpperCase() } })} />
              </label>
              <label>
                Per
                <select value={p.minSalary.period} onChange={(e) => set({ minSalary: { ...p.minSalary!, period: e.target.value as Preferences["minSalary"] extends infer T ? (T extends { period: infer P } ? P & string : never) : never } })}>
                  <option value="year">Year</option>
                  <option value="month">Month</option>
                  <option value="week">Week</option>
                  <option value="day">Day</option>
                  <option value="hour">Hour</option>
                </select>
              </label>
            </>
          ) : null}
        </div>
        <small className="muted">A salary filter only applies when a posting states its pay in the same currency. Otherwise the role stays in.</small>
        <label>
          Leave out titles containing, comma-separated
          <input value={(p.excludeTitleKeywords ?? []).join(", ")} onChange={(e) => set({ excludeTitleKeywords: commas(e.target.value) })} />
        </label>
        <fieldset>
          <legend>Leave out these seniority levels</legend>
          <div className="row">
            {SENIORITY.map((s) => (
              <label className="check" key={s.value}>
                <input type="checkbox" checked={(p.excludeSeniority ?? []).includes(s.value)} onChange={() => set({ excludeSeniority: toggleIn(p.excludeSeniority, s.value) })} />
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Leave out these kinds of role</legend>
          <div className="grid2">
            {ROLE_TYPES.map((r) => (
              <label className="check" key={r.value}>
                <input type="checkbox" checked={(p.excludeRoleTypes ?? []).includes(r.value)} onChange={() => set({ excludeRoleTypes: toggleIn(p.excludeRoleTypes, r.value) })} />
                {r.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          If a role requires a licence or certification you don't have
          <select value={p.missingCredentialPolicy} onChange={(e) => set({ missingCredentialPolicy: e.target.value as Preferences["missingCredentialPolicy"] })}>
            <option value="hard_gate">Leave it out</option>
            <option value="score_penalty">Show it, with a lower score</option>
          </select>
        </label>
        <fieldset>
          <legend>Only employers based in (leave blank for any)</legend>
          <div className="grid2">
            {Region.options.map((r) => (
              <label className="check" key={r}>
                <input
                  type="checkbox"
                  checked={p.employerBase?.regions?.includes(r) ?? false}
                  onChange={() => {
                    const regions = toggleIn(p.employerBase?.regions, r);
                    set({ employerBase: regions.length ? { countries: p.employerBase?.countries ?? [], regions } : null });
                  }}
                />
                {REGION_LABELS[r]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="card">
        <h2>Your CV format</h2>
        <div className="grid2">
          <label>
            Paper size
            <select
              value={p.cvTemplate?.pageSize ?? "A4"}
              onChange={(e) => set({ cvTemplate: { convention: p.cvTemplate?.convention ?? "standard", pageSize: e.target.value as "A4" | "LETTER" } })}
            >
              <option value="A4">A4</option>
              <option value="LETTER">US Letter</option>
            </select>
          </label>
          <label>
            Regional convention
            <select
              value={p.cvTemplate?.convention ?? "standard"}
              onChange={(e) => set({ cvTemplate: { pageSize: p.cvTemplate?.pageSize ?? "A4", convention: e.target.value as "standard" } })}
            >
              <option value="standard">Standard</option>
              <option value="north_america">North America</option>
              <option value="uk_commonwealth">UK and Commonwealth</option>
              <option value="europe">Europe</option>
            </select>
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
