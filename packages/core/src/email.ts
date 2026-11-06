/*
The look every email shares: the app's sky, blue and ink, Instrument Serif headlines and pill buttons.

How it survives dark mode:
- Gmail's phone apps ignore prefers-color-scheme and recolour the email themselves (iOS inverts every
  colour, Android darkens light backgrounds and lightens dark text). A design built only from explicit
  light backgrounds, dark text and pastel fills with dark text inverts cleanly into a dark design.
  Saturated mid-tone fills with white text do not (blue turns mustard), so none are used.
- Apple Mail, iOS Mail and Outlook for Mac honour the <style> block's prefers-color-scheme rules, which
  swap the same elements to a hand-picked dark palette through the c-* classes.
- Only hex colours (no rgba, no transparency), all styles inline, table layout: Gmail drops what it can't parse.
- Clients that block web fonts fall back to Georgia and the system sans, so nothing depends on them.
*/
export const EMAIL_COLORS = {
  page: "#f4f8ff",
  card: "#ffffff",
  line: "#d5dff5",
  ink: "#0a1c57",
  soft: "#40548f",
  blue: "#1546e0",
  sky: "#dfebff",
  sky2: "#eef4ff",
} as const;

const C = EMAIL_COLORS;
export const SERIF = "'Instrument Serif',Georgia,'Times New Roman',serif";
export const SANS = "Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const DARK_CSS = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .c-page { background:#0a1233 !important; }
  .c-card { background:#101a42 !important; border-color:#263468 !important; }
  .c-line { border-color:#263468 !important; }
  .c-ink { color:#eef2ff !important; }
  .c-soft { color:#a9b7e3 !important; }
  .c-link { color:#a3b8ff !important; }
  .c-btn { background:#22357a !important; color:#eef2ff !important; }
  .c-sky { background:#1a2860 !important; }
  .c-sky2 { background:#152156 !important; }
  .c-num { color:#a3b8ff !important; }
}
@media (max-width: 600px) {
  .c-pad { padding-left:20px !important; padding-right:20px !important; }
  .c-h1 { font-size:34px !important; }
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

export function link(url: string | undefined, label: string, style = ""): string {
  return `<a class="c-link" href="${e(safeUrl(url))}" style="color:${C.blue};text-decoration:underline;${style}">${e(label)}</a>`;
}

/** The app's default button: a sky pill with ink text, which inverts cleanly in dark mode. */
export function button(url: string | undefined, label: string, size: "large" | "small" = "large"): string {
  const pad = size === "large" ? "13px 26px" : "8px 15px";
  const font = size === "large" ? 15 : 13.5;
  return `<a class="c-btn" href="${e(safeUrl(url))}" style="display:inline-block;padding:${pad};border-radius:99px;background:${C.sky};color:${C.ink};font-family:${SANS};font-weight:600;font-size:${font}px;line-height:1.4;text-decoration:none;white-space:nowrap;">${e(label)}</a>`;
}

/**
 * The CV monogram from the site icon, drawn in type so it shows when images are blocked.
 * On a sky band, the tile turns white so it doesn't vanish into it.
 */
export function masthead(homeUrl: string, onSky = false): string {
  const tile = onSky ? `class="c-card" style="width:34px;height:34px;border-radius:8px;background:${C.card};"` : `class="c-sky" style="width:34px;height:34px;border-radius:8px;background:${C.sky};"`;
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td ${tile} width="34" height="34" align="center" valign="middle"><a href="${e(safeUrl(homeUrl))}" class="c-ink" style="font-family:${SERIF};font-size:19px;line-height:34px;color:${C.ink};text-decoration:none;letter-spacing:-0.5px;">CV</a></td><td style="padding-left:10px;"><a href="${e(safeUrl(homeUrl))}" class="c-ink" style="font-family:${SERIF};font-size:22px;line-height:1;color:${C.ink};text-decoration:none;">CV Tailor</a></td></tr></table>`;
}

export function headline(text: string, size = 42): string {
  return `<h1 class="c-ink c-h1" style="margin:0;font-family:${SERIF};font-weight:400;font-size:${size}px;line-height:1.08;color:${C.ink};">${e(text)}</h1>`;
}

/** A paragraph of body copy. Takes HTML, so escape anything that came from outside. */
export function para(html: string, opts: { soft?: boolean; size?: number; top?: number } = {}): string {
  const color = opts.soft ? C.soft : C.ink;
  return `<p class="${opts.soft ? "c-soft" : "c-ink"}" style="margin:${opts.top ?? 16}px 0 0;font-family:${SANS};font-size:${opts.size ?? 15}px;line-height:1.6;color:${color};">${html}</p>`;
}

/** One padded row of the card. */
export function row(content: string, padding = "28px 40px 0"): string {
  return `<tr><td class="c-pad" style="padding:${padding};">${content}</td></tr>`;
}

export interface EmailDocument {
  /** The page title some clients show. */
  title: string;
  /** The line inboxes show after the subject. */
  preheader: string;
  /** Rows of the card, from row(). */
  rows: string[];
  /** Small print under the card. HTML. */
  footer: string;
  width?: number;
  /** More c-* dark-mode rules, for email-specific pieces. */
  extraCss?: string;
}

export function emailDocument(d: EmailDocument): string {
  const width = d.width ?? 560;
  // Pads the preheader so clients don't pull body text in after it.
  const filler = "&#847;&zwnj;&nbsp;".repeat(60);
  return [
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${e(d.title)}</title>`,
    `<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Inter:wght@400;600&display=swap" rel="stylesheet">`,
    `<style>${DARK_CSS}${d.extraCss ?? ""}</style></head>`,
    `<body class="c-page" style="margin:0;padding:0;background:${C.page};">`,
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${e(d.preheader)}${filler}</div>`,
    `<table class="c-page" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};font-family:${SANS};color:${C.ink};"><tr><td align="center" style="padding:28px 12px;">`,
    `<table class="c-card" role="presentation" width="${width}" cellpadding="0" cellspacing="0" style="max-width:${width}px;width:100%;background:${C.card};border:1px solid ${C.line};border-radius:16px;border-collapse:separate;">`,
    ...d.rows,
    `<tr><td style="height:36px;line-height:36px;font-size:0;">&nbsp;</td></tr>`,
    `</table>`,
    `<table role="presentation" width="${width}" cellpadding="0" cellspacing="0" style="max-width:${width}px;width:100%;"><tr><td class="c-soft" style="padding:18px 24px 0;font-family:${SANS};font-size:12.5px;line-height:1.6;color:${C.soft};text-align:center;">${d.footer}</td></tr></table>`,
    `</td></tr></table></body></html>`,
  ].join("");
}

// --- Account emails -------------------------------------------------------------

export interface WelcomeEmail {
  /** Where "Finish setting up" goes. */
  setupUrl: string;
  homeUrl: string;
  privacyUrl: string;
  freeCvs: number;
  /** Set when replies reach someone, so the email can invite them. */
  canReply: boolean;
}

const STEPS: [string, string][] = [
  ["Add your experience", "Upload a CV you already have, or type it in. This becomes your library: everything CV Tailor knows about your work."],
  ["Say what you're looking for", "The kind of role, where you'd work, and anything you'd rule out."],
  ["Get your matches every day", "We search job boards and employer sites every day and email you the roles that fit, at the time you choose."],
  ["Ask for a CV when one looks right", "It's written for that job from your library, and checked so it claims nothing you haven't told us."],
];

/** Numbered because it is a sequence: each step needs the one before. */
function steps(): string {
  const rows = STEPS.map(([title, body], i) => {
    const last = i === STEPS.length - 1;
    return `<tr><td valign="top" class="c-num" style="width:40px;padding:${i === 0 ? 0 : 18}px 0 0;font-family:${SERIF};font-size:30px;line-height:1;color:${C.blue};">${i + 1}</td><td valign="top" class="c-line" style="padding:${i === 0 ? 0 : 18}px 0 ${last ? 0 : 18}px;${last ? "" : `border-bottom:1px solid ${C.line};`}"><div class="c-ink" style="font-family:${SANS};font-size:15px;font-weight:600;line-height:1.35;color:${C.ink};">${e(title)}</div><div class="c-soft" style="margin-top:4px;font-family:${SANS};font-size:14px;line-height:1.55;color:${C.soft};">${e(body)}</div></td></tr>`;
  });
  return `<table class="c-sky2" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.sky2};border-radius:12px;border-collapse:separate;"><tr><td style="padding:24px 24px 24px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table></td></tr></table>`;
}

export function welcomeEmail(w: WelcomeEmail): { subject: string; html: string; text: string } {
  const subject = "Welcome to CV Tailor";
  const free = w.freeCvs > 0 ? `Your first ${w.freeCvs === 1 ? "CV is" : `${w.freeCvs} CVs are`} free.` : "";
  const beta = `CV Tailor is new, and you're one of the first people using it.${w.canReply ? " If anything looks wrong or could be better, reply to this email. Every reply gets read." : ""}`;
  const html = emailDocument({
    title: subject,
    preheader: "Two short steps, then your matches start arriving every day.",
    rows: [
      row(masthead(w.homeUrl), "32px 40px 0"),
      row(headline("Welcome. Let's find you the right jobs."), "40px 40px 0"),
      row(para("Every day, CV Tailor looks for roles that fit you. When one does, it writes a CV for that job from your own experience. Here's how it works.", { size: 16 })),
      row(steps(), "28px 40px 0"),
      row(`${button(w.setupUrl, "Finish setting up")}${free ? para(e(free), { soft: true, size: 14, top: 14 }) : ""}`, "32px 40px 0"),
      row(`<div class="c-line" style="border-top:1px solid ${C.line};"></div>${para(e(beta), { soft: true, size: 14, top: 22 })}`, "36px 40px 0"),
    ],
    footer: `You're getting this because you joined CV Tailor. ${link(w.privacyUrl, "How we handle your data", `color:${C.soft};`)}`,
  });
  const text = [
    "Welcome. Let's find you the right jobs.",
    "",
    "Every day, CV Tailor looks for roles that fit you. When one does, it writes a CV for that job from your own experience. Here's how it works.",
    "",
    ...STEPS.flatMap(([title, body], i) => [`${i + 1}. ${title}`, `   ${body}`]),
    "",
    `Finish setting up: ${w.setupUrl}`,
    ...(free ? [free] : []),
    "",
    beta,
    "",
    `How we handle your data: ${w.privacyUrl}`,
  ].join("\n");
  return { subject, html, text };
}

export interface InviteEmail {
  signInUrl: string;
  homeUrl: string;
}

export function inviteEmail(i: InviteEmail): { subject: string; html: string; text: string } {
  const subject = "Your place on CV Tailor is ready";
  const html = emailDocument({
    title: subject,
    preheader: "Sign in with this email address to get started.",
    rows: [
      row(masthead(i.homeUrl), "32px 40px 0"),
      row(headline("You're in."), "40px 40px 0"),
      row(para("Thanks for waiting. Your place on CV Tailor is ready, and you can start now.", { size: 16 }) + para("Sign in with this email address. We'll send you a link, so there's no password to remember.")),
      row(button(i.signInUrl, "Sign in to CV Tailor"), "28px 40px 0"),
      row(
        `<div class="c-line" style="border-top:1px solid ${C.line};"></div>${para("Once you're in, add your experience and say what you're looking for. From the next day, you'll get the roles that fit, and a CV written for any of them when you ask.", { soft: true, size: 14, top: 22 })}`,
        "36px 40px 0",
      ),
    ],
    footer: "You're getting this because you joined the CV Tailor waitlist.",
  });
  const text = [
    "You're in.",
    "",
    "Thanks for waiting. Your place on CV Tailor is ready, and you can start now.",
    "",
    "Sign in with this email address. We'll send you a link, so there's no password to remember:",
    i.signInUrl,
    "",
    "Once you're in, add your experience and say what you're looking for. From the next day, you'll get the roles that fit, and a CV written for any of them when you ask.",
  ].join("\n");
  return { subject, html, text };
}

/** Supabase fills these in when it sends the sign-in email. */
const SUPABASE_TAGS = { "https://link.invalid/confirmation": "{{ .ConfirmationURL }}", "https://site.invalid/": "{{ .SiteURL }}" };

/**
 * The sign-in link email, for Supabase's hosted templates. One design serves new and returning
 * people, since both just click to sign in.
 */
export function signInLinkEmail(): { subject: string; html: string } {
  const subject = "Your CV Tailor sign-in link";
  // safeUrl would refuse a template tag, so stand-ins go through and are swapped back at the end.
  const html = emailDocument({
    title: subject,
    preheader: "Click to sign in. The link works once.",
    rows: [
      row(masthead("https://site.invalid/"), "32px 40px 0"),
      row(headline("Here's your sign-in link.", 36), "40px 40px 0"),
      row(para("Click below to sign in to CV Tailor. The link works once, and only for a short while.", { size: 16 })),
      row(button("https://link.invalid/confirmation", "Sign in"), "28px 40px 0"),
      row(para("If you didn't ask to sign in, you can ignore this email. Nobody can sign in without this link.", { soft: true, size: 14, top: 0 }), "32px 40px 0"),
    ],
    footer: "You're getting this because someone asked to sign in to CV Tailor with this address.",
  });
  return { subject, html: Object.entries(SUPABASE_TAGS).reduce((h, [standIn, tag]) => h.replaceAll(standIn, tag), html) };
}
