# Job sources

## What runs today

| Source | Serves | Terms status | Conditions we honour |
| --- | --- | --- | --- |
| Himalayas | Remote, all fields | Permitted ([API docs](https://himalayas.app/api)) | Apply link unchanged, visible link to Himalayas, own sites only, drop expired jobs |
| Remotive | Remote, all fields | Permitted for testing ([API docs](https://remotive.com/remote-jobs/api)) | Credit and link back. **Commercial use needs their paid API**, and listings can't be shown to collect signups, so this turns off when `BILLING_ENFORCED=true` |
| Remote OK | Remote, all fields | Permitted (legal notice in the API response) | Link back to the Remote OK URL, name the source, don't use the logo |
| We Work Remotely | Remote, all fields | Public feed | RSS only. Its job pages answer 403 to scripts, so they aren't fetched |
| Jobicy | Remote, all fields | Permitted ([docs](https://jobicy.com/jobs-rss-feed)) | Clickable credit, apply links stay on Jobicy, at most one sync an hour |
| Working Nomads | Remote, all fields | Public feed | Link back, name the source |
| Hacker News "Who is hiring?" | Software and data, any mode | Permitted (official Algolia API) | None. Useful only in the first two weeks of a month |
| Employer boards: Greenhouse, Lever, Ashby, Workable, Breezy, Recruitee | Anything, per the `companies` table | Permitted (public career-site endpoints) | Pauses between requests, backoff on 401 and 429 |

## Not run, and why

| Source | Status | Why |
| --- | --- | --- |
| Remote Rocketship | **Not ported** | Its [terms](https://www.remoterocketship.com/terms) (section 5) prohibit scraping. The legacy skill read its HTML. It has a paid API if you want it later. |
| Workable job search (`jobs.workable.com/api/v1/jobs`) | Built, **off** | Undocumented endpoint, and `robots.txt` disallows `/search`. Per-account Workable boards remain on. Turn on with `ENABLED_UNVERIFIED_SOURCES=workable-search` if you're comfortable. |
| LinkedIn, Indeed | Out of v1 | Spec decision. Their terms forbid this kind of automation. |

## Decision needed: sources for on-site, hybrid and non-tech jobs

Every feed above is remote-focused and the seeded boards are tech employers. A nurse in Manchester or a teacher in Lagos gets nothing from them, and their summary says so rather than showing an empty list. These candidates could fill that gap. **Nothing here is built, and I need your choice.**

| Source | Countries | Fields | Terms status | Data quality | Build effort |
| --- | --- | --- | --- | --- | --- |
| [Adzuna API](https://developer.adzuna.com/) | About 16-19, by secondary sources: GB, US, DE, FR, NL, PL, IT, others. Nigeria not confirmed. | All | Official API, free key. TODO(verify): limits and display terms | Good structure; salaries often estimated | Small |
| [Reed Jobseeker API](https://www.reed.co.uk/developers/jobseeker) | UK | All, strong on healthcare, education and trades | Official API, free key. TODO(verify): terms | Good | Small |
| [Arbeitnow API](https://arbeitnow.com/blog/job-board-api/) | Germany and EU | Mostly tech and office | Official, no key. TODO(verify): rate limit | Good, drawn from ATS feeds | Small |
| [USAJOBS API](https://developer.usajobs.gov/) | US federal only | All, including clinical | Official, free key, published limits | Very good | Small |
| [EURES](https://eures.europa.eu/) | EU, EEA and Switzerland | All | Public portal. TODO(verify): whether the search API is meant for reuse | Mixed; no structured salary | Medium |
| Careerjet partner API | Many countries; secondary sources disagree (60+ to 90+) | All | Official, needs a publisher account. TODO(verify): whether it suits an invite-only product | Aggregated, duplicates likely | Small |
| Jooble partner API | About 65 countries per a secondary source | All | Official, free key on request. TODO(verify) | Aggregated | Small |
| Non-tech employers on the existing ATS adapters | Any | Any | Already permitted | Excellent | **Almost none:** add rows to `companies` with `tags` and `countries` |
| Jobberman, MyJobMag, HotNigerianJobs, BrighterMonday | Nigeria and Africa | All | **No official API found.** The only tooling I found scrapes them. Would need their permission. | Unknown | Unknown |

The research was limited: official docs were reachable only for USAJOBS and Arbeitnow, and the rest rests on secondary sources, hence the `TODO(verify)` marks.

**Recommendation:** start with non-tech rows in `companies` for your first real users' countries, since that needs no new code or terms risk. Then add Adzuna and Reed for UK and European coverage. For Nigeria, no compliant source exists yet: ask Jobberman or MyJobMag about a partner feed before anything else.
