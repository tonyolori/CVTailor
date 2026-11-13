import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stayAwake } from "../src/awake";

function fakeSpawn() {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  const fn = vi.fn(() => child);
  return { child, fn: fn as unknown as typeof spawn & typeof fn };
}

afterEach(() => vi.restoreAllMocks());

describe("stayAwake", () => {
  it("holds caffeinate for this process until released", () => {
    const { child, fn } = fakeSpawn();
    const release = stayAwake(fn, "darwin");
    expect(fn).toHaveBeenCalledWith("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
    expect(child.kill).not.toHaveBeenCalled();
    release();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("does nothing off macOS", () => {
    const { fn } = fakeSpawn();
    stayAwake(fn, "linux")();
    expect(fn).not.toHaveBeenCalled();
  });

  it("warns rather than crashing when caffeinate can't start", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { child, fn } = fakeSpawn();
    stayAwake(fn, "darwin");
    child.emit("error", Object.assign(new Error("spawn caffeinate ENOENT"), { code: "ENOENT" }));
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({ event: "awake.failed", code: "ENOENT" });
  });
});
