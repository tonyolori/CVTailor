const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** HTML to plain text. Handles content that is HTML-escaped twice, as Greenhouse's is. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  let s = html;
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(s)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function toIso(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  let d: Date;
  if (typeof value === "number") {
    d = new Date(value > 1e11 ? value : value * 1000);
  } else {
    d = new Date(value.replace(" UTC", "Z").replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"));
  }
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const COUNTRY_NAMES = new Map<string, string>();
const names = new Intl.DisplayNames(["en"], { type: "region" });
for (let a = 65; a <= 90; a++) {
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    try {
      const name = names.of(code);
      // Keep the first code for a name: "UK" and "GB" both read "United Kingdom", and GB is the ISO one.
      if (name && name !== code && !COUNTRY_NAMES.has(name.toLowerCase())) COUNTRY_NAMES.set(name.toLowerCase(), code);
    } catch {
      // not a region code
    }
  }
}
COUNTRY_NAMES.delete("european union");
COUNTRY_NAMES.set("usa", "US");
COUNTRY_NAMES.set("uk", "GB");
COUNTRY_NAMES.set("england", "GB");
COUNTRY_NAMES.set("scotland", "GB");
COUNTRY_NAMES.set("wales", "GB");

/** Best-effort country from free text. Only a hint: enrichment decides. */
export function guessCountry(text: string | null | undefined): string | null {
  if (!text) return null;
  const parts = text.toLowerCase().split(/[,;|/()\-–]+/).map((p) => p.trim());
  for (const p of parts.reverse()) {
    const hit = COUNTRY_NAMES.get(p);
    if (hit) return hit;
  }
  return null;
}

export function dedupeKey(company: string, title: string): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(inc|llc|ltd|gmbh|limited|corp|co)\b\.?/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  return `${norm(company)}|${norm(title)}`;
}
