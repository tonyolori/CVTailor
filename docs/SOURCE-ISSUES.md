# Problems getting jobs

What actually went wrong when fetching postings, and what to expect next time. For which sources we use and on what terms, see [`SOURCES.md`](SOURCES.md).

**Evidence:** your old skill's daily logs and notes (30 Oct to 2 Nov 2026), and this build's testing on 2 Nov 2026: one status check of all 123 sources and boards, two eval runs replaying `seen.tsv`, and three real worker runs.

## The short version

- **APIs and feeds are reliable.** All 123 endpoints answered 200 at our request pace, with no 401s or 429s in any real run.
- **Individual job pages are not.** Most failures are pages built for browsers, behind Cloudflare, or rendered with JavaScript.
- **The worst problems returned 200.** A wrong "worldwide" label or a fake date looks like success. That's why the structured-location rule and the date rule exist.

## Errors we hit

| Where | What came back | Evidence | What it means | Status |
| --- | --- | --- | --- | --- |
| Indeed (`www`, `uk`) | **401** on all 3 attempts, for both URLs. Earlier, a Cloudflare "Additional Verification Required" page | Eval, 2 Nov. Old logs, 30 and 31 Oct | Bot protection | Out of v1, blocked in code |
| LinkedIn | Sign-in walls, and descriptions that wouldn't load (Maisa, Tailscale). One page did load in the eval | Old log, 2 Nov. Eval | Unreliable, and its terms forbid automation | Out of v1, blocked in code |
| Himalayas job pages | **0 of 34 readable**. Cloudflare check in a browser too | Eval. Old log, 1 Nov | Pages are protected, and the API is the only route | API only, pages blocked in code |
| We Work Remotely job pages | **403**. Only 1 of 11 readable | Old skill notes. Eval | Only the RSS feed works | RSS only, pages blocked in code |
| Workable (`jobs.workable.com/view`) | 0 of 3 readable | Eval | Page text isn't reachable | Pages blocked in code. Search adapter off |
| Workable (`apply.workable.com`) | **Cloudflare 1015** on bursts. `huzzle` (2,518 postings) was rate-limited partway | Old notes, 2 Nov | Rate limit | 3-second gap, no problem at this pace |
| Ashby API | **401** on bursts | Old notes | Rate limit disguised as an auth error | 1.5-second gap, plus backoff on 401 |
| Ashby API, slug `toggl` | **404**, though the page works in a browser | Old notes. Eval | Board isn't published through the API | Open: Toggl can't be scanned |
| Ashby API, slug `pydantic` | Not found | Old notes, 2 Nov | Wrong slug, or the company left Ashby | Kept as a lead |
| `boards-api.eu.greenhouse.io` | **Connection failed** (no HTTP response) | Status check, 2 Nov | This host isn't usable, though the old scanner tried it | Fixed: EU boards are served by the main host |
| Lever, `jobgether` | Over the old **25-second timeout**, with 4,101 roles | Old notes | Too large, and low yield anyway | Left as a lead |
| Zoho Recruit (Scopic, thinkBridge) | 0 of 3 readable: empty without JavaScript | Old notes. Eval | Needs a browser, which v1 doesn't have | Open: these roles can't be verified |
| Fast AI Jobs | **403** to scripts | Old notes | Blocks automation | Not used |
| Inference Jobs | Cloudflare check | Old log, 31 Oct | Blocks automation | Not used |
| Real Work From Anywhere | **404** on `/jobs` | Old notes | Listing page is gone | Not used |
| `jobs.dropbox.com` | 0 of 1 readable | Eval | Cause not measured | Open: minor |
| Remote Rocketship | Worked fine, but its terms prohibit scraping | Terms, section 5 | Allowed by the server, not by the rules | Not ported |
| DailyRemote, NoDesk, RemoteYeah, JustRemote, 4dayweek | 200 with no job data, because they render client-side | Old logs | Nothing to parse | Not used |
| Arc.dev, Wellfound | 200 with no usable location or company data | Old notes | Nothing to parse | Not used |

### Bugs of our own this exposed

| Problem | What happened | Status |
| --- | --- | --- |
| `URI too long` | The first real run **crashed after collecting 6,199 postings**, because the "already stored?" check put them all in one URL. Tests with six jobs never saw it | Fixed, tested with 1,200 |
| The cap went to one source | All 60 enriched postings were from Himalayas, because it's fetched first, so you got no picks | Fixed: employer boards first, then newest |
| Wrong-company boards | Discovery added `recruitee:bright` for "Bright Vision Technologies", by trying the first word alone. It's probably someone else's board | Fixed for new rows. Bad rows could remain in a database that ran the old code |
| Replay ignored the rules | The eval requested Indeed and LinkedIn pages, because `seen.tsv` contains those URLs | Fixed: `sources/restricted.ts` blocks them for all code |

## Wrong data that returned 200

These don't look like errors. Each came from a real posting.

