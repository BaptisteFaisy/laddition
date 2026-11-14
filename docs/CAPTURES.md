# Screenshots checklist — Marketplace gallery (14 captures)

This is the shot list for the Marketplace gallery. Captions live in
`docs/MARKETPLACE.md` §8 — the table below adds, for each capture: the screen to
open, the project/ticket to display, the acceptance point of the specification
§20 it demonstrates, and the target file name in `docs/captures/`.

**No image has been produced yet.** This document only prepares the shoot.

## Language and setup — mandatory for all 14 captures

- **Language: English.** The app's default UI language is English
  (`src/ui/i18n/en.ts`); the UI follows the Jira account language, so set the
  capturing account's Jira language to **English** before the shoot.
- **Site:** the demo site (`<DEMO_SITE>`, see `docs/NOTES-DE-SOUMISSION.md`),
  app installed in **production**.
- **Data:** project **PAY** with the **sample dataset loaded** (Settings →
  *Load sample data*). The "Sample data" banner stays visible on every screen —
  keep it in the shots: it is honest and it is part of the product.
- **Known chrome exception (owner decision before the shoot):** three module
  titles are declared in French in `manifest.yml` and will appear as such even
  with an English UI — issue context "Preuve de dette", gadget "L'addition —
  principales dettes", custom field "Coût de la dette (j-p / 90 j)". Either
  accept them in the captures, or rename them in the manifest before the freeze
  (outside the scope of this lot).
- **Files:** PNG, saved as `docs/captures/<file>` below. Check the current
  Marketplace gallery constraints (size/weight) at upload time; shoot wide
  (full page or full panel), never a cropped corner.
