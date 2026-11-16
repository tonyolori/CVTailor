import { afterEach, expect, it, vi } from "vitest";
import { setAlertSink } from "@cvtailor/core/alert";
import { log } from "../src/log";

// Its own file: the worker's sleep tracker is shared, and the sleep faked here must not reach other tests.
afterEach(() => {
  setAlertSink(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("marks an error just after the Mac woke, in the line and the alert's heading", () => {
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((line: string) => errors.push(line));
  const alerts: { event: string; fields: Record<string, unknown> }[] = [];
  setAlertSink((event, fields) => alerts.push({ event, fields }));

  log("db.failed", { code: "ENOTFOUND" }, "error");
  expect(alerts[0]!.event).toBe("db.failed");

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 6 * 3_600_000);
  log("db.failed", { code: "ENOTFOUND" }, "error");
  expect(alerts[1]!.event).toBe("db.failed (PC was asleep)");
  expect(alerts[1]!.fields.pcSlept).toMatch(/^asleep 6h 0m, woke under a minute ago$/);
  expect(JSON.parse(errors[1]!)).toMatchObject({ event: "db.failed", pcSlept: alerts[1]!.fields.pcSlept });
});
