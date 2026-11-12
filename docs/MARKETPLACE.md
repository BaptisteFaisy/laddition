# Atlassian Marketplace listing — L'addition

> Everything below is ready to paste into the Marketplace listing form.
> English, per §18 of the spec ("soumission en anglais").
> No figure in this file is invented: each one comes from the spec
> (`docs/CAHIER-DES-CHARGES.md`) or from a measurement recorded in
> `docs/VALIDATIONS.md`.

## 1. Identity

| Field | Value | Limit |
|---|---|---|
| App name | **L'addition — The Real Cost of Tech Debt** | 45 chars: 43 ✓ |
| Tagline | Every debt ticket gets a price, its evidence, and a return. | 90 chars: 58 ✓ |
| Search summary | Measures what each technical-debt ticket actually cost over the last 90 days — incidents, bugs, slow tickets — compares it to the cost of fixing it, then checks what changed once it was repaid. | 250 chars: 197 ✓ |
| Category | Project management / Reporting |  |
| Pricing | Free (hackathon entry) |  |
| Deployment | **Runs on Atlassian** (verified eligible: no outbound network call, Forge SQL storage, Atlassian-hosted model) |  |
| Products | Jira Cloud (Software, Service Management) |  |

## 2. Long description

### Debt tickets lose every arbitration. Not because they are wrong — because they have no number.

A feature has a customer and a date. "We should refactor the billing module" has
nothing to put next to it. So the debt that really costs stays at the bottom of
the backlog, and the team fights for the refactor that annoys it most, not the
one that pays back most.

Yet the cost leaves traces everywhere: incidents that come back on the same
service, bugs that keep landing on the same component, tickets that take twice as
long as elsewhere, tickets stuck waiting for "someone to pick it up". Nobody
links those traces to the debt ticket that explains them.

**L'addition connects them.** It prices each debt ticket in person-days over the
last 90 days, shows the evidence behind every figure, and then — the part
everybody skips — checks whether repaying it changed anything.

### What you get

| Surface | What it shows |
|---|---|
| **Project page "L'addition"** | The ranking that inverts: the debt everyone asks for costs 1–2 person-days, the one nobody opened in a year costs 19–34. Tabs: Zones, Phantom debt, Dead debt, Repayments, Method |
| **Issue panel on a debt ticket** | Its bill: range, breakdown by cost family, every proof clickable down to the source ticket, the formula, and the return |
| **Context on a bug or incident** | "Feeds debt PAY-77", or "Looks like PAY-77 — confirm?" One click moves the proof into the lower band |
| **Custom field "Debt cost (p-d / 90 d)"** | Read-only, written by the app, **sortable and filterable in JQL** |
| **Dashboard gadget** | Top debts, cost per team, cost per quarter |
| **Project settings** | What counts as debt (type, label or JQL), zone mode, working day, coefficients, JSM projects |
| **Rovo agent + 8 MCP tools** | Ask "which debt costs us the most?" — or let a coding agent check a zone before touching it |

### Every number is a range, and every number opens

- **Lower band**: only proofs linked explicitly, or confirmed by a human.
- **Upper band**: adds proofs attributed by relevance matching.
- **No double counting**: a proof is spread at most 100%.
- **Never a ranking of people**: the unit is the zone or the team.
- **The model matches and writes; it never computes.** The arithmetic is
  deterministic code, under test.

### The two findings nobody asks for and everybody needs

**Phantom debt** — a zone that costs a lot and has no debt ticket at all. In the
sample project, `notifications` costs 22 person-days over 90 days with zero
ticket. The app drafts the ticket from the proofs; you review and create it.

**Dead debt** — debt tickets with no proof for 180 days. In the sample project,
7 of them. Close them and the debt backlog becomes credible again.

### The repayment bulletin

When a debt ticket is closed, the app compares the zone's weekly cost over the 8
weeks before work started with the 8 weeks after closure, and publishes the
result **with its limits**: other changes in the zone, sample size, and the
standing warning that a before/after comparison is not proof of causality.

### Try it in five minutes

Project → **L'addition** → **Load sample data**. It injects a fictitious 6-month
project into the app's own tables and keeps a "sample data" banner on screen.
Measured composition of the injected dataset: **68 issue facts, 65 proofs,
5 zones, 10 debt tickets (3 main debts and 7 dead debts), 1 repayment**. Every
screen, the agent and the MCP tools work on it. See `docs/JUGES.md` for the full
walkthrough.

## 3. How it works (one line per cost family)

