/** The sidebar's labels: which matches each one holds, and what it says when it's empty. */
export interface MatchFacts {
  decision: string;
  tracker_status: string;
}

export const TRACKED_DECISIONS = ["picked", "pasted"];
export const VISIBLE_DECISIONS = ["picked", "worth-a-look", "unscored", "pasted"];

const tracked = (m: MatchFacts) => TRACKED_DECISIONS.includes(m.decision);
const stage = (status: string) => (m: MatchFacts) => tracked(m) && m.tracker_status === status;

export interface View {
  label: string;
  sub: string;
  empty: string;
  holds: (m: MatchFacts) => boolean;
}

export const VIEWS: Record<string, View> = {
  to_apply: { label: "To apply", sub: "Your best matches. Write a CV for any you want to apply to.", empty: "Nothing to apply for right now. New matches arrive in the morning.", holds: (m) => m.decision === "picked" && m.tracker_status === "to_apply" },
  look: { label: "Worth a look", sub: "Close matches. Write a CV for any you want to pursue.", empty: "No close matches yet.", holds: (m) => m.decision === "worth-a-look" },
  unscored: { label: "Not scored", sub: "Jobs we couldn't score. Check these yourself.", empty: "Everything was scored.", holds: (m) => m.decision === "unscored" },
  pasted: { label: "Pasted jobs", sub: "Jobs you pasted in yourself, each with its own CV.", empty: "Jobs you paste in will appear here.", holds: (m) => m.decision === "pasted" },
  all: { label: "All picks", sub: "Every pick, at any stage.", empty: "No picks yet. They arrive after your next morning run.", holds: (m) => m.decision === "picked" },
  applied: { label: "Applied", sub: "Jobs you've applied for.", empty: "When you apply for a job, change its status to Applied and it moves here.", holds: stage("applied") },
  interview: { label: "Interview", sub: "Jobs where you have an interview.", empty: "When you get an interview, change that job's status and it moves here.", holds: stage("interview") },
  offer: { label: "Offer", sub: "Jobs that have made you an offer.", empty: "When you get an offer, change that job's status and it moves here.", holds: stage("offer") },
  rejected: { label: "Rejected", sub: "Jobs that said no.", empty: "Nothing here.", holds: stage("rejected") },
  dismissed: { label: "Dismissed", sub: "Jobs you decided not to pursue.", empty: "Nothing here.", holds: stage("dismissed") },
};

export const STATUS_LABELS: Record<string, string> = {
  to_apply: "To apply",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  dismissed: "Dismissed",
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
