import { z } from "zod";

/**
 * The day's results for one user. The dashboard shows this and the email sends it,
 * so the two can't disagree.
 */
export const DailySummarySchema = z.object({
  date: z.string(),
  sources: z.array(z.object({ label: z.string(), url: z.string().optional() })),
  skipped: z.array(z.string()).default([]),
  /** Parts of the user's search no source can serve. Said plainly, so empty isn't mistaken for no jobs. */
  gaps: z.array(z.string()).default([]),
  expansion: z.string().optional(),
  roles: z.array(
    z.object({
      matchId: z.number(),
      title: z.string(),
      company: z.string(),
      score: z.number(),
      tier: z.string().optional(),
      apply: z.string(),
      sourceLabel: z.string().optional(),
      sourceUrl: z.string().optional(),
      location: z.string().optional(),
      verified: z.string().optional(),
      verifiedOk: z.boolean().default(true),
      why: z.string().optional(),
      note: z.string().optional(),
      resumePath: z.string().optional(),
      coverLetterPath: z.string().optional(),
    }),
  ),
  worthALook: z
    .array(
      z.object({
        title: z.string(),
        company: z.string(),
        score: z.number(),
        link: z.string(),
        sourceLabel: z.string().optional(),
        posted: z.string().optional(),
        location: z.string().optional(),
        whyNot: z.string().optional(),
        why: z.string().optional(),
      }),
    )
    .default([]),
  closeCalls: z
    .array(z.object({ company: z.string(), title: z.string(), reason: z.string(), link: z.string().optional() }))
    .default([]),
  /** Picks whose CV couldn't be delivered, usually because it failed the fact check. */
  failed: z.array(z.object({ company: z.string(), title: z.string(), reason: z.string(), link: z.string().optional() })).default([]),
  /** Roles that passed the gates but couldn't be scored. */
  unscored: z.number().default(0),
  notes: z.array(z.string()).default([]),
});
export type DailySummary = z.infer<typeof DailySummarySchema>;
export type DailySummaryInput = z.input<typeof DailySummarySchema>;

/*
How it survives dark mode, ported from the legacy renderer:
- Gmail's phone apps ignore prefers-color-scheme and recolour the email themselves (iOS inverts every
  colour, Android darkens light backgrounds and lightens dark text). A design built only from explicit
  light backgrounds, dark text and pastel badges with dark text inverts cleanly into a dark design.
  Saturated mid-tone fills with white text do not (blue turns mustard, green turns pink), so none are used.
- Apple Mail, iOS Mail and Outlook for Mac honour the <style> block's prefers-color-scheme rules, which
  swap the same elements to a hand-picked dark palette through the c-* classes.
- Only hex colours (no rgba, no transparency), all styles inline, table layout: Gmail drops what it can't parse.
*/
const PAGE = "#f3f5f9";
const CARD = "#ffffff";
const LINE = "#e3e7ef";
const TEXT = "#1f2937";
const MUTED = "#5b6472";
const HEAD = "#111827";
const HDR_BG = "#e8eefc";
const HDR_TEXT = "#1e3a8a";
const HDR_SUB = "#3b5bdb";
const LINK = "#2f4fd0";
const BTN_BG = "#e0e7ff";
const BTN_TEXT = "#1e3a8a";
const BTN_LINE = "#a5b4fc";

const CHIPS = {
  green: ["#dcfce7", "#166534"],
  blue: ["#dbeafe", "#1e40af"],
  amber: ["#fef3c7", "#92400e"],
  red: ["#fee2e2", "#991b1b"],
  orange: ["#ffedd5", "#9a3412"],
  slate: ["#f1f5f9", "#475569"],
} as const;
type ChipKind = keyof typeof CHIPS;

const FONT = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