| Family | Formula |
|---|---|
| **C1 Incidents** | resolution duration × distinct participants (capped at 6); logged time replaces the calculation when present; a linked post-mortem adds 0.5 p-d |
| **C2 Bugs** | time spent in "in progress" status categories × 1 person; logged time replaces the calculation |
| **C3 Slowness** | max(0, ticket duration − reference median) × occupancy coefficient (0.5); reference = median of same type and size across the organisation, excluding the zone; values clipped at the 95th percentile; fewer than 5 reference tickets → "insufficient data", no number shown |
| **C4 Rework** | time in active statuses between a reopening and the next resolution |
| **C5 Induced delay** | days a ticket sat blocked by the debt ticket — reported **separately**, in days of delay, never inside the bill |

Return: avoidable cost over two quarters = lower band × 2 × persistence factor
(0.7); return = avoidable cost ÷ repayment; payback delay = repayment ÷ average
weekly cost.

## 4. Privacy policy

*(Complete and self-contained — same text as the publishable `docs/PRIVACY.md`;
once hosted, the Marketplace privacy-policy field takes the published **URL**
(publication plan: `docs/NOTES-DE-SOUMISSION.md`).)*

**What the app reads.** L'addition reads, through Atlassian APIs only and only
on the site where it is installed: issues and their status history (changelogs),
issue links, comments, components, labels, issue types and logged time. It reads
user identifiers (account IDs — never display names) solely to count the
distinct participants of an incident (cost family C1). It declares three
`read:graph:*` scopes that **only the operator diagnostic probe** calls
(§5, decision G93): no screen a user opens reads Teamwork Graph data, and every
shipped feature runs on Jira data through the documented fallbacks.

**What the app stores.** Everything is stored in Forge SQL, inside the
installation's own storage partition on the Atlassian platform: computed costs
and bills per debt ticket, evidence items and attribution shares, human
decisions (confirmations and rejections of matches), cached relevance scores
(keyed by a fingerprint of the two texts), project settings, and repayment
bulletins. Nothing is stored outside the Atlassian platform.

