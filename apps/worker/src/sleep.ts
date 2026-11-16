/**
 * Notices when the Mac slept, so failures it caused can say so. A timer that fires far later
 * than it should means the process was suspended. The worker imports nothing else here, so
 * log() can use it without an import cycle.
 */

/** How often the timer checks. */
export const CHECK_MS = 15_000;
/** A gap this much longer than the timer's interval was a sleep, not a busy moment. */
const SLEPT_AFTER_MS = 60_000;
/** Failures this soon after waking are put down to the sleep. Wake-ups shorter than this join one sleep. */
export const AFTER_WAKE_MS = 10 * 60_000;
/** Sleeps kept for the missed-day check, which looks back a week. */
const KEEP_MS = 8 * 86_400_000;

export interface Sleep {
  from: number;
  to: number;
}

export interface SleepTracker {
  /** Looks for a sleep since the last check. Returns it when it's new. */
  check(): Sleep | undefined;
  /** Why a failure now is probably the sleep's doing, or undefined if the Mac hasn't just woken. */
  note(): string | undefined;
  /** How long the Mac was seen asleep between two instants. */
  asleepBetween(from: number, to: number): number;
}

export function sleepTracker(now: () => number = () => Date.now()): SleepTracker {
  let last = now();
  const sleeps: Sleep[] = [];

  function check(): Sleep | undefined {
    const at = now();
    const gap = at - last - CHECK_MS;
    last = at;
    if (gap < SLEPT_AFTER_MS) return undefined;
    const from = at - gap;
    const prev = sleeps.at(-1);
    // Overnight, the Mac wakes for a few seconds every quarter hour. That's still one night's sleep.
    if (prev && from - prev.to < AFTER_WAKE_MS) prev.to = at;
    else sleeps.push({ from, to: at });
    while (sleeps.length && sleeps[0]!.to < at - KEEP_MS) sleeps.shift();
    return sleeps.at(-1);
  }

  return {
    check,
    note() {
      // A request held over the sleep can fail before the timer has fired again.
      check();
      const s = sleeps.at(-1);
      const since = s ? now() - s.to : Infinity;
      if (!s || since > AFTER_WAKE_MS) return undefined;
      return `asleep ${duration(s.to - s.from)}, woke ${duration(since)} ago`;
    },
    asleepBetween(from, to) {
      return sleeps.reduce((sum, s) => sum + Math.max(0, Math.min(to, s.to) - Math.max(from, s.from)), 0);
    },
  };
}

export function duration(ms: number): string {
  if (ms < 60_000) return "under a minute";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** The worker's own tracker. main.ts runs its timer. */
export const sleeps = sleepTracker();
