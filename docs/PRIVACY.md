# Privacy Policy — L'addition

**App:** L'addition (Forge app for Jira, hosted entirely on Atlassian infrastructure)
**Publisher:** Baptiste Faisy
**Effective date:** `<EFFECTIVE_DATE — set on publication day, see the publication plan in docs/NOTES-DE-SOUMISSION.md>`

L'addition computes the past cost of technical debt on a Jira site and checks
whether repaying a debt actually lowered that cost. This policy explains what
it reads, what it stores, and what it never does. It applies to every site
where the app is installed.

## What the app reads

L'addition reads, through Atlassian APIs only and only on the site where it is
installed: issues and their status history (changelogs), issue links, comments,
components, labels, issue types and logged time.

It reads user identifiers (**account IDs — never display names**) solely to
count the distinct participants of an incident, which is an input of one cost
formula. Participant counts are aggregate numbers; they are never attached to
an identifiable person in any output.

The app declares **no Teamwork Graph scope** and reads no Teamwork Graph data.

## What the app stores

Everything is stored in Forge SQL, inside the installation's own storage
partition on the Atlassian platform:

- computed costs and bills per debt ticket;
- evidence items and attribution shares;
- human decisions (confirmations and rejections of matches);
- cached relevance scores, keyed by a fingerprint of the two texts;
- project settings;
- repayment bulletins.

Nothing is stored outside the Atlassian platform. The app has no server, no
database and no analytics of its own.

## Retention and deletion

Data is kept for as long as the app remains installed on the site.
Uninstalling the app removes its storage; deletion is then handled by the Forge
platform under Atlassian's data-retention policy.

The injected sample dataset (a demonstration feature) can be removed at any
time from the project settings ("Remove sample data"), which deletes those rows
from the app's tables.

To request deletion of data while the app stays installed, contact the
publisher (see below); project settings and stored decisions can be reset per
project.

## No outbound network call

The app calls only Atlassian APIs (Jira REST, Forge SQL, Forge LLMs). It never
contacts a third-party server.

## Language model

Text is processed only by Atlassian-hosted models (Forge LLMs, Claude family),
under Atlassian's own data policies. The model only scores the relevance
between a proof and a debt ticket and drafts text; it never produces a figure.
Scores are cached by text fingerprint and recomputed only when a text changes.

## No per-person metric, anywhere

The unit of every report is the zone or the team. The code path is guarded
(`src/core/privacy.ts`, covered by tests), and acceptance point #10 of the
specification checks it. Names appear only on tickets the reader can already
open.

## Access rights

Proofs coming from projects the reader cannot open are counted in the totals
but shown as "hidden items" — never displayed.

## Contact

Questions about privacy, or a data-deletion request: open an issue on the
public repository `github.com/BaptisteFaisy/laddition`, or contact the
publisher through the Marketplace listing.
