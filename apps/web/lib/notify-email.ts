import { createHash, randomUUID } from "node:crypto";

/** How long a confirmation link works. */
export const CONFIRM_FOR_MS = 7 * 86_400_000;
/** Saving the same new address again within this window doesn't send another link. */
const RESEND_AFTER_MS = 10 * 60_000;

export interface NotifyState {
  /** The sign-in address. Always confirmed, since signing in proves it. */
  email: string;
  notify_email: string | null;
  notify_email_pending: string | null;
  notify_email_sent_at: string | null;
}

export type NotifyChange =
  /** Back to the sign-in address, or nothing to send to: no confirmation needed. */
  | { kind: "use_sign_in" }
  /** Already the address in use. Any change waiting for confirmation is dropped. */
  | { kind: "unchanged" }
  /** A link went to this address a moment ago. */
  | { kind: "already_sent"; to: string }
  /** A new address: send it a link, and keep emailing the current one until it's used. */
  | { kind: "confirm"; to: string };

/** What saving the "send to" field should do. Addresses compare without case. */
export function notifyChange(state: NotifyState, requested: string, now: Date = new Date()): NotifyChange {
  const want = requested.trim().toLowerCase();
  if (!want || want === state.email.toLowerCase()) return { kind: "use_sign_in" };
  if (want === state.notify_email?.toLowerCase()) return { kind: "unchanged" };
  const sent = state.notify_email_sent_at ? new Date(state.notify_email_sent_at).getTime() : 0;
  if (want === state.notify_email_pending?.toLowerCase() && now.getTime() - sent < RESEND_AFTER_MS) return { kind: "already_sent", to: want };
  return { kind: "confirm", to: want };
}

/** Where email goes right now, while a change waits. */
export function currentAddress(state: NotifyState): string {
  return state.notify_email ?? state.email;
}

export function newToken(): { token: string; hash: string } {
  const token = randomUUID();
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
