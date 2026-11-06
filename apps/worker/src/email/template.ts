import { z } from "zod";
import { EMAIL_COLORS, SERIF, button, e, emailDocument, link, masthead, row, safeUrl } from "@cvtailor/core/email";

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

// The shared look and its dark-mode rules are in @cvtailor/core/email. These are the digest's own pieces.
const C = EMAIL_COLORS;

const CHIPS = {
  green: ["#dcfce7", "#166534"],
  blue: ["#dbeafe", "#1e40af"],
  amber: ["#fef3c7", "#92400e"],
  red: ["#fee2e2", "#991b1b"],
  orange: ["#ffedd5", "#9a3412"],
  slate: ["#eef2f8", "#40548f"],
} as const;
type ChipKind = keyof typeof CHIPS;

const CHIP_CSS = `
@media (prefers-color-scheme: dark) {
  .c-green { background:#123524 !important; color:#86efac !important; }
  .c-blue { background:#172554 !important; color:#93c5fd !important; }
  .c-amber { background:#3b2a0a !important; color:#fcd34d !important; }
  .c-red { background:#3f1414 !important; color:#fca5a5 !important; }
  .c-orange { background:#3b1d0b !important; color:#fdba74 !important; }
  .c-slate { background:#1d2a5c !important; color:#c7d2f5 !important; }
}
`;

export { e, safeUrl };

function chip(text: string, kind: ChipKind, size = 12): string {
  const [bg, fg] = CHIPS[kind];
  return `<span class="c-${kind}" style="display:inline-block;padding:3px 9px;border-radius:999px;background:${bg};color:${fg};font-weight:600;font-size:${size}px;line-height:1.3;white-space:nowrap;">${e(text)}</span>`;
}

function scoreChip(score: number): string {
  return chip(`${score}/10`, score >= 9 ? "green" : score >= 8 ? "blue" : "amber", 13);
}

function tierTag(tier?: string): string {
  return !tier || tier === "core" ? "" : ` ${chip(`tier ${tier.toUpperCase()}`, "slate", 11)}`;
}

function heading(text: string, sub?: string): string {
  let s = `<div class="c-ink" style="font-family:${SERIF};font-size:26px;line-height:1.15;color:${C.ink};margin:0 0 4px;">${e(text)}</div>`;
  s += sub
    ? `<div class="c-soft" style="font-size:13.5px;color:${C.soft};margin:0 0 12px;line-height:1.5;">${e(sub)}</div>`
    : '<div style="height:8px;line-height:8px;font-size:8px;">&nbsp;</div>';
  return s;
}

/** Job titles are set in the serif, as on the dashboard. */
function jobTitle(title: string, size = 19): string {
  return `<div class="c-ink" style="font-family:${SERIF};font-size:${size}px;line-height:1.2;color:${C.ink};">${e(title)}</div>`;
}

function stat(value: number, label: string): string {
  return `<td class="c-sky2" align="center" width="33%" style="padding:12px 4px 10px;background:${C.sky2};border-radius:12px;"><div class="c-ink" style="font-family:${SERIF};font-size:32px;line-height:1;color:${C.ink};">${e(value)}</div><div class="c-soft" style="font-size:12.5px;color:${C.soft};margin-top:4px;">${e(label)}</div></td>`;
}

function listOpen(size = 13.5): string {
  return `<table class="c-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:12px;border-collapse:separate;font-size:${size}px;">`;
}

function cell(content: string, last: boolean, extra = ""): string {
  const border = last ? "" : `border-bottom:1px solid ${C.line};`;
  return `<td class="c-line" valign="top" style="padding:16px 16px;${border}${extra}">${content}</td>`;
}

function section(content: string, top = 32): string {
  return row(content, `${top}px 28px 0`);
}

function callout(text: string, kind: ChipKind): string {
  const [bg, fg] = CHIPS[kind];
  return `<div class="c-${kind}" style="background:${bg};color:${fg};padding:11px 14px;border-radius:10px;font-size:13.5px;line-height:1.5;margin-bottom:8px;">${e(text)}</div>`;
}

export interface EmailLinks {
  dashboardUrl: string;
  unsubscribeUrl: string;
}

/** Opens the job on the dashboard, where the CV is written with one click. */
function writeLink(links: EmailLinks, matchId: number | undefined): string {
  return matchId ? `${links.dashboardUrl}?job=${matchId}` : links.dashboardUrl;
}

