/** Waits on an onboarding AI task. A closed worker just means it keeps waiting, and the user can carry on by hand. */
export async function pollTask<T>(id: number, onTick?: (seconds: number) => void, signal?: AbortSignal): Promise<{ status: string; output?: T; error?: string }> {
  const started = Date.now();
  for (;;) {
    if (signal?.aborted) return { status: "cancelled" };
    const res = await fetch(`/api/tasks/${id}`, { signal });
    const body = (await res.json()) as { status: string; output?: T; error?: string };
    if (body.status !== "pending" && body.status !== "running") return body;
    onTick?.(Math.round((Date.now() - started) / 1000));
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
