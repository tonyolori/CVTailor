"use client";

import { useState, useTransition } from "react";
import { regionsOfCountry, Region, type CvStyle, type Preferences, type PreferencesInput, type Resume, type WorkMode } from "@cvtailor/core";
import type { TitleSuggestions } from "@cvtailor/core/prompts";
import type { CountryOption } from "@/lib/countries";
import { savePreferences, setCvStyle } from "@/app/actions";
import { CvTemplatePicker } from "@/components/CvTemplatePicker";
import { blankPreferences, commas, CommaField } from "@/components/PreferenceFields";
import { errorFields, log, loggedFetch } from "@/lib/log";

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
  countries,
  style: initialStyle,
  sample,
}: {
  initial: Preferences | null;
  categories: { id: string; label: string }[];
  tz: string;
  countries: CountryOption[];
  style: CvStyle;
  sample: Resume;
}) {
  const [p, setP] = useState<PreferencesInput>(initial ?? blankPreferences(tz));
  const [titles, setTitles] = useState((p.targetTitles ?? []).join(", "));
  const [style, setStyle] = useState(initialStyle);
  const [savedStyle, setSavedStyle] = useState(initialStyle);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [suggesting, setSuggesting] = useState(false);
  const set = (patch: Partial<PreferencesInput>) => setP({ ...p, ...patch });
  const modes = (p.workModes ?? []) as WorkMode[];
  const toggleIn = <T,>(list: T[] | undefined, v: T): T[] => ((list ?? []).includes(v) ? (list ?? []).filter((x) => x !== v) : [...(list ?? []), v]);
  const exp = p.expansionTitles ?? { a: [], b: [], c: [] };
  const eligibility = p.eligibility!;

  async function suggest() {
    setSuggesting(true);
    setMessage(null);
    try {
      const res = await loggedFetch("/api/onboarding/titles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetTitles: commas(titles) }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; suggestions?: TitleSuggestions };
      if (body.error) throw new Error(body.error);
      const s = body.suggestions;
      if (!s) throw new Error("Suggestions aren't available right now. You can type your own.");
      const valid = new Set(categories.map((c) => c.id));
      set({
        expansionTitles: { a: s.a, b: s.b, c: s.c },
        categories: [...new Set([...(p.categories ?? []), ...s.categories.filter((c) => valid.has(c))])],
      });
    } catch (err) {
      log("preferences.suggest_failed", errorFields(err), "warn");
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Couldn't get suggestions." });
    } finally {
      setSuggesting(false);
    }
  }

  function save() {
    if (!eligibility.country) return setMessage({ ok: false, text: "Choose the country you live in." });
    if (commas(titles).length === 0) return setMessage({ ok: false, text: "Add at least one job title." });
    if (modes.length === 0) return setMessage({ ok: false, text: "Choose at least one way of working." });
    start(async () => {
      if (style !== savedStyle) {
        const styled = await setCvStyle(style);
        if (!styled.ok) return setMessage({ ok: false, text: styled.message ?? "Couldn't save your CV template." });
        setSavedStyle(style);
      }
      const r = await savePreferences({ ...p, targetTitles: commas(titles) });
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
            <CommaField textarea value={exp.a ?? []} onChange={(list) => set({ expansionTitles: { ...exp, a: list } })} />
          </label>
          <label>
            Adjacent titles
            <CommaField textarea value={exp.b ?? []} onChange={(list) => set({ expansionTitles: { ...exp, b: list } })} />
          </label>
          <label>
            Stretch titles
            <CommaField textarea value={exp.c ?? []} onChange={(list) => set({ expansionTitles: { ...exp, c: list } })} />
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
        {modes.includes("hybrid") || modes.includes("onsite") ? <small className="muted">Hybrid and on-site roles are matched in the country you live in.</small> : null}
        <label>
          Languages you can work in, comma-separated
          <CommaField value={p.languages ?? []} onChange={(list) => set({ languages: list })} />
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
          <CommaField value={p.excludeTitleKeywords ?? []} onChange={(list) => set({ excludeTitleKeywords: list })} />
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
        <h2>Your CV template</h2>
        <CvTemplatePicker value={style} onChange={setStyle} sample={sample} />
        <label className="check">
          <input
            type="checkbox"
            checked={p.cvTemplate?.pageSize === "LETTER"}
            onChange={(e) => set({ cvTemplate: { convention: p.cvTemplate?.convention ?? "standard", pageSize: e.target.checked ? "LETTER" : "A4" } })}
          />
          Use US Letter paper instead of A4
        </label>
      </div>

      {message ? <div className={`notice ${message.ok ? "ok" : "bad"}`}>{message.text}</div> : null}
      <div>
        <button className="primary" type="button" disabled={pending} onClick={save}>
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
