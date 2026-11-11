# Devpost submission — L'addition

> Ready to paste into the Devpost form. English, per §18 of the spec.
> Every figure quoted here is either from the spec (`docs/CAHIER-DES-CHARGES.md`)
> or measured on a real site and recorded in `docs/VALIDATIONS.md`.

**Project name:** L'addition — The Real Cost of Tech Debt
**Category:** Apps for Software Teams
**Bonus tracks targeted:** Teamwork Graph · Rovo Agents · MCP · Marketplace
**Repository:** https://github.com/BaptisteFaisy/laddition

---

## Inspiration

Technical debt tickets lose every arbitration, for one simple reason: their cost
is invisible. Put "we should remove the duplicate tax calculation" next to a
feature that has a customer and a date, and the feature wins. Not because the
team is wrong — because the debt has no number.

The cost exists, though, and it leaves traces everywhere. Incidents that come
back on the same service. Bugs that keep landing on the same component. Tickets
that take twice as long as the reference elsewhere. Tickets blocked waiting for
"someone to pick it up". Nobody connects those traces to the debt ticket that
explains them.

Two consequences follow. The debt that really costs stays at the bottom of the
backlog, and the team fights for the refactor that annoys it most rather than the
one that pays back most. And a third, quieter one: once a debt is repaid, nobody
checks whether it helped — so the next arbitration starts from zero.

## What it does

L'addition prices each debt ticket in **person-days over the last 90 days**,
shows the evidence behind every figure, and compares that cost to the cost of
fixing it. Then it measures what changed after the fix.

The demo scenario from the spec, running on real Forge runtime:

| Figure | What it is |
|---|---|
| **19 – 34 person-days** | PAY-77, *remove the duplicate tax calculation* — a debt ticket nobody opened in a year. 4 incidents (11 p-d), 9 bugs (8 p-d), 6 tickets twice as slow as the reference (15 p-d) |
| **1 – 2 person-days** | the refactor the team asks for every sprint — the debt that wins the argument is not the one that costs |
| **3.3 – 6.0×** | return over two quarters on an 8-day repayment |
| **22 person-days** | the `notifications` zone, which has **no debt ticket at all** — phantom debt, with a drafted ticket from its proofs |
| **7** | debt tickets with no proof for 180 days — dead debt, ready to close |
| **3.4 → 0.6 p-d/week** | repayment bulletin for PAY-41, published with its limits |

Six surfaces in Jira: a project page with the ranking and five tabs (zones,
phantom debt, dead debt, repayments, method), a panel on each debt ticket, a
context block on bugs and incidents ("looks like PAY-77 — confirm?"), a
**read-only custom field sortable in JQL**, a dashboard gadget, and a project
settings page. Plus a Rovo agent and eight MCP tools.

## How we built it

One Forge app installed on Jira. **No outbound network call.**

- **A pure domain, no `@forge/*` import.** 22 files, ~3 000 lines: cost families
  C1–C5, baselines and percentile clipping, attribution, bills, ranking, phantom
  and dead debt, return and payback, repayment bulletins, data quality. No I/O,
  no implicit clock — "now" is always a parameter. **206 assertions** run with
  Node's built-in test runner, no transpile step.
- **UI Kit 2** (`@forge/react`) behind one thin facade (`src/ui/kit.tsx`), so the
  six screens stay declarative and no component exceeds 50 lines.
- **Forge SQL** for storage (11 tables, no foreign keys — the platform does not
  support them), **Forge LLMs** (Claude) for relevance scoring and drafting,
  **Forge Events** for the batched bootstrap (50 issues per message, 900 s).
- **Teamwork Graph** consumed on behalf of the user and cached, for Compass
  components, owning teams and affected services. The nightly computation does
  without it and uses the Jira REST API — the graph cannot be called by a
  scheduled job.
- **Rovo agent + `rovo:mcp`** exposing eight tools: `get-debt-ranking`,
  `get-debt-bill`, `get-zone-costs`, `list-phantom-debt`, `list-dead-debt`,
  `get-repayment-report`, `draft-debt-ticket`, `confirm-evidence`. A coding agent
  can call `get-zone-costs` before touching a zone.
- **The model matches and writes; it never computes.** Principle 5 of the spec.
  Every number comes from deterministic code; the LLM only scores relevance
  between a proof and a debt ticket (with a one-sentence rationale shown to the
  user) and drafts text. Scores are cached by fingerprint of the two texts.
