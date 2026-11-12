# Terms of Use — L'addition

**App:** L'addition (Forge app for Jira, hosted entirely on Atlassian infrastructure)
**Publisher:** Baptiste Faisy (the "Publisher")
**Effective date:** `<EFFECTIVE_DATE — set on publication day, see the publication plan in docs/NOTES-DE-SOUMISSION.md>`

These terms govern the use of the L'addition app (the "App") distributed
through the Atlassian Marketplace. By installing or using the App, you (the
customer, on behalf of yourself and your organisation) agree to these terms.
If you do not agree, do not install the App, or uninstall it.

## 1. What the App does

The App computes the past cost of technical debt on your Jira site and checks
whether repaying a debt lowered that cost. Every figure it shows opens on the
list of tickets behind it and the formula that produced it. The App is a
decision-support tool: it proposes, a human decides. It never creates, closes,
ranks or prioritises a ticket on its own, and it never produces a metric per
person.

## 2. License

The Publisher grants you a non-exclusive, non-transferable right to install and
use the App on the Atlassian sites your organisation controls, for as long as
these terms apply and the App remains listed on the Marketplace. You may not
resell, sublicense or redistribute the App. The App runs entirely on the
Atlassian Forge platform, under Atlassian's own terms for that platform.

## 3. Your data

Data handling is described in the App's Privacy Policy (same repository,
`PRIVACY.md`, and linked from the Marketplace listing). In short: the App reads
only your Jira data, through Atlassian APIs, only on the site where it is
installed; it stores everything in Forge SQL inside your installation's own
storage partition; it makes no outbound network call to any third-party server;
uninstalling removes its storage.

## 4. Acceptable use

Do not use the App to monitor, rank or evaluate individuals. The App is
designed to refuse per-person metrics; attempting to repurpose its outputs for
individual performance evaluation violates these terms and the product's
stated method.

## 5. Figures and decisions

The costs the App computes are estimates with a documented method, a low bound
and a high bound, and explicit data-quality warnings ("insufficient data" where
the sample is too small). They are inputs to a human arbitration, not a
verdict. Repayment bulletins are before-and-after comparisons, not proofs of
causality. Decisions taken on the basis of the App's outputs are yours.

## 6. Support

Support is provided on a reasonable-effort basis through the public repository
`github.com/BaptisteFaisy/laddition` (issues and discussions). There is no
guaranteed response time and no service-level agreement.

## 7. Disclaimer and limitation of liability

The App is provided "as is", without warranty of any kind, to the extent
permitted by law. The Publisher is not liable for decisions made using the App,
for data loss, or for any indirect or consequential damage arising from its
use. Nothing in these terms excludes liability that cannot be excluded by law.

## 8. Changes

The Publisher may update these terms and the App. Continued use of the App
after an update constitutes acceptance of the updated terms. The current terms
are always the ones published at the URL referenced by the Marketplace listing.

## 9. Termination

You may stop using the App at any time by uninstalling it, which removes its
storage as described in the Privacy Policy. The Publisher may delist the App
from the Marketplace; already-installed copies keep working until Atlassian's
platform retires them, under Atlassian's own policies.

## 10. Contact

Questions about these terms: open an issue on the public repository
`github.com/BaptisteFaisy/laddition`, or contact the Publisher through the
Marketplace listing.