**Retention.** Data is kept for as long as the app remains installed on the
site; uninstalling the app removes its storage, and deletion is then handled by
the Forge platform under Atlassian's data-retention policy. The injected sample
dataset can be removed at any time from the project settings ("Remove sample
data"), which deletes those rows from the app's tables.

**No outbound network call.** The app calls only Atlassian APIs (Jira REST,
Forge SQL, Forge LLMs). It never contacts a third-party server.

**Language model.** Text is processed only by Atlassian-hosted models (Forge
LLMs, Claude family), under Atlassian's own data policies. The model only scores
the relevance between a proof and a debt ticket and drafts text; it never
produces a figure. Scores are cached by text fingerprint and recomputed only
when a text changes.

**No per-person metric, anywhere.** The unit of every report is the zone or the
team. The code path is guarded, and acceptance test #10 of the specification
checks it. Names appear only on tickets the reader can already open.

**Access rights.** Proofs coming from projects the reader cannot open are
counted in the totals but shown as "hidden items" — never displayed.

**Contact.** Questions about privacy, or a data-deletion request: open an issue
on the public repository `github.com/BaptisteFaisy/laddition`, or contact the
publisher through the Marketplace listing. Uninstalling the app deletes its
storage as described above.

## 5. Permissions, justified

| Scope | Why |
|---|---|
| `read:jira-work` | Read issues, changelogs, links, comments and components to reconstruct durations and proofs; comment and assignee account IDs are used solely to count the distinct participants of an incident (C1) — never to rank or display a person |
| `write:jira-work` | Write the read-only computed field "Debt cost (p-d / 90 d)" on debt tickets after each recalculation (DT-11), and post the repayment bulletin as a comment on the closed debt ticket. Both are shipped: `src/jobs/repaymentComment.ts`, wired in `src/jobs/repayments.ts`. Nothing else uses this scope |

**Rule (G92): a scope that the shipped code does not use is removed before
submission.** The table above is re-checked against the code at freeze time
(15 December, spec §23), and any scope left unused is dropped from
`manifest.yml` rather than justified after the fact.

**Decision on the Teamwork Graph scopes (G93, decided on 12 November 2026).** The
three `read:graph:*` scopes are **kept in `manifest.yml` for now, and scheduled
for removal at the freeze** (15 December) if the graph still cannot be
demonstrated from a real screen. They are consumed **only by the diagnostic
probe** (`?action=probe`, `src/jobs/opsValidate.ts` → `src/platform/graph.ts`),
never by a screen a user opens. The probe was exercised on 11 November and recorded in
`docs/VALIDATIONS.md`: on the demo site the graph returned nothing for affected
services, pull requests and Compass components, because the organisation-level
scopes are not granted there — and no site available before the freeze (15
December) can grant them, so they could not be demonstrated before submission.
Under the rule above, a scope the shipped product does not use for a shipped
feature is dropped rather than justified after the fact; three
organisation-level scopes that cannot be demonstrated are exactly what a
Marketplace reviewer checks first. They are not dropped tonight for one
operational reason: a scope change triggers a **major version upgrade** on
deploy (`forge lint`, rule `MAJOR_VERSION_RULE`) and re-declaring them later
would trigger a second one, so the change is made **once**, at the freeze,
together with the removal of the graph code itself (`src/platform/graph.ts` and
the V4/V5/V6 probe) — dropping the scopes while the code still calls the graph
leaves a `teamwork-graph-scopes` warning in the build.

Everything the product ships today works without them, through the documented
fallbacks, which are the shipped behaviour: zones come from Jira components,
pull-request slowness from review-status time, and there is no Compass
dependency. The graph integration code stays in the repository (adapters and
probe, on behalf of the user by design, §15); if they are dropped at the freeze,
the scopes will be declared again in a later version, together with the §8
priority-2 features (Compass zone mode, cost per team), once they can be
demonstrated from a real screen on a site whose organisation admin granted them.

## 6. Versioning and support

- **Version to declare at submission time: 1.0.0** (G97). The repository
  currently carries `0.1.0` in `package.json` — that is the development
  version, not the released one. Procedure at freeze time: set
  `"version": "1.0.0"` in `package.json`, run `forge deploy -e production`,
  then tag the exact commit (`git tag -a v1.0.0 -m "Codegeist 2026 entry"` and
  push the tag), and enter **1.0.0** in the Marketplace form. The tag is the
  reference: whatever is re-deployed afterwards is a later version.
- **1.0.0** — Codegeist 2026 entry: MVP (M) plus the V1 lot (rework, induced
  delay, return and payback delay, repayment bulletin, gadget, JQL function,
  one-page argument).
- **What's next** (spec §6 "Vision"): fine-grained PR measurement via a companion
  Bitbucket app, cost in euros, forecasting, links to company goals.
- **Support**: issues and discussions on the public repository
  `github.com/BaptisteFaisy/laddition`. Every figure in the app opens on its
  method; if a number looks wrong, the proof list and the formula are two clicks
  away, and that is where to start.

## 7. Categories and labels

- Primary category: **Project management**
- Secondary: **Reporting & analytics**
- Labels: `technical debt`, `engineering effectiveness`, `cost`, `Jira`, `Rovo`,
  `MCP`, `Forge`, `Runs on Atlassian`. (`prioritization` was
  removed on purpose — spec §24: the product measures a past cost and checks a
  repayment, it does not score or rank the backlog. `Teamwork Graph` was
  removed on 12 November — see §5, decision G93: no feature a user opens reads
  the graph, and a label must match what the shipped app does for its user.)

## 8. Screenshots to produce (with their caption)

| # | Screen | Caption |
|---|---|---|
| 1 | Project page, ranking | The debt nobody opened in a year costs 19–34 person-days. The one the team asks for costs 1–2 |
| 2 | Debt ticket panel, bill expanded | Four incidents, nine bugs, six slow tickets: every line opens on its proofs and its formula |
| 3 | Bill detail, one family unfolded | The proof list, with the source tickets and the formula that produced each cost |
| 4 | Bug with the context panel | "Looks like PAY-77 — confirm?" One click moves the proof into the lower band |
| 5 | Phantom debt tab | The `notifications` zone cost 22 person-days and has no debt ticket. Draft one |
| 6 | Dead debt tab | 7 debt tickets with no proof for 180 days |
| 7 | Repayment bulletin | Before 3.4, after 0.6 person-days per week — with its limits |
| 8 | Method tab | Formulas, coefficients in force, and data quality |
| 9 | Custom field in a Jira issue navigator | Sortable and filterable in JQL |
| 10 | Dashboard gadget | Top debts, cost per team, cost per quarter |
| 11 | Rovo Chat | "Prepare the argument for PAY-77" → one page, with the method's limits |
| 12 | Project settings | What counts as debt, zone mode, working day, coefficients |
