import { describe, expect, it } from "vitest";
import { AFTER_WAKE_MS, CHECK_MS, duration, sleepTracker } from "../src/sleep";

const MIN = 60_000;

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/** Time passing awake, with the timer firing on schedule as main.ts runs it. */
function awake(c: ReturnType<typeof clock>, s: ReturnType<typeof sleepTracker>, ms: number) {
  for (let left = ms; left > 0; left -= CHECK_MS) {
    c.advance(Math.min(CHECK_MS, left));
    s.check();
  }
}

describe("sleepTracker", () => {
  it("sees nothing while the timer keeps time", () => {
    const c = clock();
    const s = sleepTracker(c.now);
    for (let i = 0; i < 10; i++) {
      c.advance(CHECK_MS + 2_000);
      expect(s.check()).toBeUndefined();
    }
    expect(s.note()).toBeUndefined();
  });

  it("puts a failure just after waking down to the sleep, even before the timer fires", () => {
    const c = clock();
    const s = sleepTracker(c.now);
    c.advance(7 * 60 * MIN);
    expect(s.note()).toBe("asleep 7h 0m, woke under a minute ago");
    awake(c, s, 3 * MIN);
    expect(s.note()).toBe("asleep 7h 0m, woke 3m ago");
    awake(c, s, AFTER_WAKE_MS);
    expect(s.note()).toBeUndefined();
  });

  it("counts a night of brief wake-ups as one sleep", () => {
    const c = clock();
    const s = sleepTracker(c.now);
    for (let i = 0; i < 4; i++) {
      c.advance(15 * MIN);
      s.check();
      c.advance(5_000);
      s.check();
    }
    expect(s.note()).toMatch(/^asleep 1h 0m/);
  });

  it("says how much of a span it slept through", () => {
    const c = clock();
    const start = c.now();
    const s = sleepTracker(c.now);
    c.advance(2 * 60 * MIN + CHECK_MS);
    s.check();
    expect(s.asleepBetween(start + 60 * MIN, start + 90 * MIN)).toBe(30 * MIN);
    expect(s.asleepBetween(start - 60 * MIN, start)).toBe(0);
  });
});

describe("duration", () => {
  it("reads as hours and minutes", () => {
    expect(duration(30_000)).toBe("under a minute");
    expect(duration(42 * MIN)).toBe("42m");
    expect(duration(125 * MIN)).toBe("2h 5m");
  });
});
