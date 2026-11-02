/**
 * An absolute URL on this site. Built from the configured address, because behind a proxy or
 * `next start` the request's own URL can name an internal host, and cookies wouldn't follow.
 */
export function siteUrl(path: string, request?: { url: string }): URL {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? (request ? new URL(request.url).origin : "http://127.0.0.1:3000");
  return new URL(path, base);
}
