"use client";

import { useState } from "react";
import { CV_STYLES, type CvStyle, type Resume } from "@jobtailor/core";
import { setCvStyle } from "@/app/actions";
import { CvSheet } from "@/components/CvSheet";
import { SettingsTabs } from "@/components/SettingsTabs";

export function CvStylePicker({ current, sample, isOwn }: { current: CvStyle; sample: Resume; isOwn: boolean }) {
  const [style, setStyle] = useState(current);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const choose = async (next: CvStyle) => {
    const before = style;
    setStyle(next);
    const r = await setCvStyle(next);
    if (r.ok) {
      setMessage({ ok: true, text: `${CV_STYLES.find((c) => c.id === next)?.label} is now your CV style.` });
    } else {
      setStyle(before);
      setMessage({ ok: false, text: r.message ?? "Couldn't save your CV style." });
    }
  };

  return (
    <div className="sty">
      <section className="page wide">
        <h1>Settings</h1>
        <SettingsTabs active="cv-style" />
        <p className="sub">Choose how your CVs look. Your choice applies to every CV and PDF, and you can change it for a single CV in the editor.</p>
        {message ? (
          <div className={`notice ${message.ok ? "ok" : "bad"}`} role="status">
            {message.text}
          </div>
        ) : null}
        <div role="radiogroup" aria-label="CV style">
          {CV_STYLES.map((c) => (
            <label className="opt" key={c.id}>
              <input type="radio" name="cv_style" value={c.id} checked={style === c.id} onChange={() => void choose(c.id)} />
              <div className="thumb" aria-hidden="true">
                <CvSheet resume={sample} style={c.id} />
              </div>
              <div>
                <strong>
                  {c.label} {c.id === "classic" ? <span className="chip">The original</span> : null}
                </strong>
                <small>{c.description}</small>
              </div>
            </label>
          ))}
        </div>
        {isOwn ? null : <small className="muted">The preview shows an invented example until you have a CV of your own.</small>}
      </section>
      <section className="styr" aria-label="Preview">
        <CvSheet resume={sample} style={style} label={`Preview in the ${style} style`} />
      </section>
    </div>
  );
}
