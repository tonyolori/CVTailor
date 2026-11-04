# CV allowance and on-demand CVs

Decided with Tony on 4 November 2026.

## Intent

Make running costs recoverable. CVs are the main cost per user, and many written automatically each morning were for jobs nobody applied to. So matches are free, a CV is written only when someone clicks, and people pay for CVs.

## What was decided

| Area | Decision |
| --- | --- |
| Model | A set number of CVs with a plan, and paid top-ups for more. |
| Matches | Free, and daily for everyone. They don't use up any CVs. |
| When CVs are written | Only when someone clicks. The morning run writes none. |
| Free accounts | Daily matches and 3 CVs, once, to try it. |
| Plans | 30 CVs with the monthly subscription or the 30-day pass. Top-ups add 10. |
| Cover letters | Free with the CV when the posting asks for one. |
| Failures | A CV that can't be written, or is cancelled, is given back. |
| Editing | Free, because no AI is involved. |
| Roll-over | Plan CVs reset at renewal. Top-ups never expire. |
| Daily limit | 7 CVs per person per day, as a safeguard against abuse. |

Prices aren't decided. The examples used were ₦5,000 for a plan and ₦1,500 for a top-up, and they're set by environment variables.

## Approaches

Four models were compared: a flat unlimited plan, a monthly allowance with top-ups, credits only, and a one-off pass. Tony chose the allowance with top-ups, because a flat plan lets heavy users cost more than they pay, and credits alone bring little repeat income. The one-off pass stays as a second way to buy the same allowance, since bank transfer and USSD can't renew.

## Calls made while building

- **Spending order:** plan CVs first since they expire, then free, then top-ups.
- **A pass bought during a plan** adds its CVs to what's left, since it was paid for. A renewal resets to 30, and doesn't reduce a larger balance.
- **Top-ups need an active plan to buy,** but ones already bought keep working after a plan ends.
- **Billing off:** nothing is counted, so every invited user has unlimited CVs.

## How it's enforced

- A CV is taken when it's requested (`reserve_cv`), so two requests can't both take the last one.
- Any outcome but a written CV gives it back, exactly once (`refund_task_cv`).
- With billing on, the worker refuses a task holding no reserved CV. Users can't queue these tasks or change their balances directly.
- A payment's record, plan and CVs change together in one transaction (`record_payment`), and repeating a reference grants nothing.
- `cv_ledger` records every change to an allowance, and is part of each user's data export.
