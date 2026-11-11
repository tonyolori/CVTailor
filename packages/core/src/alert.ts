import { ADDRESS, logIdentifier, type LogField } from "./log";

type Fields = Record<string, LogField>;
export type AlertSink = (event: string, fields: Fields, exception?: unknown) => void;

/**
 * Kept on globalThis, not in this module: Next can load a package twice, once for
 * instrumentation and once for routes, and an alert set up in one must reach the other.
 */
const SINK = Symbol.for("cvtailor.alertSink");
const PENDING = Symbol.for("cvtailor.alertsPending");
const holder = globalThis as { [SINK]?: AlertSink; [PENDING]?: Set<Promise<unknown>> };

/** Where error-level log lines go, as well as the console. Unset, they go nowhere else. */
export function setAlertSink(sink: AlertSink | undefined): void {
  holder[SINK] = sink;
}

/** Called by every log() for an error. Takes fields already made safe, and the exception if there was one. Never throws. */
export function raiseAlert(event: string, fields: Fields, exception?: unknown): void {
  try {
    holder[SINK]?.(event, fields, exception);
  } catch {
    // An alert that can't be sent must not break what was being logged.
  }
}

/** Waits for alerts still being posted, so a process about to exit doesn't lose them. */
export async function alertsSent(): Promise<void> {
  await Promise.allSettled([...(holder[PENDING] ?? [])]);
}

function track(pending: Promise<unknown>): void {
  const set = (holder[PENDING] ??= new Set());
  set.add(pending);
  void pending.finally(() => set.delete(pending));
}

/** A quoted identifier, such as a table or column name, is kept. Anything else quoted may be a value. */
const IDENTIFIER = /^[\w.$:/-]{0,63}$/;
const MAX_MESSAGE = 400;

/**
 * An error message with the values taken out: addresses, quoted text, query strings, Postgres
 * key values and long numbers. What's left says what went wrong without saying to whom.
 */
export function scrubbed(text: string, max = MAX_MESSAGE): string {
  const quoted = (mark: string) => (whole: string, inner: string) => (IDENTIFIER.test(inner) ? whole : `${mark}…${mark}`);
  const clean = text
    .replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/g, "$1?…")
    .replace(ADDRESS, "[email]")
    .replace(/"([^"\n]*)"/g, quoted('"'))
    .replace(/`([^`\n]*)`/g, quoted("`"))
    .replace(/(?<![A-Za-z])'([^'\n]*)'(?![A-Za-z])/g, quoted("'"))
    .replace(/=\([^)]*\)/g, "=(…)")
    .replace(/\d{7,}/g, "[number]");
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export interface ExceptionReport {
  type: string;
  code?: string;
  message?: string;
  /** Other properties that help: HTTP status, request id, syscall, Postgres hint, zod issues. */
  details: string[];
  /** Call sites, nearest first, with paths cut to the repo. */
  stack: string[];
  /** Frames left out for length. */
  moreFrames: number;
}

const MAX_FRAMES = 15;
const MAX_CAUSES = 4;
const DETAIL_PROPS = ["status", "statusCode", "step", "errno", "syscall", "requestID", "request_id", "type", "hint"];

/** `/Users/…/JobTailor/apps/web/x.ts` and `/var/task/apps/web/x.ts` both become `apps/web/x.ts`. */
function shortFrame(frame: string): string {
  return frame
    .replace(/file:\/\//g, "")
    .replace(/(^|[\s(])\/[^\s()]*?\/((?:apps|packages|node_modules|\.next)\/)/g, "$1$2");
}

function frames(stack: unknown): { stack: string[]; moreFrames: number } {
  if (typeof stack !== "string") return { stack: [], moreFrames: 0 };
  const all = stack
    .split("\n")
    .filter((line) => /^\s+at /.test(line) && !line.includes("node:internal"))
    .map((line) => shortFrame(line.trim().replace(/^at /, "")));
  return { stack: all.slice(0, MAX_FRAMES), moreFrames: Math.max(0, all.length - MAX_FRAMES) };
}

/** zod lists what failed by path and code, which says more than its message and holds no values. */
function issueLines(issues: unknown): string[] {
  if (!Array.isArray(issues)) return [];
  const lines = issues.slice(0, 8).map((issue: { path?: unknown; code?: unknown; expected?: unknown }) => {
    const path = Array.isArray(issue.path) && issue.path.length ? issue.path.map(String).join(".") : "(root)";
    const expected = logIdentifier(issue.expected);
    return `issue ${scrubbed(path, 80)}: ${logIdentifier(issue.code) ?? "?"}${expected ? ` (expected ${expected})` : ""}`;
  });
  return issues.length > 8 ? [...lines, `… ${issues.length - 8} more issues`] : lines;
}

function report(err: unknown): ExceptionReport {
  if (err instanceof Error || (typeof err === "object" && err !== null)) {
    const e = err as Record<string, unknown>;
    const details: string[] = [];
    for (const prop of DETAIL_PROPS) {
      const value = e[prop];
      if (typeof value === "number") details.push(`${prop}: ${value}`);
      else if (typeof value === "string" && value) details.push(`${prop}: ${scrubbed(value, 160)}`);
    }
    if (Array.isArray(e.errors)) details.push(`errors: ${e.errors.length}`);
    details.push(...issueLines(e.issues));
    const zod = Array.isArray(e.issues);
    return {
      type: err instanceof Error ? err.name : (logIdentifier(e.name) ?? "object"),
      code: logIdentifier(e.code),
      // A ZodError's message is its issues as JSON, already listed above.
      message: typeof e.message === "string" && e.message && !zod ? scrubbed(e.message) : undefined,
      details,
      ...frames(e.stack),
    };
  }
  return { type: typeof err, message: err === undefined ? undefined : scrubbed(String(err)), details: [], stack: [], moreFrames: 0 };
}

/** The exception and what caused it, outermost first. An AggregateError's first few errors count as causes. */
export function describeException(err: unknown): ExceptionReport[] {
  const out: ExceptionReport[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [err];
  while (queue.length && out.length < MAX_CAUSES) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(report(next));
    if (typeof next === "object" && next !== null) {
      const { cause, errors } = next as { cause?: unknown; errors?: unknown };
      if (cause !== undefined) queue.push(cause);
      if (Array.isArray(errors)) queue.push(...errors.slice(0, 2));
    }
  }
  return out;
}

/** Slack reads &, < and > as markup. In a code block a backtick would end it. */
function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function codeBlock(lines: string[]): string {
  return `\`\`\`${escape(lines.join("\n").replace(/`/g, "'"))}\`\`\``;
}

