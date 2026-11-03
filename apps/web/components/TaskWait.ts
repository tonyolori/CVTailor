const FAST_MS = 3_000;
const SLOW_MS = 10_000;
const FAST_FOR_SECONDS = 30;
const GIVE_UP_SECONDS = 300;

export const WORKER_OFF_MESSAGE = "The background worker didn't pick this up, so it may be off. Try again later, or enter your details by hand.";

/**
 * Waits on an onboarding AI task. Checks less often once it's clearly waiting on the worker,
 * and gives up after a few minutes so a worker that's off can't leave a page polling forever.
 */
export async function pollTask<T>(id: number, onTick?: (seconds: number) => void, signal?: AbortSignal): Promise<{ status: string; output?: T; error?: string }> {
  const started = Date.now();
  for (;;) {
    if (signal?.aborted) return { status: "cancelled" };
    try {
      const res = await fetch(`/api/tasks/${id}`, { signal });
      const body = (await res.json()) as { status: string; output?: T; error?: string };
      if (body.status !== "pending" && body.status !== "running") return body;
    } catch {
      // A dropped connection isn't the task failing, so keep waiting unless this was cancelled.
      if (signal?.aborted) return { status: "cancelled" };
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    onTick?.(seconds);
    if (seconds >= GIVE_UP_SECONDS) {
      await cancelTask(id);
      return { status: "failed", error: WORKER_OFF_MESSAGE };
    }
    await new Promise((resolve) => setTimeout(resolve, seconds < FAST_FOR_SECONDS ? FAST_MS : SLOW_MS));
  }
}

/** Drops a task nobody is waiting for, so the worker doesn't spend on it. A task already running finishes. */
export async function cancelTask(id: number): Promise<void> {
  await fetch(`/api/tasks/${id}`, { method: "DELETE" }).catch(() => undefined);
}
