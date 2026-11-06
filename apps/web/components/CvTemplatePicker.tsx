"use client";

import { CV_STYLES, type CvStyle, type Resume } from "@cvtailor/core";
import { CvSheet } from "@/components/CvSheet";

/** The three looks offered while setting up: far enough apart to be a real choice. Compact stays in settings. */
export const TEMPLATE_CHOICES: { id: CvStyle; label: string; description: string }[] = [
  { id: "fitted", label: "Modern", description: "Serif type with a blue headline." },
  { id: "classic", label: "Traditional", description: "Centred name and navy headings." },
  { id: "plain", label: "Simple", description: "Black and white, one font. Safest for formal applications." },
];

/** Example CVs to choose a look from. Renders as radio buttons, so it works with the keyboard. */
export function CvTemplatePicker({ value, onChange, sample }: { value: CvStyle; onChange: (style: CvStyle) => void; sample: Resume }) {
  // Someone who chose a style elsewhere keeps seeing it here.
  const extra = TEMPLATE_CHOICES.some((t) => t.id === value) ? [] : CV_STYLES.filter((c) => c.id === value);
  return (
    <div className="tpls" role="radiogroup" aria-label="CV template">
      {[...TEMPLATE_CHOICES, ...extra].map((t) => (
        <label className="tpl" key={t.id}>
          <input type="radio" name="cv_template" value={t.id} checked={value === t.id} onChange={() => onChange(t.id)} />
          <div className="thumb" aria-hidden="true">
            <CvSheet resume={sample} style={t.id} />
          </div>
          <strong>{t.label}</strong>
          <small>{t.description}</small>
        </label>
      ))}
    </div>
  );
}
