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
project (3 debt tickets, 65 proofs, 1 repayment) into the app's own tables and
keeps a "sample data" banner on screen. Every screen, the agent and the MCP tools
work on it. See `docs/JUGES.md` for the full walkthrough.

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

## 4. Privacy and trust

- **No per-person metric, anywhere.** The unit is the zone or the team. The code
  path is guarded, and the acceptance test #10 of the spec checks it.
- **No outbound network call.** Only Atlassian APIs are called.
- **Storage**: Forge SQL, in the installation's own partition.
- **Model**: Atlassian-hosted (Forge LLMs, Claude family). The model only scores
  relevance between a proof and a debt ticket and drafts text; it never produces
  a figure. Relevance scores are cached by text fingerprint and only recomputed
  when a text changes.
- **Rights**: proofs from projects the reader cannot open are counted, but shown
  as "hidden items" — never displayed.
- **Read-only field**: the app writes its custom field; nobody edits it by hand.

## 5. Permissions, justified

| Scope | Why |
|---|---|
| `read:jira-work` | Read issues, changelogs, links, comments and components to reconstruct durations and proofs |
| `write:jira-work` | Write the read-only "Debt cost" field on debt tickets (DT-11) and post the repayment bulletin as a comment |
| `read:jira-user` | Count distinct participants on an incident (C1). Never used to rank or display a person |
| `storage:app` | Reserved; the app stores in Forge SQL |
| `read:graph:component:compass` | Zone mode "Compass component" (§8, priority 2) |
| `read:graph:team:atlassian` | Team that owns a component, for cost per team (§8) |
| `read:graph:issue:jira` | Incidents and affected services, PRs seen in the graph (§8, §15) |

All graph reads happen **on behalf of the user**, when a screen opens, and are
cached. The nightly computation does without them and uses the Jira REST API.

## 6. Versioning and support

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
- Labels: `technical debt`, `engineering effectiveness`, `cost`, `prioritization`,
  `Jira`, `Rovo`, `MCP`, `Teamwork Graph`, `Forge`, `Runs on Atlassian`

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
