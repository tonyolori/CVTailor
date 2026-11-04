# UI redesign and new CV features

Agreed through a run of clickable prototypes, 3 to 4 November 2026. Tony asked for it to be built directly from the final prototype.

## Intent

The old dashboard was a plain list. Replace every screen with a light, blue design where the tailored CV is the star, so the product looks like what it does. Every existing feature stays. Three features are new.

## What was decided

| Area | Decision |
| --- | --- |
| Look | Light only, blue. No dark mode, no mixed-size blocks, no email-style layout. |
| Landing page | "The Fitting": big serif headline, then a CV that rewrites itself for each job as you scroll. |
| Dashboard | A sidebar of labels, job titles in the middle, a large CV beside them. Body text in Inter. |
| Reading a posting | "View job" slides the posting over the CV. "Back to CV" closes it. |
| CV on request | Jobs with no CV get a button that writes one from the posting. Paid plans only. |
| Write a CV page | Paste any job and get a CV from your own library. Paid plans only. |
| Waitlist | The landing page links to a page where people register interest. Tony invites them from admin. |
| CV styles | Signed-in users choose a style for CVs and PDFs: Fitted (new, the default), Classic (the original design), Plain and Compact. One CV can override it in the editor. |
| CV editor | Redesigned, keeping everything it did. |
| Payments | Paystack, which was already built. |

## Approaches

The prototype could have been copied as one client-side page, or rebuilt on the existing server components and data. It's rebuilt, because the app's auth, RLS and server actions already do the real work and a copied page would have had to re-implement them. Tony chose the design, and this was my call.

## Calls made while building

These were suggested in the prototype or settled here, so they're easy to change.

- **Daily limit:** 5 CVs on request per person per UTC day, set by `CV_REQUESTS_PER_DAY`. Tony confirmed paid-only but gave no number.
- **Light only:** the old automatic dark mode is gone, following "no dark-mode feel".
- **Invite email:** inviting from the waitlist adds the person to the allow-list and emails them, because otherwise they'd never know.
- **Waitlist fields:** email, consent, and optional name and kind of work.
- **Pasted jobs:** their own sidebar label, and they can move through the application stages.
- **Jobs with no posting text:** these send people to the Write a CV page to paste it, and the CV lands on the original job.
- **Landing examples:** one invented person per page load, from several occupations, so it doesn't read as a service for one profession.
- **Other screens:** the same look, as calm working pages with no scroll effects.

## Rules that shaped the build

- **Pasted jobs are private.** `jobs` was readable by every signed-in user, so a job with an `owner_id` is now visible only to its owner. The daily pipeline ignores owned jobs.
- **Paid checks run twice.** The web route refuses first, for a clear message. The worker checks again, because it's what spends the money, and the insert policy stops users queuing these tasks directly.
- **Pasted text is untrusted.** It goes through the same tool-less enrichment as any posting, is rendered as plain text, and its applicant instructions are surfaced, never obeyed.
- **Fact integrity is unchanged.** Requested CVs use the same generate, verify and regenerate loop. A CV that fails isn't kept.
- **Links aren't fetched.** A pasted link only powers the Apply button, so no site's terms are in play.

## Non-goals

- Lighting up which CV line answers which requirement inside the app. That needs new data, so the app shows the posting and CV without it.
- Changing the pipeline, matching or scoring.
