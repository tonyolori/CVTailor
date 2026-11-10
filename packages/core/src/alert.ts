import type { LogField } from "./log";

type Fields = Record<string, LogField>;
export type AlertSink = (event: string, fields: Fields) => void;

/**
 * Kept on globalThis, not in this module: Next can load a package twice, once for
 * instrumentation and once for routes, and an alert set up in one must reach the other.
 */
const SINK = Symbol.for("cvtailor.alertSink");
const holder = globalThis as { [SINK]?: AlertSink };

/** Where error-level log lines go, as well as the console. Unset, they go nowhere else. */
export function setAlertSink(sink: AlertSink | undefined): void {
  holder[SINK] = sink;
}

/** Called by every log() for an error. Takes fields already made safe, and never throws. */
export function raiseAlert(event: string, fields: Fields): void {
  try {
    holder[SINK]?.(event, fields);
  } catch {
    // An alert that can't be sent must not break what was being logged.
  }
}

/** The same failure repeated, such as a missing table on every page view, alerts once per window. */
const REPEAT_WINDOW_MS = 10 * 60_000;
const SAME_FAILURE = ["op", "status", "code", "path", "routePath", "errorType", "kind", "source", "host"];

export interface SlackAlertOptions {
  webhookUrl: string;
  /** Which app sent it, such as "web (production)" or "worker". */
  source: string;
  /** Keeps a serverless function alive until the post is done. */
  keepAlive?: (pending: Promise<unknown>) => void;
  fetch?: typeof fetch;
  now?: () => number;
}

/** The message: the event and where it came from, then each field on its own line. */
export function slackMessage(event: string, source: string, fields: Fields): { text: string } {
  const lines = Object.entries(fields)
    .filter(([k, v]) => v !== undefined && v !== null && k !== "t" && k !== "level" && k !== "event")
    .map(([k, v]) => `${k}: ${String(v).replace(/`/g, "'")}`);
  const head = `:rotating_light: *${event}* · ${source}`;
  return { text: lines.length ? `${head}\n\`\`\`${lines.join("\n")}\`\`\`` : head };
}

/** Posts each new failure to a Slack incoming webhook. Failing to post is logged as a warning, never an error, so it can't alert about itself. */
export function slackAlerts(options: SlackAlertOptions): AlertSink {
  const post = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const lastSent = new Map<string, number>();
  return (event, fields) => {
    const key = [event, ...SAME_FAILURE.map((k) => fields[k] ?? "")].join("|");
    const at = now();
    const last = lastSent.get(key);
    if (last !== undefined && at - last < REPEAT_WINDOW_MS) return;
    lastSent.set(key, at);
    const pending = post(options.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackMessage(event, options.source, fields)),
    })
      .then((res) => {
        if (!res.ok) console.warn(JSON.stringify({ t: new Date().toISOString(), level: "warn", event: "alert.failed", status: res.status }));
      })
      .catch(() => console.warn(JSON.stringify({ t: new Date().toISOString(), level: "warn", event: "alert.failed" })));
    options.keepAlive?.(pending);
  };
}
