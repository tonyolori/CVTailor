# UI profile: CV Tailor web app

Data for the `ui-design` skill. Measured 2026-11-10 from `apps/web/app/globals.css`.

## 1. Platform and stack

- Next.js web app (`apps/web`), plain CSS in `app/globals.css`, no component library.
- Desktop first for the signed-in app, but it must work at phone width (people open match emails on phones).
- Light only. No CJK. No offline.
- Medium density: a list of jobs beside one job's detail. Not a data-dense table screen, except Applications.

## 2. The system (target, from the 2026-11 redesign)

Prototypes live in the published "CV Tailor redesign" canvas. Direction C (one Jobs table with stage
tabs and a side panel) was chosen and built. The system lives at the end of `globals.css`, scoped to
`.ui`, which `AppShell`, the CV editor page and the setup pages put on their root. Public pages (landing,
waitlist, sign-in, pricing, privacy) still use the older styles above it and are not yet migrated.

**Type.** One UI family: Inter. Instrument Serif and Instrument Sans leave the signed-in app. CV fonts
(Source Serif 4, Lora) stay inside the CV sheet only.

| Step | Size / line | Role |
|---|---|---|
| Page title | 22 / 1.25, 600 | One per screen |
| Title | 17 / 1.35, 600 | Job title in a detail pane, section heads in forms |
| Body | 15 / 1.55, 400 | Posting text, reasons, form values |
| Support | 14 / 1.45, 400 | List-row company line, descriptions under fields |
| Meta | 13 / 1.4, 400 or 600 | Counts, dates, tags. Never the most used step. |

Weights: 400 and 600 only.

**Colour.** Cool neutrals and one accent.

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--bg` | #ffffff | Page | |
| `--surface` | #f6f6f7 | Sidebar, selected row, sunken areas | |
| `--line` | #e6e7eb | Dividers (decorative only) | |
| `--line-strong` | #8f94a3 | Field borders, control outlines | 3.03 on white |
| `--ink` | #16181d | Primary text | 17.8 |
| `--text-2` | #4b5060 | Support text | 8.0 / 7.4 on surface |
| `--text-3` | #646a79 | Meta text | 5.4 / 5.0 on surface |
| `--accent` | #1546e0 | Primary button, links, focus, selection | 7.0 both ways |
| `--accent-soft` | #eef2fd | Selected row, accent tag background | accent on it 6.3 |
| `--good` / `--good-bg` | #166b40 / #e9f6ef | Applied, offer, "strong match" | 5.9 |
| `--warn` / `--warn-bg` | #8a5300 / #fdf3e1 | Posting asks applicants something, gaps | 5.8 |
| `--bad` / `--bad-bg` | #b42318 / #fdeceb | CV failed, rejected | 5.8 |

**Spacing.** 4, 8, 12, 16, 24, 32, 48. Nothing in between.

**Radius.** 8px on every control, card and panel. 999px only on small tags and the avatar.

**Depth.** Background change first (`--surface` vs `--bg`). Borders only between list rows and around
fields. Shadow only on what floats: menus, dialogs, toasts (`0 8px 24px rgb(22 24 29 / .12)`).

## 3. Utilities that already exist

- `components/CvSheet.tsx`: on-screen CV, paired with `packages/render/src/template.tsx`. Keep.
- `lib/views.ts`: view labels and which matches each holds. The redesign collapses these.
- `lib/entitlement.ts` `cvAllowance()`: CVs left, shown in the shell.
- `NavLink`, `SideNav`: sidebar links and the phone menu.

## 4. Measured state, 2026-11-10 (what is broken)

- **22 font sizes** in `globals.css`: 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 17, 18, 19, 20, 22, 24, 27, 28,
  30, 32, 34, 40, 42, 44. Adjacent steps (13 / 13.5 / 14 / 14.5 / 15 / 15.5) cannot be told apart. Target: 5.
- **3 UI typefaces** (Inter, Instrument Serif, Instrument Sans) plus 2 CV faces. Target: 1 in the app.
- **10 radii**: 2, 4, 6, 7, 8, 9, 10, 12, 20, 99. Target: 2 (8 and 999).
- **~40 one-off hex colours** outside `:root`. Target: tokens only.
- **20 spacing values**, including 6/7/8/9/10/11/12/14. Target: 7.
- Contrast is fine: the old `--soft` (#40548f) is 7.3:1 on white. Colour is not the problem; hierarchy is.

UX problems found in the same audit (screens at 1440 wide, persona.nurse):

1. Sidebar has 15 entries: 4 match views, All jobs, 6 tracker stages, 3 account pages. Tracker stages
   are filters, not places.
2. The views follow the database (`picked`, `worth-a-look`, `unscored`, `pasted`) rather than what the
   person is doing.
3. A selected job shows up to 6 equal-weight actions (Apply, View job, Edit CV, Download PDF, Cover
   letter, status select). No single next step.
4. Pipeline coverage gaps render as two yellow banners above the matches on every visit.
5. The CV pane takes half the screen before any CV exists.
6. Library and Preferences are long single forms.

## 5. Signed decisions

- Light only (already decided, `CLAUDE.md`).
- Match strength is shown as a word ("Strong match", "Close match"), not a bare number. A "9" in
  serif blue said nothing about what it measured.
- Posting text is untrusted: shown as plain text only, never as HTML. Unchanged by the redesign.

## 6. Gate

No usability gate in the repo yet. `next build` and `render-check.ts` cover compilation and CV render only.