- **CI**: self-hosted runners, a 5-minute budget per job enforced by a guard,
  a layer-0 gate (no file over 500 lines, no function over 50, manifest validated
  against the official Forge schema), Mergify's merge queue, and an agent that
  resolves PR conflicts on its own.

## Challenges we ran into

- **A Jira app cannot call the Bitbucket API.** So slow PRs are approximated two
  ways: time spent in review statuses, and PRs seen in the Teamwork Graph when
  the repository is linked. Fine-grained PR measurement needs a companion
  Bitbucket app — classified in the vision, not faked in the MVP.
- **The Teamwork Graph can only be called on behalf of a user.** The nightly
  recomputation therefore does without it, and graph reads happen when a screen
  opens, then are cached. We measured this on a real site: called outside a user
  context, the graph returns nothing at all — no error, just empty results. The
  fallbacks (Jira components for zones, review-status time for PRs) are what
  actually run today.
- **Double counting is the product's credibility.** A proof can match several
  debts of the same zone. Shares are normalised so they never exceed 100%, links
  and human confirmations feed the lower band, inference feeds the upper band
  only, and a rejection is permanent.
- **The changelog has two shapes.** `GET /issue/{key}/changelog` answers
  `values`; `?expand=changelog` answers `histories`. Reading only one of them
  silently produced **empty status durations** — and C2, C3 and C4 quietly fell
  back to an approximation. Found by measuring on a real site, not by unit
  tests. Fixed, and locked by four tests.
- **A human decision must survive the night.** Confirming a match through the
  agent rewrote the attribution shares but did not record the *decision*, so the
  nightly recomputation erased it. Screen and agent now share one module.
- **Demo sites have no recent history.** The site we tested has 26 projects and
  31 161 issues in one of them — and nothing in the last 180 days. Hence the
  sample dataset, injected into the app's own tables, with a permanent banner.

## Accomplishments that we're proud of

- **The numbers in the spec's scenario are reproduced exactly by the running
  app**: 19–34 p-d for PAY-77, 22 p-d of phantom debt on `notifications`, 7 dead
  debts, a repayment bulletin at 3.4 → 0.6 p-d/week.
- **Every acceptance criterion of §20 was checked**, including #8 (the custom
  field sorts a Jira issue list: 10 writes out of 10, `ORDER BY` works) and #9
  (`get-debt-bill` and the issue panel return identical figures — verified
  programmatically, `identical: true`).
- **All eight MCP tools exercised one by one on the real runtime**, including a
  confirmation whose effect on the lower band is measured after recomputation.
- **The six "to validate" points of the spec were validated by probes**, not by
  opinion: 200–250 ms per issue including its history, which projects to 17–21
  minutes for 5 000 issues — above the 15-minute budget, so the documented
  fallback (90-day window, batches of 50) is what ships.
- **Confirmed eligible for "Runs on Atlassian"** by `forge eligibility`.

## What we learned

- A range is more honest than a number, and more useful: the lower band is what
  the method can defend, the upper band is what it suspects. Arguing with the
  upper band is fine; arguing with the lower band is the point.
- Transparency is a feature you build, not a disclaimer you add. Every figure
  opens on its proofs and its formula in two clicks, and that is what makes a
  contested number survivable in a planning meeting.
- Measuring beats modelling. Three of the six risks listed in the spec turned out
  to be non-issues, and the one that would have silently corrupted every duration
  was invisible in unit tests.
- Guarding the product against its own misuse matters: no per-person ranking, no
  causal claim in a repayment bulletin, no number when the sample is too small.

## What's next for L'addition

- Fine-grained PR measurement through a companion Bitbucket app (size, rounds,
  first-review delay), plus recurring CI failures as proofs.
- Cost in euros at an admin-set daily rate, forecasting ("at this rate, `taxes`
  will cost 45 person-days next quarter"), and links to company goals.
- A guardrail for coding agents: about to touch an indebted zone? Here is its
  bill and its open debt tickets.
- Memory of arbitrages: "PAY-77 was refused two quarters ago; it has cost 41
  person-days since."

---

### Demo script for the 4-minute video

See [`docs/VIDEO.md`](VIDEO.md) — second-by-second script, aligned with §21 of the
spec, with what is on screen and what is said.
