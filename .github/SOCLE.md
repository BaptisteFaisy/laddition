# Socle CI self-hosted — L'addition

## Ce dépôt démarre avec

- **5 workers** self-hosted sur le serveur R630 (Debian 13, 80 cœurs) :
  `r630-laddition-01` … `r630-laddition-05`, labels `self-hosted, laddition-worker, ci-node, Linux, X64`,
  services systemd utilisateur `actions-runner-laddition-0N.service`.
- **CI réelle** (`.github/workflows/ci.yml`) : `npm ci` (cache npm du runner),
  `tsc --noEmit`, puis les tests du domaine (`node --test`). Node 22 est déjà
  installé sur le worker (`~/node-current`), avec repli `actions/setup-node`.
- **Couche 0** (`.github/workflows/couche0.yml`) : fichiers < 500 lignes,
  fonctions < 50 lignes (`tools/check_limits.py`), tests du gate hermes, et
  `manifest.yml` validé contre le schéma Forge officiel
  (`tools/validate_manifest.mjs`) — sans connexion Atlassian.
- **ci-budget** (`.github/workflows/ci-budget.yml` + `.github/ci-budget/check_timeouts.py`) :
  garde-fou du budget CI de **5 minutes** (règle user 2026-10-24). Chaque job
  déclare `timeout-minutes: 5` au plus ; un job plus long = CI refusée.
- **Mergify** (`.mergify.yml`) : file de merge, squash, mise à jour des PR par
  merge de main (jamais de rebase), batching 1-3, labels `urgent` /
  `priority-low`, auto-embarquement (`merge_protections_settings`). Les checks
  exigés sont `ci-budget`, `ci` et `couche0`.
- **Gate hermes-lite** (`.github/workflows/hermes-lite.yml` + `.github/hermes/gate.py`) :
  check `hermes-lite/verdict`, labels `hermes/approuvee` / `hermes/conflit`.
  En **dry-run** (`HERMES_LITE_DRY_RUN=1`) : il évalue et étiquette, il ne merge
  pas — Mergify est le seul pilote de merge.
- **Agent hermes de conflit** (`.github/hermes/conflict_agent.py`) : sur un
  conflit réel (`mergeable is False` **et** `mergeable_state == 'dirty'`), le
  gate saisit l'agent `hermes` du daemon ZeroClaw du worker via A2A
  (`http://127.0.0.1:42617/a2a/hermes`). L'agent clone la branche, fusionne
  `origin/main` en gardant les deux intentions, valide
  (`npm ci && npx tsc --noEmit && npm test`), pousse **uniquement** la branche
  de la PR ; le script publie un compte rendu unique et la file reprend.
  Variables : `HERMES_AGENT_RESOLVE=1`, `HERMES_ZC_AGENT=hermes`,
  `HERMES_AGENT_TIMEOUT=1500`. Jeton : `~/.gh-token` sur le worker.
- **Balayeur de file** (`.github/workflows/file-mergify.yml` + `.github/mergify/sweep.py`) :
  remet dans la file les PR prêtes éjectées (`@mergifyio queue`, 2 fois max par
  tête puis escalade). Secret `AUTOMERGE_PAT` requis pour commander Mergify.
- **stale-base-guard** : check informatif de retard de branche.

## Mise en service (ordre)

1. workers enregistrés et en ligne (fait le 11/11/2026) ;
2. app GitHub **Mergify** en « All repositories » + produit **Merge Queue**
   activé sur le dashboard (l'app installée ne suffit pas) ;
3. `HERMES_LITE_DRY_RUN=1` reste posée tant que Mergify pilote le merge —
   **jamais deux pilotes**.

## Règles du dépôt

- Une PR par sujet, `main` protégé, historique linéaire (squash).
- Aucun job de PR au-delà de 5 minutes : build Forge et déploiement hors PR.
- Le domaine (`src/core/`) reste pur : aucun import `@forge/*`, aucune I/O,
  aucune horloge implicite. C'est ce qui rend la méthode testable.
