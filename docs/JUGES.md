# Judge's guide — test L'addition in five minutes

L'addition turns the last 90 days of incidents, bugs and slow tickets into one
figure per technical-debt ticket: what it cost, in person-days, as a range, with
the evidence behind it — then checks whether repaying it changed anything.

Two ways in. **Start with the sample data**: it takes five minutes and shows
every screen. Then, if you want to see it on your own work, run the three-step
real-data path at the end of this page.

---

## Step 0 — Open the app (1 min)

**Fastest path — the hosted demo site.** The app is deployed and installed, in
both `development` and `production`, on the demo site `<DEMO_SITE>` (the URL and
the credentials are handed to the judges privately — this repository is public,
see the note below). Open the **PAY** project, choose **L'addition** in the
project navigation (`jira:projectPage`). Nothing else to configure.

**Install it on your own site, from source:**

```bash
git clone https://github.com/BaptisteFaisy/laddition && cd laddition
npm install
forge deploy -e production
forge install --site <YOUR_SITE>.atlassian.net --product jira -e production
```

`forge deploy` needs the Forge CLI, an Atlassian developer account, and
collaborator access to the registered app (`<APP_ID>` in `manifest.yml` —
find it in the [developer console](https://developer.atlassian.com/console/myapps)).
Without collaborator access, register your own copy with `forge create` and
paste the new app id into `manifest.yml` before deploying.

> **Public repository — placeholders.** `<DEMO_SITE>`, `<APP_ID>` and the
> installation ids never appear in this repository. They live in the Atlassian
> developer console (app "L'addition" → *Deployment* and *Installations* tabs)
> and are communicated to the judges through the submission form.

> Why sample data exists: the cost is read from the status history of issues,
> and history cannot be backdated through the Jira API. A brand-new site would
> show an empty bill. The sample project is injected into the app's own tables,
> not into your Jira issues.

## Step 1 — Load the sample data (10 s)

In the project page, open **Settings → Load sample data**, or use the button on
the empty state of the **Ranking** tab.

It injects a fictitious six-month project. Measured composition of the dataset
(`src/sample/dataset.ts`, injected and verified on the runtime): **68 issue
facts, 65 evidence items, 5 zones, 10 debt tickets — 3 main debts (§7.1) and
7 dead debts (§7.3) — and 1 repayment**. A **"Sample data"** banner stays
visible on every screen until the sample is removed. Your Jira issues are not
touched.

## Step 2 — What you should see (2 min)

### a. The ranking that reverses

| Position | Debt ticket | Cost |
|---|---|---|
| **Top** | PAY-77 — *remove the duplicate tax calculation* (untouched for a year) | **19 – 34 p-d** |
| **Bottom** | *migrate to the new test framework* — the refactor the team asks for every sprint | **1 – 2 p-d** |

The ranking does not follow who complains loudest; it follows what the debt
actually cost. That inversion is the product's whole argument.

### b. The bill of PAY-77 — open the issue panel

Click PAY-77, then the **L'addition** panel on the issue. It shows:

- **4 incidents → 11 p-d**
- **9 bugs → 8 p-d**
- **6 tickets twice as long as the reference → 5 – 15 p-d**, depending on how
  much is attributed to this debt
- **Low bound 19 / high bound 34 p-d**, and the repayment estimate: **8 p-d**
- **Return: 3.33 – 5.95× over two quarters** on the 8 p-d repayment (measured
  on the runtime; the specification rounds it to "3 – 6×", §7.1)

Every row expands to the source tickets, and each figure opens the formula that
produced it, with the actual input values.

### c. Phantom debt — a zone that costs money and has no ticket

Tab **Phantom debt**: `notifications` **cost 22 p-d in 90 days and has no debt
ticket at all**. **Draft ticket** prepares a description written from the
evidence — nothing is created in Jira until a human reviews and confirms it.

### d. Dead debt — tickets that no longer cost anything

Tab **Dead debt**: debt tickets with **no evidence for 180 days**. The sample
dataset injects 10 debt tickets — 3 main debts and **7 dead debts** (§7.3) — so
the tab lists exactly those 7. The count always follows the injected data: the
screen shows what the data implies, never a hard-coded number.

### e. A repayment report — did it work?

Tab **Repayments**: the report for a debt that was already closed, **PAY-41**.
It compares the weekly cost of the zone over the 8 weeks before the work and the
8 weeks after closure, and states its own limits: other changes happened in the
zone, the sample is small, and this is a before-and-after comparison, **not a
proof of causality**. Measured on the runtime (11 November): the bulletin reads
**3.4 → 0.6 p-d per week** on the zone. (The §7.5 example of the specification
— 2.6 → 0.7 on a PAY-77 story — illustrates the same mechanics with different
numbers; the app shows what the data implies, never the spec's example.)

### f. The Method tab

Formulas, coefficients in force, and data quality: share of tickets without a
zone, families declared "insufficient data". Every number in the app is at most
two clicks from its method (§18).

## Step 3 — Real data from your site (2 min, three steps)

**1. Designate the debt.** Settings → *What counts as debt*: an issue type, a
label, or a JQL query (DT-01). The count of matching tickets updates as you
type.

**2. Choose the zone mode.** Jira component (default), Compass component,
affected service, or label (§8). The screen tells you how many tickets would end
up "unclassified" — that share is a data-quality indicator, not a hidden
failure.

**3. Start the initialisation.** 180 days of history are read in batches of 50,
with a progress bar and a failure count (DT-12). When it finishes, open the
**Ranking** tab.

What you get depends on the history your site actually has:

- a zone with fewer than 5 reference tickets shows **"insufficient data"** for
  slowness, and **no figure** (§9, §20.7);
- tickets without status history are costed from creation → resolution and
  flagged **"approximated"** (§19);
- a debt ticket without a repayment estimate is ranked by cost alone, marked
  **"repayment not estimated"**.

## The ten acceptance points of §20

| # | What to check | Where to see it |
|---|---|---|
| 1 | A bug linked to a debt ticket contributes **100 % to its low bound** | PAY-77 panel → *Bugs* row → the linked bug; or `get-debt-bill` for PAY-77 |
| 2 | An incident on a zone with **two debts and no link** is shared, and the shares **sum to 100 %** | Zones tab → pick a zone with two debts → open the incident row → the two shares |
| 3 | **Rejecting a match** removes the evidence from the bill and stops proposing it | Open the bug → issue context *"looks like PAY-77 — confirm?"* → **Reject** → reopen the PAY-77 panel |
| 4 | A zone above **10 p-d** with no debt ticket appears as phantom debt, **with a draft ticket** | Phantom debt tab → `notifications` → *Draft ticket* |
| 5 | A debt ticket **without evidence for 180 days** appears as dead debt | Dead debt tab |
| 6 | **Every row of the bill opens** the list of tickets behind it | PAY-77 panel → any family row |
| 7 | A zone with **fewer than 5 reference tickets** shows *"insufficient data"* for slowness, **and no number** | Zones tab, or the panel of a debt on a thinly-populated zone |
| 8 | The **"Debt cost (p-d / 90 d)"** field sorts a Jira issue list | Issues view → Columns → *Debt cost (p-d / 90 d)* → sort on it (or JQL: `"Debt cost (p-d / 90 d)" > 10`) |
| 9 | **`get-debt-bill` returns the same figures as the panel** | Rovo chat (*"Detail PAY-77"*) or any MCP client |
| 10 | **No view shows a total per person** | Any screen — by design; the unit is the zone or the team |

Point 9 in practice: the eight actions of §13 (`get-debt-ranking`,
`get-debt-bill`, `get-zone-costs`, `list-phantom-debt`, `list-dead-debt`,
`get-repayment-report`, `draft-debt-ticket`, `confirm-evidence`) are exposed
through `rovo:mcp`. Ask the same question twice — once in the UI, once through
the tool — and compare the numbers; they are read from the same stored results,
so they must be identical.

## How to call the MCP tools without Rovo

The eight tools of §13 (`get-debt-ranking`, `get-debt-bill`, `get-zone-costs`,
`list-phantom-debt`, `list-dead-debt`, `get-repayment-report`,
`draft-debt-ticket`, `confirm-evidence`) are exposed through `rovo:mcp`. You can
exercise the **same code path** without Rovo, through the operations webtrigger
(`laddition-ops`, handler `src/jobs/opsTrigger.ts`):

```bash
# One-off: get the URL bound to your installation
forge webtrigger create <DEMO_SITE> laddition-ops     # → <OPS_WEBTRIGGER_URL>

# The token is an app variable; the guard fails closed when it is unset
forge variables:set LADDITION_OPS_TOKEN <OPS_TOKEN>   # on the app, per environment

# Exercise all eight MCP tools in one call (same invokeAction() as rovo:mcp)
curl -H "x-ops-token: <OPS_TOKEN>" \
  "<OPS_WEBTRIGGER_URL>?project=PAY&action=mcp&key=PAY-77&zone=facturation"

# Compare the issue panel figures with get-debt-bill (acceptance point #9)
curl -H "x-ops-token: <OPS_TOKEN>" "<OPS_WEBTRIGGER_URL>?action=bill&key=PAY-77"
```

Available actions: `init`, `bootstrap`, `progress`, `recalc`, `recalc-all`,
`repayments`, `sample`, `clear-sample`, `report`, `bill`, `mcp`, `probe` (the
`probe` action runs the six §17 validations of `docs/VALIDATIONS.md`). An
unknown or missing action returns the list above, never a 500. The token can be
passed as the `x-ops-token` header or a `token` query parameter; the comparison
is constant-time and a missing/empty variable disables the webtrigger entirely
(`src/jobs/opsAuth.ts`).

> **Before the Marketplace submission, the two `webtrigger` modules are removed
> from the manifest** — the token guard is a development safety net, not a
> permanent public surface. A second webtrigger (`laddition-smoke`) runs the
> end-to-end smoke test (SQL, Jira REST, domain) and is removed with it.

## If a number looks wrong

1. Open the **Method** tab: coefficients in force, families marked
   "insufficient data", share of unclassified tickets.
2. Open the evidence row: the formula is printed with the values actually used
   (duration, participants, reference, coefficient).
3. Check the low/high split: only links and human confirmations feed the low
   bound; inferred matches feed the high bound only.

## Limits you should know while testing

- Cost comes from history, which cannot be backdated: a fresh site has nothing
  to measure, hence the sample data.
- Pull-request slowness is approximated (review statuses and Teamwork Graph
  PRs); a Jira-installed Forge app cannot call the Bitbucket API (§15).
- The Teamwork Graph API is in Preview: a missing organisation scope returns
  empty results *without an error* — an empty panel is not proof of absence.
- Induced delay (C5) is shown separately, in days of delay, and never enters the
  bill (§9).

Full specification: [CAHIER-DES-CHARGES.md](CAHIER-DES-CHARGES.md). Method:
[METHODE.md](METHODE.md) (French). Architecture: [ARCHITECTURE.md](ARCHITECTURE.md).
