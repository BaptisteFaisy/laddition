# Demo video — script, second by second

**Target length: 4:45** (hard limit 5:00). Language: English, UI in English.
Recorded on the sample data, with the "Sample data" banner visible.
The block structure follows §21 of the specification; each block is cut into
shots so the editor has exact in/out points.

Narration below is the **exact text to say**. Anything in `[brackets]` is a
direction, not spoken.

---

## 0:00 – 0:30 · A planning meeting: the debt loses again

| In – out | On screen | Voiceover |
|---|---|---|
| 0:00 – 0:06 | Meeting room, whiteboard titled "Q1 planning" | Every quarter, the same meeting. |
| 0:06 – 0:14 | Sticky note "refactor billing module" next to "customer demo — Friday" | Someone says the billing module has to be refactored. Someone else has a customer and a date. |
| 0:14 – 0:22 | Third sticky note, hand-written: "no number, no decision" | The refactor loses. Not because it is wrong — because it has no number. |
| 0:22 – 0:30 | Cut to Jira; cursor opens **Project → L'addition** | This is L'addition. It gives the debt a number: what it actually cost, over the last ninety days. |

## 0:30 – 1:20 · The ranking: 2 days against 30

| In – out | On screen | Voiceover |
|---|---|---|
| 0:30 – 0:40 | **Ranking** tab, full list, sorted by cost | Here is the debt ranking of a six-month project. |
| 0:40 – 0:50 | Scroll to the bottom; highlight *migrate to the new test framework*, **1 – 2 p-d** | At the bottom, the refactor the team asks for every sprint: one to two person-days. |
| 0:50 – 1:02 | Scroll to the top; highlight **PAY-77**, **19 – 34 p-d** | At the top, a ticket nobody has opened in a year: remove the duplicate tax calculation. Between nineteen and thirty-four person-days. |
| 1:02 – 1:12 | Split screen of the two rows, the two ranges side by side | The ranking does not follow who complains loudest. It follows what the debt actually cost. |
| 1:12 – 1:20 | Click PAY-77 | Let's open it. |

## 1:20 – 2:10 · The bill, down to the incidents and bugs

| In – out | On screen | Voiceover |
|---|---|---|
| 1:20 – 1:30 | **L'addition** issue panel; range 19 – 34 at the top | The bill for this ticket. |
| 1:30 – 1:40 | Expand **Incidents** → 4 incidents, 11 p-d → the 4 source tickets | Four incidents: eleven person-days. Each line opens the tickets behind it. |
| 1:40 – 1:50 | Expand **Bugs** → 9 bugs, 8 p-d | Nine bugs: eight person-days. |
| 1:50 – 2:00 | Expand **Slowness** → 6 tickets, 5 – 15 p-d | Six tickets took twice as long as the reference: five to fifteen person-days, depending on how much we can attribute to this debt. |
| 2:00 – 2:10 | Click a figure → formula with real inputs; then repayment **8 p-d**, return **3 – 6×** | Every figure opens its formula. Low bound nineteen, high bound thirty-four. Repaying it is estimated at eight days — three to six times the investment over two quarters. |

## 2:10 – 2:40 · One click attaches a bug: the range narrows

| In – out | On screen | Voiceover |
|---|---|---|
| 2:10 – 2:18 | A bug issue; **issue context** panel, no debt attached | This bug is not linked to any debt yet. |
| 2:18 – 2:30 | Panel: *"Looks like PAY-77 — same zone, same symptoms"* + one-sentence justification → **Confirm** | L'addition recognises it, and says why in one sentence. One click confirms. |
| 2:30 – 2:40 | Back to the PAY-77 panel: the low bound moves up, the range narrows | The evidence moves from the high bound into the low one, and the range narrows. A wrong match is rejected in one click — and never proposed again. |

## 2:40 – 3:10 · Phantom debt: a zone that costs 22 days, with no ticket

| In – out | On screen | Voiceover |
|---|---|---|
| 2:40 – 2:48 | **Phantom debt** tab | But not all debt has a ticket. |
| 2:48 – 3:00 | Row `notifications`: **22 p-d**, "no debt ticket" | The notifications zone cost twenty-two person-days in ninety days, and no debt ticket mentions it. |
| 3:00 – 3:10 | **Draft ticket** → description written from the evidence | L'addition calls this phantom debt, and drafts the missing ticket from the evidence. A human reviews it before anything is created. |