- **Caption discipline:** every caption must match what the screen actually
  shows. Before each shot, verify the figures on screen against
  `docs/MARKETPLACE.md` §8; if a summary or a number differs (the spec §7.1
  wording is narrative — the screens show the dataset's own summaries), fix the
  caption, not the screen.

## The 14 captures

| # | Screen (how to open) | Project / ticket shown | Spec §20 point | File (`docs/captures/`) |
|---|---|---|---|---|
| 1 | Project page: open project **PAY** → *L'addition* in the project navigation → **Ranking** tab | Sample project PAY: **PAY-77** on top at 19–34 p-d; bottom of the list, the 1–2 p-d debt (PAY-41 / PAY-90, both measured 1–2 p-d) | #10 (no per-person total anywhere) | `01-project-ranking.png` |
| 2 | Issue **PAY-77** → *L'addition* issue panel, bill expanded | PAY-77: 4 incidents (11 p-d), 9 bugs (8 p-d), 6 slow tickets (5–15 p-d), bounds 19/34, repayment 8 p-d, return 3.33–5.95× | #6 (every row opens), #1 (linked bug at 100 % in the low bound), #9 (same figures as `get-debt-bill`) | `02-debt-panel-bill.png` |
| 3 | Same panel → unfold **one cost family** to the proof list | PAY-77, one family (e.g. *Bugs*): source tickets, and the formula with its real inputs behind each figure | #6 | `03-bill-family-proofs.png` |
| 4 | A **bug** of zone `facturation` with no debt link → the *issue context* panel showing the proposal ("Looks like PAY-77 — same zone, same symptoms") with **Confirm**/Reject | Sample dataset, zone `facturation` (VIDEO.md 2:10–2:40 walks this exact shot; the confirmed example in the dataset is PAY-209 → PAY-77) | #3 (a decision moves/removes the proof), #1 | `04-bug-context-confirm.png` |
| 5 | Project page → **Phantom debt** tab | Zone `notifications`: 22 p-d over 90 days, no debt ticket, *Draft ticket* button visible | #4 | `05-phantom-debt.png` |
| 6 | Project page → **Dead debt** tab | The 7 dead debts of the sample (no evidence for 180 days) | #5 | `06-dead-debt.png` |
| 7 | Project page → **Repayments** tab, bulletin opened | **PAY-41**: before **3.4** → after **0.6** p-d per week (measured 11/11), with its limits stated on screen | — (spec §11: return and repayment; no §20 point) | `07-repayment-bulletin.png` |
| 8 | Project page → **Method** tab | Formulas, coefficients in force, data quality (share of tickets without a zone, families in "insufficient data") | — (spec §18: two clicks from any number to its method) | `08-method-tab.png` |
| 9 | Jira **issue navigator** (Issues view) on project PAY → column *Coût de la dette (j-p / 90 j)* sorted descending | PAY issues where the app wrote the field; a JQL bar visible if possible (`"Coût de la dette (j-p / 90 j)" > 10` or the `topDebts()` function) | #8 | `09-custom-field-navigator.png` |
| 10 | A Jira **dashboard** with the L'addition gadget added | Gadget on the sample project: top debts, cost per team, cost per quarter | #10 | `10-dashboard-gadget.png` |
| 11 | **Rovo Chat** with the L'addition agent | Prompt: *"Prepare the argument for PAY-77"* → the one-page case, with the method's limits | #9 (agent/MCP figures identical to the panel) | `11-rovo-chat-argument.png` |
| 12 | Project page → **Settings** tab (or the settings page) | Project PAY settings: what counts as debt, zone mode, working day, coefficients; the *Load/Remove sample data* controls | — (settings drive the data-quality warnings of #7) | `12-project-settings.png` |
| 13 | Project page → **Simulation** tab: three debts selected, simulation run | DT-21 (added 12 November): capacity recovered if PAY-77 / PAY-41 / PAY-90 were repaid — every figure comes from stored numbers, each with its method | — (spec §14: the "what if we repay these" answer) | `13-simulation-tab.png` |
| 14 | Project page → select **PAY-77** → *Make the case* button → the case page | DT-17 (wired 12 November): the one-page argument, its figures, and the method's limits — the same content as the MCP tool `get-debt-case` | #9 (agent/MCP figures identical to the panel) | `14-debt-case.png` |

## Shoot order (suggestion)

Setup (English UI + sample data) → 1, 5, 6, 7, 8, 13, 12 (project page, one
place) → 2, 3, 14 (PAY-77 panel, then *Make the case*) → 4 (bug context) → 9
(navigator) → 10 (dashboard) → 11 (Rovo chat, last: it may consume agent quota).

Before committing the images: `ls docs/captures/` must show exactly these 14
files, each caption re-checked against `docs/MARKETPLACE.md` §8.

## State of the shoot (12 November 2026)

**Twelve captures taken** (files 01 to 09, 12, 13, 14 — English UI, the demo
account's language switched to English on the day). They were taken on the
**production** install (`3.4.0`), project **PAY**, sample dataset loaded (68
facts, 65 evidence, 5 zones, 650 €/day).

Taking them was not a formality: **the screens had never rendered a single
table row**. Opening the site for the shoot exposed three defects, all fixed
and merged the same day (see `docs/VALIDATIONS.md`):

1. the table parser could not see a row component → **every** table showed its
   header and nothing else (fixed in #77, guarded by `src/ui/table-rows.test.ts`);
2. the data-quality shares were multiplied by 100 → « 147 % » for 1,47 %
   (fixed in #76 and #79);
3. the sample dataset used fictional issue ids → opening PAY-77 answered «
   ticket 66499 unknown » (fixed in #75, the sample is now aligned on the real
   tickets).

**Two captures remain**, both needing a click the automation did not reach:

- **10 — the gadget**: open *Dashboards → Default dashboard* → *Edit* →
  *Add gadget* → search *L'addition* → *Add*. The dashboard's own toolbar was
  not reachable from the script (the page kept its toolbar out of the DOM).
- **11 — the Rovo chat**: click *Ask Rovo* in the top bar, choose the
  **L'addition** agent, ask *Prepare the argument for PAY-77*. The chat did not
  open from the script either.

Both are quick manual steps in a browser; the features behind them are
verified live (the gadget data — top debts, cost per team, cost per quarter —
and all 11 MCP actions answer on the site, see `docs/VALIDATIONS.md`).

**State on 14 November 2026.** Capture 10 was taken on 13 November, *before*
the gadget title fix (#85), so it still shows the title twice and must be
taken again. Driving a browser over CDP (an Atlassian session already
connected) did not work: Jira renders the dashboard and serves the module
bundle with HTTP 200, but the Forge iframe keeps a zero height, so nothing is
visible to capture. Another Forge app on the same site behaves the same way,
so it is not specific to this app. The bundle was checked — valid JavaScript,
it contains the current code — and rolling production back to the previous
commit did not restore the render either. This is unresolved; a real browser
is the shortest way to settle it. Capture 11 was not attempted, for the same
reason.
