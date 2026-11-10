import { safeLogFields, type LogField } from "@cvtailor/core/log";
import { raiseAlert } from "@cvtailor/core/alert";

/** Structured log line of ids and counts only, the same as the worker's and the web app's. */
export function log(event: string, fields: Record<string, LogField> = {}, level: "info" | "warn" | "error" = "info"): void {
  const safe = safeLogFields(fields);
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...safe });
  if (level === "error") {
    console.error(line);
    raiseAlert(event, safe);
  } else if (level === "warn") console.warn(line);
  else console.log(line);
}
