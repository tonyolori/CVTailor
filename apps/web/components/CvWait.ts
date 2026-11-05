import { errorFields, log, loggedFetch } from "@/lib/log";
const FAST_MS = 4_000;
const SLOW_MS = 10_000;
const FAST_FOR_SECONDS = 30;
/** Longer than the server lets a CV run, so a request that's still going really is stuck. */
const GIVE_UP_SECONDS = 330;

export const STILL_WRITING_MESSAGE = "It's taking longer than usual. Check back in a few minutes, and if it isn't there, try again. It won't use up a CV.";

/**
 * Waits on a CV being written on the server. Checks less often once it's taking a while, and
 * stops after a few minutes so a page can't poll forever. Stopping here doesn't stop the writing.
 */
export async function pollCvRequest(id: number, signal?: AbortSignal): Promise<{ status: "done" | "failed" | "waiting" | "cancelled"; error?: string }> {
  const started = Date.now();
  for (;;) {
    if (signal?.aborted) return { status: "cancelled" };
    try {
      const res = await loggedFetch(`/api/cv-requests/${id}`, { signal });
      const body = (await res.json()) as { status: string; error?: string };
      if (body.status === "done") return { status: "done" };
      if (body.status === "failed") return { status: "failed", error: body.error };
    } catch (err) {
      // A dropped connection isn't the CV failing, so keep waiting unless this was cancelled.
      if (signal?.aborted) return { status: "cancelled" };
      log("cv_request.poll_failed", { requestId: id, ...errorFields(err) }, "warn");
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    if (seconds >= GIVE_UP_SECONDS) return { status: "waiting", error: STILL_WRITING_MESSAGE };
    await new Promise((resolve) => setTimeout(resolve, seconds < FAST_FOR_SECONDS ? FAST_MS : SLOW_MS));
  }
}
