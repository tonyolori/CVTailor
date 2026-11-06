"use client";

import { useState, useTransition, type FormEvent } from "react";
import { regionsOfCountry, type CvStyle, type PreferencesInput, type Resume, type WorkMode } from "@cvtailor/core";
import type { TitleSuggestions } from "@cvtailor/core/prompts";
import type { CountryOption } from "@/lib/countries";
import { savePreferences, setCvStyle } from "@/app/actions";
import { CvTemplatePicker } from "@/components/CvTemplatePicker";
import { blankPreferences, CommaField } from "@/components/PreferenceFields";
import { errorFields, log, loggedFetch } from "@/lib/log";

const MODES: { id: WorkMode; label: string }[] = [
  { id: "remote", label: "Remote" },
  { id: "hybrid", label: "Hybrid" },
  { id: "onsite", label: "On-site" },
];

/**
 * Step 2: only what the first matches need. Titles, where the person lives, how they'll work and
 * how their CV looks. Filters, languages and the rest have defaults and wait in Preferences.
 */
export function OnboardingPreferences({
  tz,
  countries,
  categoryIds,
  style: initialStyle,
  sample,
}: {
  tz: string;
  countries: CountryOption[];
  categoryIds: string[];
  style: CvStyle;
  sample: Resume;
}) {
  const [p, setP] = useState<PreferencesInput>(() => blankPreferences(tz));
  const [titles, setTitles] = useState<string[]>([]);
  const [style, setStyle] = useState(initialStyle);
  const [message, setMessage] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [pending, start] = useTransition();
  const set = (patch: Partial<PreferencesInput>) => setP((prev) => ({ ...prev, ...patch }));
  const modes = (p.workModes ?? []) as WorkMode[];
  const country = p.eligibility!.country;
  const countryName = countries.find((c) => c.code === country)?.name;
  const exp = p.expansionTitles ?? { a: [], b: [], c: [] };
  const suggested = [...(exp.a ?? []), ...(exp.b ?? []), ...(exp.c ?? [])];

  async function suggest() {
    setSuggesting(true);
    setMessage(null);
    try {
      const res = await loggedFetch("/api/onboarding/titles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetTitles: titles }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; suggestions?: TitleSuggestions };
      if (body.error) throw new Error(body.error);
      const s = body.suggestions;
      if (!s) throw new Error("Suggestions aren't available right now. Your own titles are enough to start.");
      set({ expansionTitles: { a: s.a, b: s.b, c: s.c }, categories: s.categories.filter((c) => categoryIds.includes(c)) });
    } catch (err) {
      log("onboarding.suggest_failed", errorFields(err), "warn");
      setMessage(err instanceof Error ? err.message : "Couldn't get suggestions.");
    } finally {
      setSuggesting(false);
    }
  }

  const drop = (title: string) =>
    set({ expansionTitles: { a: (exp.a ?? []).filter((t) => t !== title), b: (exp.b ?? []).filter((t) => t !== title), c: (exp.c ?? []).filter((t) => t !== title) } });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (titles.length === 0) return setMessage("Add at least one job title.");
    if (!country) return setMessage("Choose the country you live in.");
    if (modes.length === 0) return setMessage("Choose at least one way of working.");
    setMessage(null);
    start(async () => {
      if (style !== initialStyle) {
        const styled = await setCvStyle(style);
        if (!styled.ok) return setMessage(styled.message ?? "Couldn't save your CV template.");
      }
      // Goes to the dashboard when it works, so only a failure comes back.
      const r = await savePreferences({ ...p, targetTitles: titles }, "/dashboard");
      if (!r.ok) setMessage(r.message ?? "Couldn't save your answers.");
    });
  }

  return (
    <form className="stack onb" onSubmit={submit} noValidate>
      <section className="card">
        <h2>
          <label htmlFor="titles">What job are you looking for?</label>
        </h2>
        <CommaField id="titles" value={titles} onChange={setTitles} placeholder="For example: Staff Nurse, Ward Nurse" />
        <small className="muted">Use the titles employers would use. Separate more than one with commas.</small>
        {suggested.length ? (
          <div className="stack">
            <small className="muted">We'll also look for these when your own titles find too few:</small>
            <div className="row">
              {suggested.map((t) => (
                <span className="chip info" key={t}>
                  {t}{" "}
                  <button className="plain" type="button" aria-label={`Remove ${t}`} onClick={() => drop(t)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <button className="link" type="button" onClick={() => void suggest()} disabled={suggesting || titles.length === 0}>
            {suggesting ? "Finding similar titles..." : "Suggest similar titles"}
          </button>
        )}
      </section>

      <section className="card">
        <h2>
          <label htmlFor="country">Where do you live?</label>
        </h2>
        <select
          id="country"
          value={country}
          onChange={(e) => set({ eligibility: { ...p.eligibility!, country: e.target.value, regions: e.target.value ? regionsOfCountry(e.target.value) : [] } })}
        >
          <option value="">Choose your country...</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </section>

      <section className="card">
        <h2 id="modes">How do you want to work?</h2>
        <div className="pills" role="group" aria-labelledby="modes">
          {MODES.map((m) => (
            <label className="pill" key={m.id}>
              <input type="checkbox" checked={modes.includes(m.id)} onChange={() => set({ workModes: modes.includes(m.id) ? modes.filter((x) => x !== m.id) : [...modes, m.id] })} />
              {m.label}
            </label>
          ))}
        </div>
        <small className="muted">
          {modes.includes("hybrid") || modes.includes("onsite")
            ? `Hybrid and on-site roles are matched in ${countryName ?? "the country you live in"}. `
            : ""}
          {modes.includes("remote") ? `Remote roles must be open to people ${countryName ? `in ${countryName}` : "where you live"}.` : ""}
        </small>
      </section>

      <section className="card">
        <h2>Pick a look for your CVs</h2>
        <CvTemplatePicker value={style} onChange={setStyle} sample={sample} />
        <small className="muted">An example CV. Yours will use your own experience. You can change the look any time.</small>
      </section>

      {message ? (
        <div className="notice bad" role="alert">
          {message}
        </div>
      ) : null}
      <div className="onb-end">
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "Saving..." : "Show me jobs"}
        </button>
        <small className="muted">Salary, seniority, languages and other filters are optional. Add them later in Preferences.</small>
      </div>
    </form>
  );
}
