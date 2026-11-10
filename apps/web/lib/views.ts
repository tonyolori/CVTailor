/** The Jobs screen's tabs: which matches each one holds, and what it says when it's empty. */
export interface MatchFacts {
  decision: string;
  tracker_status: string;
}

/** Every kind of match a person sees. Any of them can move through the stages once they act on it. */
export const VISIBLE_DECISIONS = ["picked", "worth-a-look", "unscored", "pasted"];

export interface Stage {
  label: string;
  /** Tracker statuses this tab holds. */
  statuses: string[];
  empty: string;
}

export const STAGES: Record<string, Stage> = {
  to_apply: { label: "To apply", statuses: ["to_apply"], empty: "Nothing to apply for right now. New matches arrive each morning." },
  applied: { label: "Applied", statuses: ["applied"], empty: "When you apply for a job, mark it as applied and it moves here." },
  interview: { label: "Interview", statuses: ["interview"], empty: "When you get an interview, change that job's stage and it moves here." },
  offer: { label: "Offer", statuses: ["offer"], empty: "When an offer comes in, change that job's stage and it moves here." },
  closed: { label: "Closed", statuses: ["rejected", "dismissed"], empty: "Jobs that said no, and jobs you decided against, end up here." },
};

export const STAGE_KEYS = Object.keys(STAGES);

/** The tab that holds a match with this tracker status. */
export function stageOf(status: string): string {
  return STAGE_KEYS.find((k) => STAGES[k]!.statuses.includes(status)) ?? "to_apply";
}

export function inStage(key: string, m: MatchFacts): boolean {
  return VISIBLE_DECISIONS.includes(m.decision) && (STAGES[key]?.statuses.includes(m.tracker_status) ?? false);
}

/** Links from before the Jobs screen had tabs, such as `?view=look`, still land somewhere sensible. */
const OLD_VIEWS: Record<string, string> = { look: "to_apply", unscored: "to_apply", pasted: "to_apply", all: "to_apply", rejected: "closed", dismissed: "closed" };

export function stageKey(view: string | undefined): string | null {
  if (!view) return null;
  if (STAGES[view]) return view;
  return OLD_VIEWS[view] ?? null;
}

/** What a stage select offers. Closed splits into its two reasons. */
export const STATUS_LABELS: Record<string, string> = {
  to_apply: "To apply",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  dismissed: "Not for me",
};

export interface MatchLevel {
  label: string;
  tone: "good" | "plain" | "mine";
}

/** How strong a match is, in words. A bare score says nothing about what it measured. */
export const MATCH_LEVELS: Record<string, MatchLevel> = {
  picked: { label: "Strong match", tone: "good" },
  "worth-a-look": { label: "Close match", tone: "plain" },
  unscored: { label: "Not scored", tone: "plain" },
  pasted: { label: "Added by you", tone: "mine" },
};

const SOURCE_LABELS: Record<string, string> = {
  himalayas: "Himalayas",
  remotive: "Remotive",
  remoteok: "Remote OK",
  weworkremotely: "We Work Remotely",
  jobicy: "Jobicy",
  workingnomads: "Working Nomads",
  "workable-search": "Workable job search",
  hackernews: "Hacker News",
};

/** Sources' terms ask us to name them and link back. An employer's own board needs no credit. */
export function sourceLabel(id: string | null | undefined): string | null {
  return id ? (SOURCE_LABELS[id] ?? null) : null;
}

/** Only real web addresses become links: a posting or a paste can't plant a script link. */
export function safeHref(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