| Source | What was wrong | Example |
| --- | --- | --- |
| We Work Remotely | "Anywhere in the World" on a country-locked role | Vested (US, with 401k). Dropbox: Greenhouse says "Remote - Mexico" |
| Himalayas | Worldwide flag on EU, US and Canada roles | Old skill notes |
| Himalayas | Same timestamp on every role from one company, hiding the true age | Hivex: all 2026-11-01, though related listings point to March 2025 and February 2026 |
| LinkedIn | Repost shown as hours old | dexter health: "hours old", but `datePosted` was 2026-04-26 |
| JOIN | Always "Remote (worldwide)", while the JSON-LD says otherwise | Blockvora: JSON-LD says Switzerland. **You picked this role, and the new system rejects it** |
| Breezy | The page's JSON-LD holds only the first location | Social Discovery Group: JSON-LD says Poland, while the board lists Worldwide too. Fixed by reading the board |
| Greenhouse | Evergreen roles reposted, so `updated_at` looks fresh | Use `first_published`, as the code does |
| Ashby | Text says "global" or "anywhere", while the location list names countries | ElevenLabs, Oyster, Toggl |
| Turing | "Global - Remote" hiding one country in the text | Brazil, 2 Nov |
| Ritual | Fresh date on We Work Remotely, while the Greenhouse roles date from 2023 to 2025 | Old notes |
| careers-page.com | No posting date at all | Hivex: 12 postings can't pass the age filter from this page alone |
| Remote OK | Blank location on 14 of 100, and garbled text such as `SÃ£o Paulo` | Live response, 2 Nov. Open: the garbling isn't repaired |
| Empty boards | 200 with no jobs, so the failure rule never fires | `mem0`, `doist`, `x-team` today. Earlier `Langfuse`, `Deel`, `CopilotKit` |

## What to expect next time

### Most of your matches can't be verified at the employer

**This is the biggest limit today.** Himalayas, Remote OK, Jobicy, Remotive, Working Nomads and We Work Remotely all link back to themselves rather than to the employer, and most of their pages are off limits. So those picks ship marked **Unverified**, relying on the source's own label, which is the data the table above shows can be wrong.

The old skill got around this with a browser and web search. The practical fix is to look the company up in `companies` and find the same role on its board, which isn't built yet. Himalayas supplied 60 of 60 in the first real run, so this affects a lot of picks.

### Rate limits

| Source | Expect | Plan |
| --- | --- | --- |
| Himalayas | Without a key, every caller shares one allowance, so **429s can appear for reasons unrelated to us**. A free key gives 60 a minute and 10,000 a day | Get a free key if 429s appear. The worker doesn't send one yet |
| Ashby | 401s if requests overlap. 68 boards take about 2 minutes | Don't run two workers or tests at once. The status check and eval overlapping would count |
| Workable | Cloudflare 1015 on bursts, likely during weekly discovery | Discovery is capped at 40 probes a run |
| Jobicy | At most one sync an hour, by its terms | Daily is fine. Don't loop the worker's collect stage |

### Blocks and changes

- **A VPS may be blocked more than your home connection.** Cloudflare often treats data-centre addresses with more suspicion. That's my expectation rather than something I measured, so watch the first week after moving.
- **Anything HTML can start returning 403 at any time.** APIs change less often. Remotive's response still carries a 2022 notice about moving its domain, so endpoints do move.
- **Companies change ATS.** A board returning 404 twice in a row moves to leads. A short outage over two runs would do the same, so check `companies` for rows marked "Board stopped responding".
- **Terms change.** Remotive's free API excludes commercial use, so it turns off when `BILLING_ENFORCED=true`. Re-read the terms before charging anyone.
- **Himalayas requires removing expired jobs.** New postings are handled through `expiryDate`, but one that expires after enrichment stays until a later check closes it.

### Volume and speed

Measured on 2 Nov, on your connection:

| | |
| --- | --- |
| Fetched per run | About 6,200 to 6,400 postings, 5,064 of them from employer boards |
| Kept by the pre-filter | 558 to 561 |
| Download | About 81 MB per status check. **Worth watching on a metered connection** |
| Collection time | About 2.5 minutes |
| Enrichment on your Claude plan | **About 20 seconds each**, one at a time. 558 would take about 3 hours and $1.70 in estimated tokens |
| Largest boards | `elastic` and `okx`, 8.2 MB each. A slow connection could reach the 30-second timeout |

`ENRICH_MAX_PER_RUN` holds the rest for the next run, so a large backlog can age out of the 14-day window before it's read. Only the first day should be this large, since later runs mostly skip what's stored.

### Results will be thin

- **Few roles are open to you.** Across real runs, the location filter rejected 107 of your 120 postings, and many of those failed other filters too. Your old skill's last four runs ranged from zero to a few picks a day, so expect the same.
- **Non-tech and on-site searches depend on sources we don't have.** Every feed is remote-focused and all seeded boards are tech. The nurse persona got one remote near miss and no picks, and its summary says why. Choosing sources is an open decision in `SOURCES.md`.
- **Hacker News only helps early in the month.** Comments arrive in the first week, and there was no November thread yet on 2 Nov.
- **Hacker News posts are free text.** Those that don't follow "Company | Role | Place" or a dashed version are skipped.

## If something breaks

1. Check `select * from daily_runs order by run_date desc limit 3;`. A failed run names the failing step in `detail`.
2. Search the worker log for `http.backoff` (rate limits), `http.blocked_by_source_rules` (a page we refuse to fetch), `collect.source_failed` and `board.moved_to_lead`.
3. Status-check one source by hand, once. Don't loop it.
4. Never answer a block by adding a browser, changing the user agent or rotating IPs. If a source blocks us, use its API or drop it.
