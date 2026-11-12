# L'addition

**What your technical debt actually costs — measured over the last 90 days, in days of work, with the proof behind every figure.**

> L'addition is **not a backlog-prioritization tool**: it measures a cost that
> has already been incurred and checks whether repaying a debt paid off — it
> never scores or ranks your backlog (spec §24).

## The problem

Debt tickets lose every arbitration, for one reason: their cost is invisible. A feature has a customer and a date; "we should refactor the billing module" has nothing to put next to it.

Yet the cost leaves traces everywhere: incidents that come back on the same service, bugs that keep landing on the same component, tickets that take twice as long as elsewhere, pull requests that need three rounds, tickets stuck waiting for "someone to pick it up". Nobody links those traces to the debt ticket that explains them. So the debt that really costs stays at the bottom of the backlog, and the team fights for the refactor that annoys it most — not the one that pays back most.

L'addition connects the traces to the tickets, puts a range on each debt ticket, and then checks whether repaying it changed anything.

## The three numbers of the demo

| Figure | What it is |
|---|---|
| **19 – 34 person-days** | PAY-77, *remove the duplicate tax calculation* — a debt ticket nobody has opened in a year |
| **1 – 2 person-days** | the refactor the team asks for every sprint — the debt that wins the argument, not the one that costs most |
| **22 person-days** | the `notifications` zone — which has **no debt ticket at all** (phantom debt) |

Repaying PAY-77 is estimated at 8 person-days, i.e. a **3.33 – 5.95× return over two quarters** (measured on the runtime; the specification rounds it to "3 – 6×"). Every figure above opens on the incidents, bugs and slow tickets that make it up, and on the formula that produced it.

## Run it locally

```bash
npm install
npm test              # 206 tests — Node's built-in runner, no transpile step
npm run typecheck     # tsc --noEmit, strict
python3 tools/check_limits.py            # file/function size guards
node tools/validate_manifest.mjs         # manifest vs the official Forge schema
node tools/check_manifest_exports.mjs    # manifest handlers vs real exports
forge deploy -e production               # deploy to your Atlassian developer site
forge install --site <DEMO_SITE> --product jira -e production
```

Requirements: Node ≥ 22 (the domain is TypeScript executed by `node --test --experimental-strip-types`), and the Forge CLI for anything that talks to Atlassian. Nothing leaves the Atlassian platform: storage is Forge SQL, the language model is Atlassian-hosted, and the app makes no outbound network call (§15, §18).

**Current state (11 November 2026).** The whole tree is in place: a pure domain
(22 files, ~3 000 lines, no `@forge/*` import — guarded in CI), the Forge
platform adapters (SQL, Jira REST, Teamwork Graph, LLM, custom field), the four
triggers, the nightly recalculation, the batched bootstrap consumer, the six
screens, the Rovo agent and the eight MCP actions. `tsc --noEmit` is clean and
**`npm test` passes 206 tests**, `manifest.yml` validates against the official
Forge schema (`node tools/validate_manifest.mjs`) and its handlers are checked
against the real exports of `src/index.tsx` in CI. The app **is registered with
Atlassian, deployed, and installed on the demo site in both the `development`
and `production` environments**, and it passed `forge eligibility` ("Runs on
Atlassian"). **The six validations of §17 were measured on the real runtime**
— executable probes, verdicts and the major changelog bug they caught are in
[docs/VALIDATIONS.md](docs/VALIDATIONS.md). The file-by-file map is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

To try the product without touching your own history, the project page has a **Load sample data** button: it injects a fictitious 6-month project — measured composition: **68 issue facts, 65 evidence items, 5 zones, 10 debt tickets (3 main debts and 7 dead debts), 1 repayment** — into the app's own tables and keeps a "sample data" banner on screen. See [docs/JUGES.md](docs/JUGES.md).

## Repository layout

```
src/core/          pure domain — no @forge/* import, no I/O, no implicit clock
  types.ts           shared contract (Evidence, Attribution, DebtBill, …)
  time.ts            person-day and week conversions, business days, rounding
  settings.ts        project defaults and bounds for every coefficient
  zones.ts           issue → zones (§8), equal split, "unclassified"
  duration.ts        status spans rebuilt from history, active days, rework
  baseline.ts        C3 references: median per type and size, clipping
  families/c1.ts     incidents
  families/c2.ts     bugs
  families/c4.ts     rework
  families/c5.ts     induced delay (a delay, never effort)
  attribution.ts     §10: shares, 100 % cap, rejections
  phantom.ts         zones that cost money and have no debt ticket
  dead.ts            debt tickets with no evidence for 180 days
docs/              specification and documentation
  CAHIER-DES-CHARGES.md   the specification (French, reference document)
  ARCHITECTURE.md         layers, domain contract, flows, Forge limits
  METHODE.md              every formula and coefficient (French)
  JUGES.md                the five-minute test
  VIDEO.md                demo video script
  VALIDATIONS.md          the six prototype checks of §17 (French)
```

All of it is in this tree: `src/platform/` (Forge SQL, Jira REST, Teamwork Graph, LLM, custom field), `src/jobs/` (triggers, scheduled trigger, consumer, ops probes), `src/resolvers/`, `src/ui/` (UI Kit 2), `src/mcp/` (Rovo agent + 8 actions), `src/sample/` (sample data). The file-by-file status is kept in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Known limits

- **No source-code analysis.** Debt is measured by its effects on work, not by code metrics (§6).
- **Cost is read from status history**, which cannot be backdated through the API. Hence the sample data button, and a real-site result that depends on the history your site actually has (§22).
- **Pull-request slowness is approximated**, from time spent in review statuses and from PRs visible in the Teamwork Graph. A Jira-installed Forge app cannot call the Bitbucket API; a fine-grained measure needs a second app on the Bitbucket side (§15).
- **Teamwork Graph is in Preview**: calls run as the current user, only at screen opening and cached, and one scope per object type is granted by an organisation admin. A missing scope returns empty results *without an error* — an empty screen is not proof of absence (§17).
- **Forge SQL**: 1 GiB per installation, 5 s per `SELECT`, no foreign keys, one statement per query. Aggregates are precomputed nightly for that reason (§17).
- **Forge LLMs**: Claude models, text only, 100 requests and 500 000 tokens per minute per model. Relevance scores are cached and only recomputed when a text changes (§18).
- **Slowness (C3) needs references**: under 5 reference tickets the family reports "insufficient data" and shows no figure (§9, §20.7).
- **Induced delay (C5) never enters the bill**: it is shown separately, in days of delay (§9).
- **No per-person metric anywhere.** The unit is the zone or the team; names only appear on tickets the reader can already open (§18).

## Documentation

- [docs/JUGES.md](docs/JUGES.md) — test it in five minutes.
- [docs/METHODE.md](docs/METHODE.md) — every formula, every coefficient, and why (French).
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layers, flows, Teamwork Graph, Forge limits.
- [docs/VIDEO.md](docs/VIDEO.md) — the demo script, second by second.
- [docs/VALIDATIONS.md](docs/VALIDATIONS.md) — the six prototype checks of §17 (French).
- [docs/CAHIER-DES-CHARGES.md](docs/CAHIER-DES-CHARGES.md) — the specification the app answers to.

Codegeist 2026 · *Apps for Software Teams*.
