/**
 * Sites the worker may only reach through their published feed or API, or not at all.
 * Enforced in politeHttp, so no adapter, live check, discovery job or eval can get around it.
 * Why each is here: docs/SOURCE-ISSUES.md.
 */
interface Restriction {
  host: RegExp;
  /** Paths that remain allowed. Everything else on the host is refused. */
  allow?: RegExp;
}

const RESTRICTIONS: Restriction[] = [
  { host: /(^|\.)linkedin\.com$/ },
  { host: /(^|\.)indeed\.[a-z.]+$/ },
  { host: /(^|\.)remoterocketship\.com$/ },
  { host: /(^|\.)himalayas\.app$/, allow: /^\/jobs\/api(\/|$)/ },
  { host: /(^|\.)weworkremotely\.com$/, allow: /\.rss$/ },
  { host: /^jobs\.workable\.com$/, allow: /^\/api\// },
  { host: /(^|\.)remoteok\.com$/, allow: /^\/api\/?$/ },
  { host: /(^|\.)remotive\.com$/, allow: /^\/api\// },
  { host: /(^|\.)jobicy\.com$/, allow: /^\/api\// },
  { host: /(^|\.)workingnomads\.com$/, allow: /^\/api\// },
];

export function blockedBySourceRules(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  const rule = RESTRICTIONS.find((r) => r.host.test(u.hostname.toLowerCase()));
  if (!rule) return false;
  return !(rule.allow?.test(u.pathname) ?? false);
}