## 3:10 – 3:40 · A repayment report: did it work?

| In – out | On screen | Voiceover |
|---|---|---|
| 3:10 – 3:18 | **Repayments** tab | And when a debt is repaid, the app checks whether it worked. |
| 3:18 – 3:30 | Bulletin **PAY-41**: weekly cost before 2.6 → after 0.7 p-d | Before: two point six person-days per week on the zone. After: zero point seven. No incident since closure. |
| 3:30 – 3:40 | Zoom on the caveats list | The report states its own limits: other changes happened, the sample is small. This is a before-and-after, not a proof of causality. |

## 3:40 – 4:20 · Rovo for the argument, MCP for the coding agent

| In – out | On screen | Voiceover |
|---|---|---|
| 3:40 – 3:52 | Rovo chat: *"Prepare the case for PAY-77"* | For the arbitration meeting, ask Rovo for the one-page case. |
| 3:52 – 4:04 | One-pager: cost, main evidence, repayment, return, limits | Cost, main evidence, repayment, return, and the limits of the method — ready to paste into the decision. |
| 4:04 – 4:14 | Terminal: a coding agent calls `get-zone-costs` over MCP | And a coding agent, through MCP, asks what a zone costs before touching it. |
| 4:14 – 4:20 | Tool response: zone cost, families, most frequent failures | It learns the zone is expensive — and what breaks there most often. |

## 4:20 – 4:45 · Method and architecture

| In – out | On screen | Voiceover |
|---|---|---|
| 4:20 – 4:30 | **Method** tab: formulas, coefficients in force, data quality | Every number keeps its method: formulas, coefficients in force, data quality. |
| 4:30 – 4:38 | Architecture diagram: Forge app → Forge SQL, Teamwork Graph, Rovo, MCP | One Forge app on Jira: Forge SQL for storage, the Teamwork Graph for the links between work, Rovo and MCP for agents. |
| 4:38 – 4:45 | Title card: "L'addition — the cost of debt, in numbers you can defend" | No data leaves Atlassian. L'addition: the cost of debt, in numbers you can defend. |

---

## Figures used in the script

These four are fixed by the specification and must appear as written:

| Figure | Source |
|---|---|
| 19 – 34 p-d for PAY-77, low/high | §7.1 |
| 1 – 2 p-d for the team's favourite refactor | §7.1 |
| 22 p-d for the `notifications` zone, no debt ticket | §7.2 |
| Repayment 8 p-d, return 3 – 6× over two quarters | §7.1 |
| Breakdown 4 incidents / 11 p-d, 9 bugs / 8 p-d, 6 tickets / 5 – 15 p-d | §7.1 |
| Before 2.6 → after 0.7 p-d per week | §7.5 |
| 180 days without evidence for dead debt | §7.3 |

The delta on screen at 2:30 (how far the low bound moves after the
confirmation) comes from the injected sample. Read it from the UI before
recording and drop the two numbers into the voiceover — never read a figure that
is not on screen.

## Before you record

- [ ] Sample data loaded; **"Sample data" banner visible** in every UI shot (§22).
- [ ] UI language: English. No French label on screen.
- [ ] No customer name, no real employee name, no per-person total anywhere
      (§18: the unit is the zone or the team).
- [ ] Browser zoom 110 %, 1080p, cursor movements slowed down, no dead time.
- [ ] Each click preceded by a 0.3 s hover so the viewer can follow.
- [ ] Total runtime ≤ 4:45, captions on, narration intelligible at 1.0×.

## Do not claim

The script stays inside the specification. Do not say that the app:

- analyses source code or code quality (§6 — out of scope);
- predicts future cost (vision, §25 — not in V1);
- converts to euros (DT-20, after the hackathon);
- measures pull requests precisely (§15 — approximated only);
- ranks people or teams by productivity (§18 — forbidden by design);
- proves that a repayment caused the improvement (§11 — before/after only).
