import { spawn } from "node:child_process";
import { errorFields } from "@cvtailor/core/log";
import { log } from "./log";

/**
 * Stops the Mac sleeping on its own while a run is in progress, and returns a function that
 * lets it sleep again. A run cut by sleep resumes hours later on a network that's still waking
 * up, which is what fails its database writes. Closing the lid still sleeps the Mac. Elsewhere
 * this does nothing. `-w` ends the assertion with the worker, should the worker die mid-run.
 */
export function stayAwake(spawnFn: typeof spawn = spawn, platform: NodeJS.Platform = process.platform): () => void {
  if (platform !== "darwin") return () => undefined;
  const child = spawnFn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
  child.on("error", (err) => {
    const { errorType, code } = errorFields(err);
    log("awake.failed", { kind: errorType, code }, "warn");
  });
  return () => {
    child.kill();
  };
}
