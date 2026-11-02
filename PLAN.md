# JobTailor build plan

Restates the handoff spec's phases, with the adjustments proposed during the build. The spec's decisions stand unless listed here.

## Phases

| Phase | Scope | Exit check |
| --- | --- | --- |
| 0 | Orientation: `CLAUDE.md`, `docs/SETUP.md`, this file | Typecheck and tests pass |
| 0.5 | Generalize `packages/core` to any occupation, work mode and location; migration `0002` | Tests cover all three personas |
| 1 | Local Supabase, RLS tests with two real users, signup hook, seeds for Tony and two synthetic personas | RLS suite passes against local Postgres |
| 2 | `SourceAdapter`, ported fetchers and ATS scanner, `companies` seed, discovery job, parser fixtures | Each parser tested against fixtures |
| 3 | Pre-filter, enrichment, live verification, `eval:enrich` harness | Agreement numbers reported for all three personas |
| 4 | Per-user pipeline: match, tailor, verify facts, render, budgets, resumable stages | Idempotent end-to-end run with the fake provider |
| 5 | Email template, queue by `send_time`, scheduler, alert, Task Scheduler and systemd docs | Email renders; catch-up logic tested |
| 6 | Web app: login, consent, onboarding, dashboard, editor, settings, admin | `next build` passes; PDF route works with the worker off |
| 7 | Paystack billing, webhook, entitlement gating | Signature and idempotency tests pass with test keys only |
| 8 | Docker, backups, log hygiene, rate limits, audit, `README.md` | Docker image builds |

## Adjustments to the spec

1. **`packages/llm` (new).** One `LlmProvider` interface with three implementations, picked by the `LLM_PROVIDER` env var, so no pipeline code knows which is active:
   - `claude-subscription`: Agent SDK using the owner's Claude login. Early testing, no API key.
   - `anthropic-api`: Anthropic SDK with an API key, prompt caching and the Batch API. The path for real users.
   - `fake`: deterministic responses for tests.
2. **Subscription mode is owner-and-personas only.** Anthropic's terms do not allow routing requests through a Free, Pro, Max or Ultra plan on behalf of other users ([legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)). In subscription mode the worker runs AI stages for the account in `OWNER_EMAIL` and for synthetic personas (`profiles.is_synthetic`). Any other user keeps working in the dashboard and gets code-only gates, but their AI stages are recorded as `skipped` with a reason until the provider is `anthropic-api`. There is deliberately no override flag.
3. **Web AI goes through a queue when needed.** Vercel has no Claude login, so onboarding's AI steps (CV to fact library, title suggestions) are `ai_tasks` rows the worker picks up. With an API key on the web host they run inline. Manual entry always works, so a user can onboard with the worker off.
4. **`packages/render` (new).** The resume and cover-letter template lives in its own package, because `@react-pdf/renderer` should not load wherever `core` is imported.
5. **Enrichment input is capped, not silently truncated into wrong answers.** Posting text over the limit is cut at a paragraph boundary and the job is flagged, because the location words are usually near the top or in the structured fields, which are always sent whole.
6. **LinkedIn, Indeed and the legacy browser steps are out**, as the spec says. Claude's own web search discovery step is replaced by the keyless discovery job.
7. **Source research is deferred, not blocking.** The spec's Phase 2 STOP point becomes `docs/SOURCES.md` for Tony's choice. No scraper is built until he picks; the ported adapters and the generic ATS adapter ship meanwhile, and a search with no relevant source says so in the summary.
8. **Work happens on branch `build/v1`.** `main` holds the imported baseline until Tony merges.