/** "Monday 2 November" for a run date, or the date as given if it doesn't parse. */
export function longDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

function rolesToApply(n: number): string {
  return `${n === 0 ? "No roles" : `${n} role${n === 1 ? "" : "s"}`} to apply for`;
}

export function emailSubject(d: DailySummary): string {
  return `${rolesToApply(d.roles.length)}, ${longDate(d.date)}`;
}

export function renderEmailHtml(d: DailySummary, links: EmailLinks): string {
  const { roles, worthALook: looks, closeCalls: calls } = d;
  const n = roles.length;
  const home = links.dashboardUrl.replace(/\/dashboard$/, "/");
  const o: string[] = [];

  const sub = `${rolesToApply(n)}${looks.length ? `, and ${looks.length} worth a look` : ""}.`;
  o.push(
    `<tr><td class="c-sky c-pad" style="background:${C.sky};padding:28px 28px 26px;border-radius:15px 15px 0 0;">${masthead(home, true)}<div class="c-soft" style="margin-top:28px;font-size:13.5px;color:${C.soft};">Daily job search</div><div class="c-ink c-h1" style="font-family:${SERIF};font-size:40px;line-height:1.05;color:${C.ink};margin-top:2px;">${e(longDate(d.date))}</div><div class="c-ink" style="font-size:15px;color:${C.ink};margin-top:8px;">${e(sub)}</div></td></tr>`,
  );

  o.push(
    section(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:6px 0;"><tr>${stat(n, "to apply")}${stat(looks.length, "to watch")}${stat(calls.length, "close calls")}</tr></table>`,
      22,
    ),
  );

  const alerts = [
    ...d.gaps.map((g) => callout(g, "amber")),
    ...d.notes.map((g) => callout(g, "slate")),
    ...(d.unscored ? [callout(`${d.unscored} role${d.unscored === 1 ? "" : "s"} passed your filters but couldn't be scored today. See your dashboard.`, "slate")] : []),
  ];
  if (alerts.length) o.push(section(alerts.join(""), 20));

  if (n > 0) {
    const checked = roles.every((r) => r.verifiedOk)
      ? "Each was checked at its source."
      : "Each was checked at its source unless marked Unverified.";
    const t = [heading("Apply", `These passed your filters. ${checked}`), listOpen()];
    roles.forEach((r, i) => {
      const badge = r.verifiedOk ? chip("Verified", "green") : chip("Unverified", "red");
      t.push(
        `<tr>${cell(
          `${jobTitle(r.title)}<div class="c-soft" style="color:${C.soft};margin-top:3px;">${e(r.company)}</div><div style="margin-top:10px;">${scoreChip(r.score)} ${badge}${tierTag(r.tier)}</div><div style="margin-top:14px;">${button(r.apply, "Apply", "small")}</div>`,
          i === n - 1,
        )}</tr>`,
      );
    });
    t.push("</table>");
    o.push(section(t.join("")));

    const cards = [heading("Details")];
    roles.forEach((r, i) => {
      const label = (k: string) => `<td class="c-soft" valign="top" style="padding:4px 12px 4px 0;color:${C.soft};font-size:12.5px;white-space:nowrap;width:84px;">${e(k)}</td>`;
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
        .map(([k, v]) => `<tr>${label(k)}<td class="c-ink" style="padding:4px 0;color:${C.ink};font-size:13.5px;line-height:1.5;">${e(v)}</td></tr>`)
        .join("");
      const source =
        r.sourceLabel && r.sourceUrl ? `<tr>${label("Source")}<td style="padding:4px 0;font-size:13.5px;">${link(r.sourceUrl, r.sourceLabel)}</td></tr>` : "";
      const write = r.resumePath ? "" : `<tr>${label("CV")}<td style="padding:4px 0;font-size:13.5px;">${link(writeLink(links, r.matchId), "Write my CV")}</td></tr>`;
      cards.push(
        `<table class="c-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:12px;border-collapse:separate;margin-bottom:10px;"><tr><td style="padding:14px 16px;">${jobTitle(`${i + 1}. ${r.title}`, 17)}<div class="c-soft" style="color:${C.soft};font-size:13.5px;margin-top:2px;">${e(r.company)}</div><table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;">${body}${source}${write}</table></td></tr></table>`,
      );
    });
    o.push(section(cards.join("")));
  } else {
    o.push(section(`<div class="c-ink" style="font-size:15px;color:${C.ink};">No roles passed every filter today.</div>`));
  }

  if (d.failed.length) {
    const t = [heading("CVs not delivered", "These roles were good matches, but the CV didn't pass the fact check against your library, so it wasn't sent. You can still apply."), listOpen()];
    d.failed.forEach((f, i) => {
      t.push(
        `<tr>${cell(
          `${jobTitle(f.title, 17)}<div class="c-soft" style="color:${C.soft};margin-top:3px;">${e(f.company)}</div><div class="c-ink" style="margin-top:6px;font-size:13.5px;line-height:1.5;color:${C.ink};">${e(f.reason)}</div>${f.link ? `<div style="margin-top:12px;">${button(f.link, "View posting", "small")}</div>` : ""}`,
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
      const meta = [w.company, w.posted ? `posted ${w.posted}` : "", w.sourceLabel ? `via ${w.sourceLabel}` : ""].filter(Boolean).join(", ");
      t.push(
        `<tr>${cell(
          `${jobTitle(w.title, 17)}<div class="c-soft" style="color:${C.soft};margin-top:3px;">${e(meta)}</div><div style="margin-top:10px;">${scoreChip(w.score)} ${chip(w.location ?? "Limited", "orange")}</div><div class="c-ink" style="margin-top:10px;font-size:13.5px;line-height:1.5;color:${C.ink};">${e(w.why)}</div><div class="c-soft" style="margin-top:4px;font-size:12.5px;line-height:1.5;color:${C.soft};">${e(w.whyNot)}</div><div style="margin-top:14px;">${button(w.link, "View posting", "small")}</div>`,
          i === looks.length - 1,
        )}</tr>`,
      );
    });
    t.push("</table>");
    o.push(section(t.join("")));
  }

  if (calls.length) {
    const t = [heading("Close calls", "Near misses, and what kept each one off the list."), listOpen(13)];
    calls.forEach((c, i) => {
      const last = i === calls.length - 1;
      const name = c.link ? link(c.link, c.company, "font-weight:600;text-decoration:none;") : `<b class="c-ink" style="color:${C.ink};">${e(c.company)}</b>`;
      t.push(
        `<tr>${cell(`${name}<div class="c-soft" style="color:${C.soft};margin-top:2px;">${e(c.title)}</div>`, last, "width:40%;")}${cell(`<div class="c-ink" style="color:${C.ink};line-height:1.5;">${e(c.reason)}</div>`, last)}</tr>`,
      );
    });
    t.push("</table>");
    o.push(section(t.join("")));
  }

  o.push(section(`<div style="text-align:center;">${button(links.dashboardUrl, "Open your dashboard")}</div>`, 36));

  const sources = d.sources.map((s) => (s.url ? link(s.url, s.label, `color:${C.soft};`) : e(s.label))).join(", ");
  const foot = [`Sources searched: ${sources || "none"}`];
  if (d.skipped.length) foot.push(`Skipped: ${e(d.skipped.join("; "))}`);
  if (d.expansion) foot.push(`Search widened: ${e(d.expansion)}`);
  foot.push(link(links.unsubscribeUrl, "Pause these emails", `color:${C.soft};`));

  return emailDocument({
    title: emailSubject(d),
    preheader: n > 0 ? `${roles.slice(0, 3).map((r) => `${r.title} at ${r.company}`).join("; ")}` : sub,
    rows: o,
    footer: foot.join("<br>"),
    width: 640,
    extraCss: CHIP_CSS,
  });
}

export function renderEmailText(d: DailySummary, links: EmailLinks): string {
  const lines = [`Daily job search, ${longDate(d.date)}`, `${rolesToApply(d.roles.length)}, ${d.worthALook.length} worth a look`, ""];
  d.gaps.forEach((g) => lines.push(`NOTE: ${g}`));
  d.notes.forEach((g) => lines.push(`NOTE: ${g}`));
  d.roles.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.title} - ${r.company} (${r.score}/10)`, `   Apply: ${r.apply}`);
    if (r.location) lines.push(`   Location: ${r.location}`);
    if (r.why) lines.push(`   Why: ${r.why}`);
    if (r.note) lines.push(`   Note: ${r.note}`);
    if (!r.resumePath) lines.push(`   Write my CV: ${writeLink(links, r.matchId)}`);
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