const DARK_CSS = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .c-page { background:#0f1115 !important; }
  .c-card { background:#181b21 !important; border-color:#2b303a !important; }
  .c-line { border-color:#2b303a !important; }
  .c-text { color:#e6e8ec !important; }
  .c-head { color:#f3f4f6 !important; }
  .c-muted { color:#9aa3b2 !important; }
  .c-hdr { background:#1d2742 !important; }
  .c-hdrt { color:#e0e7ff !important; }
  .c-hdrs { color:#a5b4fc !important; }
  .c-link { color:#93a8ff !important; }
  .c-btn { background:#26335c !important; color:#e0e7ff !important; border-color:#3b4a80 !important; }
  .c-green { background:#123524 !important; color:#86efac !important; }
  .c-blue { background:#172554 !important; color:#93c5fd !important; }
  .c-amber { background:#3b2a0a !important; color:#fcd34d !important; }
  .c-red { background:#3f1414 !important; color:#fca5a5 !important; }
  .c-orange { background:#3b1d0b !important; color:#fdba74 !important; }
  .c-slate { background:#232833 !important; color:#cbd5e1 !important; }
}
`;

/** Everything from postings and users passes through here. Posting text can hold anything. */
export function e(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Only http, https and mailto links reach a user's inbox. */
export function safeUrl(url: string | undefined): string {
  return url && /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : "#";
}

function chip(text: string, kind: ChipKind, size = 12): string {
  const [bg, fg] = CHIPS[kind];
  return `<span class="c-${kind}" style="display:inline-block;padding:3px 9px;border-radius:999px;background:${bg};color:${fg};font-weight:700;font-size:${size}px;line-height:1.3;white-space:nowrap;">${e(text)}</span>`;
}

function scoreChip(score: number): string {
  return chip(`${score}/10`, score >= 9 ? "green" : score >= 8 ? "blue" : "amber", 13);
}

function tierTag(tier?: string): string {
  return !tier || tier === "core" ? "" : ` ${chip(`tier ${tier.toUpperCase()}`, "slate", 11)}`;
}

function button(url: string | undefined, label: string): string {
  return `<a class="c-btn" href="${e(safeUrl(url))}" style="display:inline-block;padding:8px 14px;border-radius:8px;background:${BTN_BG};color:${BTN_TEXT};border:1px solid ${BTN_LINE};text-decoration:none;font-weight:700;font-size:13px;white-space:nowrap;">${e(label)} &rarr;</a>`;
}

function heading(text: string, sub?: string): string {
  let s = `<div class="c-head" style="font-size:17px;font-weight:700;color:${HEAD};margin:0 0 4px;">${e(text)}</div>`;
  s += sub
    ? `<div class="c-muted" style="font-size:13px;color:${MUTED};margin:0 0 10px;line-height:1.45;">${e(sub)}</div>`
    : '<div style="height:6px;line-height:6px;font-size:6px;">&nbsp;</div>';
  return s;
}

function stat(value: number, label: string): string {
  return `<td class="c-card" align="center" width="33%" style="padding:12px 4px;background:${CARD};border:1px solid ${LINE};border-radius:10px;"><div class="c-head" style="font-size:22px;font-weight:700;color:${HDR_TEXT};">${e(value)}</div><div class="c-muted" style="font-size:12px;color:${MUTED};margin-top:2px;">${e(label)}</div></td>`;
}

function listOpen(size = 13): string {
  return `<table class="c-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${LINE};border-radius:10px;border-collapse:separate;font-size:${size}px;">`;
}

function cell(content: string, last: boolean, extra = ""): string {
  const border = last ? "" : `border-bottom:1px solid ${LINE};`;
  return `<td class="c-line" valign="top" style="padding:14px 12px;${border}${extra}">${content}</td>`;
}

function section(content: string, top = 24): string {
  return `<tr><td style="padding:${top}px 24px 0;">${content}</td></tr>`;
}

function callout(text: string, kind: ChipKind): string {
  const [bg, fg] = CHIPS[kind];
  return `<div class="c-${kind}" style="background:${bg};color:${fg};padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.45;margin-bottom:8px;">${e(text)}</div>`;
}

export interface EmailLinks {
  dashboardUrl: string;
  unsubscribeUrl: string;
}

export function emailSubject(d: DailySummary): string {
  const n = d.roles.length;
  return `Job search ${d.date}: ${n} role${n === 1 ? "" : "s"} to apply for`;
}

export function renderEmailHtml(d: DailySummary, links: EmailLinks): string {
  const { roles, worthALook: looks, closeCalls: calls } = d;
  const n = roles.length;
  const o: string[] = [
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>${DARK_CSS}</style></head><body class="c-page" style="margin:0;padding:0;background:${PAGE};">`,
    `<table class="c-page" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};font-family:${FONT};color:${TEXT};padding:16px 0;"><tr><td align="center" style="padding:0 8px;"><table class="c-card" role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:${CARD};border:1px solid ${LINE};border-radius:14px;border-collapse:separate;">`,
  ];

  const sub = `${n} role${n === 1 ? "" : "s"} to apply for${looks.length ? ` &middot; ${looks.length} worth a look` : ""}`;
  o.push(
    `<tr><td class="c-hdr" style="background:${HDR_BG};padding:22px 24px;border-radius:14px 14px 0 0;"><div class="c-hdrs" style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${HDR_SUB};font-weight:700;">Daily job search</div><div class="c-hdrt" style="font-size:26px;font-weight:800;color:${HDR_TEXT};margin-top:4px;">${e(d.date)}</div><div class="c-hdrt" style="font-size:15px;color:${HDR_TEXT};margin-top:4px;">${sub}</div></td></tr>`,
  );

  o.push(
    section(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="border-collapse:separate;"><tr>${stat(n, "to apply")}${stat(looks.length, "to watch")}${stat(calls.length, "close calls")}</tr></table>`,
      16,
    ),
  );

  const alerts = [
    ...d.gaps.map((g) => callout(g, "amber")),
    ...d.notes.map((g) => callout(g, "slate")),
    ...(d.unscored ? [callout(`${d.unscored} role${d.unscored === 1 ? "" : "s"} passed your filters but couldn't be scored today. See your dashboard.`, "slate")] : []),
  ];
  if (alerts.length) o.push(section(alerts.join(""), 16));

  if (n > 0) {
    const checked = roles.every((r) => r.verifiedOk)
      ? "Each was checked at its source."
      : "Each was checked at its source unless marked Unverified.";
    const t = [heading("Apply", `These passed your filters. ${checked}`), listOpen()];
    roles.forEach((r, i) => {
      const badge = r.verifiedOk ? chip("Verified", "green") : chip("Unverified", "red");
      t.push(
        `<tr>${cell(
          `<div class="c-head" style="font-weight:700;font-size:14px;color:${HEAD};">${e(r.title)}</div><div class="c-muted" style="color:${MUTED};margin-top:3px;">${e(r.company)}</div><div style="margin-top:8px;">${scoreChip(r.score)} ${badge}${tierTag(r.tier)}</div><div style="margin-top:12px;">${button(r.apply, "Apply")}</div>`,
          i === n - 1,
        )}</tr>`,
      );
    });
    t.push("</table>");
    o.push(section(t.join("")));

    const cards = [heading("Details")];
    roles.forEach((r, i) => {
      const rows: [string, string | undefined][] = [
        ["Location", r.location],
        ["Verified", r.verified],
        ["Why it fits", r.why],
        ["Note", r.note],
        ["CV", r.resumePath ? "Attached, and on your dashboard" : undefined],
        ["Cover letter", r.coverLetterPath ? "Attached" : undefined],
      ];
      const body = rows
        .filter(([, v]) => v)
        .map(
          ([k, v]) =>
            `<tr><td class="c-muted" valign="top" style="padding:4px 12px 4px 0;color:${MUTED};font-size:12px;white-space:nowrap;width:76px;">${e(k)}</td><td class="c-text" style="padding:4px 0;color:${TEXT};font-size:13px;line-height:1.45;">${e(v)}</td></tr>`,
        )
        .join("");
      const source =
        r.sourceLabel && r.sourceUrl
          ? `<tr><td class="c-muted" valign="top" style="padding:4px 12px 4px 0;color:${MUTED};font-size:12px;white-space:nowrap;width:76px;">Source</td><td style="padding:4px 0;font-size:13px;"><a class="c-link" href="${e(safeUrl(r.sourceUrl))}" style="color:${LINK};text-decoration:none;">${e(r.sourceLabel)}</a></td></tr>`
          : "";
      cards.push(
        `<table class="c-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${LINE};border-radius:10px;border-collapse:separate;margin-bottom:10px;"><tr><td style="padding:12px 14px;"><div class="c-head" style="font-weight:700;font-size:14px;color:${HEAD};">${i + 1}. ${e(r.title)} <span class="c-muted" style="color:${MUTED};font-weight:400;">&ndash; ${e(r.company)}</span></div><table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:6px;">${body}${source}</table></td></tr></table>`,
      );
    });
    o.push(section(cards.join("")));
  } else {
    o.push(section(`<div class="c-text" style="font-size:14px;color:${TEXT};">No roles passed every filter today.</div>`));
  }

  if (d.failed.length) {
    const t = [heading("CVs not delivered", "These roles were good matches, but the CV didn't pass the fact check against your library, so it wasn't sent. You can still apply."), listOpen()];
    d.failed.forEach((f, i) => {
      t.push(
        `<tr>${cell(
          `<div class="c-head" style="font-weight:700;font-size:14px;color:${HEAD};">${e(f.title)}</div><div class="c-muted" style="color:${MUTED};margin-top:3px;">${e(f.company)}</div><div class="c-text" style="margin-top:6px;font-size:13px;color:${TEXT};">${e(f.reason)}</div>${f.link ? `<div style="margin-top:10px;">${button(f.link, "View posting")}</div>` : ""}`,
          i === d.failed.length - 1,
        )}</tr>`,
      );
    });
    t.push("</table>");
    o.push(section(t.join("")));
  }

  if (looks.length) {
    const t = [heading("Worth a look", "Strong fits that missed the list only on location or work mode."), listOpen()];
    looks.forEach((w, i) => {
      const posted = w.posted ? ` &middot; posted ${e(w.posted)}` : "";
      const via = w.sourceLabel ? ` &middot; via ${e(w.sourceLabel)}` : "";
      t.push(
        `<tr>${cell(
          `<div class="c-head" style="font-weight:700;font-size:14px;color:${HEAD};">${e(w.title)}</div><div class="c-muted" style="color:${MUTED};margin-top:3px;">${e(w.company)}${posted}${via}</div><div style="margin-top:8px;">${scoreChip(w.score)} ${chip(w.location ?? "Limited", "orange")}</div><div class="c-text" style="margin-top:8px;font-size:13px;line-height:1.45;color:${TEXT};">${e(w.why)}</div><div class="c-muted" style="margin-top:4px;font-size:12px;line-height:1.45;color:${MUTED};">${e(w.whyNot)}</div><div style="margin-top:12px;">${button(w.link, "View posting")}</div>`,
          i === looks.length - 1,
        )}</tr>`,
      );
    });
    t.push("</table>");
    o.push(section(t.join("")));
  }

  if (calls.length) {
    const t = [heading("Close calls"), listOpen(12)];
    calls.forEach((c, i) => {
      const last = i === calls.length - 1;
      const name = c.link
        ? `<a class="c-link" href="${e(safeUrl(c.link))}" style="color:${LINK};text-decoration:none;font-weight:700;">${e(c.company)}</a>`
        : `<b class="c-head" style="color:${HEAD};">${e(c.company)}</b>`;
      t.push(
        `<tr>${cell(`${name}<div class="c-muted" style="color:${MUTED};margin-top:2px;">${e(c.title)}</div>`, last, "width:40%;")}${cell(`<div class="c-text" style="color:${TEXT};line-height:1.45;">${e(c.reason)}</div>`, last)}</tr>`,
      );
    });
    t.push("</table>");
    o.push(section(t.join("")));
  }

  o.push(section(`<div style="text-align:center;">${button(links.dashboardUrl, "Open your dashboard")}</div>`));

  const sources = d.sources
    .map((s) => (s.url ? `<a class="c-link" href="${e(safeUrl(s.url))}" style="color:${LINK};text-decoration:none;">${e(s.label)}</a>` : e(s.label)))
    .join(", ");
  const foot = [`<b>Sources searched:</b> ${sources || "none"}`];
  if (d.skipped.length) foot.push(`<b>Skipped:</b> ${e(d.skipped.join("; "))}`);
  if (d.expansion) foot.push(`<b>Expansion:</b> ${e(d.expansion)}`);
  foot.push(`<a class="c-link" href="${e(safeUrl(links.unsubscribeUrl))}" style="color:${LINK};">Pause these emails</a>`);
  o.push(
    `<tr><td style="padding:20px 24px 22px;"><div class="c-muted c-line" style="border-top:1px solid ${LINE};padding-top:12px;font-size:12px;line-height:1.6;color:${MUTED};">${foot.join("<br>")}</div></td></tr>`,
  );
  o.push("</table></td></tr></table></body></html>");
  return o.join("");
}

export function renderEmailText(d: DailySummary, links: EmailLinks): string {
  const lines = [`Daily job search, ${d.date}`, `${d.roles.length} roles to apply for, ${d.worthALook.length} worth a look`, ""];
  d.gaps.forEach((g) => lines.push(`NOTE: ${g}`));
  d.notes.forEach((g) => lines.push(`NOTE: ${g}`));
  d.roles.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.title} - ${r.company} (${r.score}/10)`, `   Apply: ${r.apply}`);
    if (r.location) lines.push(`   Location: ${r.location}`);
    if (r.why) lines.push(`   Why: ${r.why}`);
    if (r.note) lines.push(`   Note: ${r.note}`);
  });
  if (d.failed.length) {
    lines.push("", "CVs not delivered:");
    d.failed.forEach((f) => lines.push(`- ${f.title} - ${f.company}: ${f.reason}`));
  }
  if (d.worthALook.length) {
    lines.push("", "Worth a look:");
    d.worthALook.forEach((w) => lines.push(`- ${w.title} - ${w.company} (${w.score}/10): ${w.link}`));
  }
  if (d.closeCalls.length) {
    lines.push("", "Close calls:");
    d.closeCalls.forEach((c) => lines.push(`- ${c.title} - ${c.company}: ${c.reason}`));
  }
  lines.push("", `Sources searched: ${d.sources.map((s) => s.label).join(", ")}`, "", `Dashboard: ${links.dashboardUrl}`, `Pause these emails: ${links.unsubscribeUrl}`);
  return lines.join("\n");
}