/** Slack refuses a section over 3000 characters. A code block cut short is closed again. */
function section(text: string): { type: "section"; text: { type: "mrkdwn"; text: string } } {
  if (text.length <= 2900) return { type: "section", text: { type: "mrkdwn", text } };
  const cut = `${text.slice(0, 2900)}…`;
  const open = (cut.match(/```/g) ?? []).length % 2 === 1;
  return { type: "section", text: { type: "mrkdwn", text: open ? `${cut}\`\`\`` : cut } };
}

/** Room for an exception's lines in its section, leaving some for escaping. */
const STACK_ROOM = 2600;

export interface AlertExtras {
  /** How many times the same failure happened since the last post, unposted. */
  repeats?: number;
  /** Where it ran: region, commit, host. */
  context?: string[];
}

/**
 * The message: the event and where it came from, the log line's fields, then the exception,
 * each cause with its message, details and stack. `text` is what the notification shows.
 */
export function slackMessage(event: string, source: string, fields: Fields, exception?: unknown, extras: AlertExtras = {}): { text: string; blocks: unknown[] } {
  const lines = Object.entries(fields)
    .filter(([k, v]) => v !== undefined && v !== null && k !== "t" && k !== "level" && k !== "event")
    .map(([k, v]) => `${k}: ${String(v)}`);
  const reports = exception === undefined ? [] : describeException(exception);
  const blocks: unknown[] = [section(`:rotating_light: *${escape(event)}* · ${escape(source)}`)];
  if (lines.length) blocks.push(section(codeBlock(lines)));

  reports.forEach((r, i) => {
    const head = `${i === 0 ? "" : "Caused by "}*${escape(r.type)}*${r.code ? ` \`${escape(r.code)}\`` : ""}`;
    const message = r.message ? `\n>${escape(r.message).replace(/\n/g, "\n>")}` : "";
    const body = [...r.details, ...(r.details.length && r.stack.length ? [""] : [])];
    // As many frames as fit the section, nearest first, so the count of the rest isn't cut off.
    let room = STACK_ROOM - head.length - message.length - body.join("\n").length;
    let shown = 0;
    for (const frame of r.stack) {
      const line = `at ${frame}`;
      if (line.length + 1 > room) break;
      body.push(line);
      room -= line.length + 1;
      shown++;
    }
    const hidden = r.moreFrames + r.stack.length - shown;
    if (hidden) body.push(`… ${hidden} more frames`);
    blocks.push(section(`${head}${message}${body.length ? `\n${codeBlock(body)}` : ""}`));
  });

  const context = [...(extras.context ?? []), ...(extras.repeats ? [`+${extras.repeats} more like this since the last post`] : [])];
  if (context.length) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: escape(context.join(" · ")) }] });

  const first = reports[0];
  const summary = first ? `: ${first.type}${first.message ? `: ${first.message}` : ""}` : "";
  return { text: `${event} · ${source}${summary}`.slice(0, 300), blocks };
}

/** The same failure repeated, such as a missing table on every page view, alerts once per window. */
const REPEAT_WINDOW_MS = 10 * 60_000;
const SAME_FAILURE = ["op", "status", "code", "path", "routePath", "errorType", "kind", "source", "host"];

export interface SlackAlertOptions {
  webhookUrl: string;
  /** Which app sent it, such as "web (production)" or "worker". */
  source: string;
  /** Where it runs, shown under each alert: region, commit, host. */
  context?: string[];
  /** Keeps a serverless function alive until the post is done. */
  keepAlive?: (pending: Promise<unknown>) => void;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Posts each new failure to a Slack incoming webhook. Failing to post is logged as a warning, never an error, so it can't alert about itself. */
export function slackAlerts(options: SlackAlertOptions): AlertSink {
  const post = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const lastSent = new Map<string, number>();
  const repeats = new Map<string, number>();
  return (event, fields, exception) => {
    const key = [event, ...SAME_FAILURE.map((k) => fields[k] ?? "")].join("|");
    const at = now();
    const last = lastSent.get(key);
    if (last !== undefined && at - last < REPEAT_WINDOW_MS) {
      repeats.set(key, (repeats.get(key) ?? 0) + 1);
      return;
    }
    lastSent.set(key, at);
    const message = slackMessage(event, options.source, fields, exception, { repeats: repeats.get(key), context: options.context });
    repeats.delete(key);
    const send = (body: object) =>
      post(options.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const pending = send(message)
      // Slack refuses the whole post over one bad block. The text alone still gets through.
      .then((res) => (res.status === 400 ? send({ text: message.text }) : res))
      .then((res) => {
        if (!res.ok) console.warn(JSON.stringify({ t: new Date().toISOString(), level: "warn", event: "alert.failed", status: res.status }));
      })
      .catch(() => console.warn(JSON.stringify({ t: new Date().toISOString(), level: "warn", event: "alert.failed" })));
    track(pending);
    options.keepAlive?.(pending);
  };
}
