const windows = new Map<string, { count: number; resetAt: number }>();

/**
 * Fixed-window limiter. Per server instance, so on serverless hosts it slows abuse rather
 * than stopping it outright. Supabase's own auth limits sit behind it.
 */
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    if (windows.size > 10_000) windows.clear();
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  w.count++;
  return w.count <= limit;
}

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
