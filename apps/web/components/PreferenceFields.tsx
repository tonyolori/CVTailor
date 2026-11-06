"use client";

import { useState } from "react";
import type { PreferencesInput } from "@cvtailor/core";

export const commas = (s: string) => s.split(",").map((l) => l.trim()).filter(Boolean);

export function offsetHours(tz: string): number {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round(((local.getTime() - utc.getTime()) / 3_600_000) * 2) / 2;
}

/** What a new person starts from. Everything beyond titles, country and ways of working is a default. */
export function blankPreferences(tz: string): PreferencesInput {
  return {
    categories: [],
    targetTitles: [],
    workModes: ["remote"],
    remoteScope: "eligible_regions",
    eligibility: { country: "", regions: [], utcOffsetHours: offsetHours(tz) },
    employerBase: null,
    minSalary: null,
    languages: [],
    excludeTitleKeywords: [],
    excludeRoleTypes: [],
    excludeSeniority: [],
    maxYearsRequired: null,
    missingCredentialPolicy: "hard_gate",
  };
}

/**
 * A comma-separated list. It keeps its own text, since rebuilding the text from the parsed list on
 * every keystroke swallows a comma as soon as it's typed. A list changed from outside, such as
 * suggested titles arriving, replaces the text.
 */
export function CommaField({ value, onChange, textarea, ...rest }: { value: string[]; onChange: (list: string[]) => void; textarea?: boolean; placeholder?: string; id?: string }) {
  const [text, setText] = useState(value.join(", "));
  const [seen, setSeen] = useState(value.join("\n"));
  const key = value.join("\n");
  if (key !== seen) {
    setSeen(key);
    if (commas(text).join("\n") !== key) setText(value.join(", "));
  }
  const change = (next: string) => {
    setText(next);
    const list = commas(next);
    setSeen(list.join("\n"));
    onChange(list);
  };
  return textarea ? <textarea {...rest} value={text} onChange={(e) => change(e.target.value)} /> : <input {...rest} value={text} onChange={(e) => change(e.target.value)} />;
}
