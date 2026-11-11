# Points à valider — prototype de la première semaine (§17)

> Semaine du 11 au 17 novembre 2026 (§23). Six points, six verdicts écrits ici.
> Tant qu'un point n'est pas tranché, la partie du produit qui en dépend reste
> marquée « non validée » dans `docs/ARCHITECTURE.md`.

**État au 11 novembre 2026** : aucun des six points n'est encore prototypé. Le
domaine pur est écrit (`src/core/`), les adaptateurs Forge (`src/platform/`)
n'existent pas encore — c'est là que vivent les six réponses. Les six lignes
sont donc **à faire**.

## Tableau de synthèse

| # | Point | Ce qui se joue | Repli prévu | État |
|---|---|---|---|---|
| V1 | Volume et débit de lecture des historiques | L'initialisation lit des milliers de tickets | Fenêtre de 90 jours ; lots plus petits | à faire |
| V2 | Écriture en masse d'un champ d'app en lecture seule | Rend le coût triable dans Jira (DT-11) | Propriété de ticket indexée pour JQL | à faire |
| V3 | Données du site de démonstration | Sans historique, pas de coût | Jeu d'exemple injecté (DT-13) | à faire |
| V4 | Champ « services affectés » des incidents | Rattache les incidents aux zones (C1) | Composant du ticket d'incident | à faire |
| V5 | Dates d'ouverture et de fusion des PR dans le graphe | Mesure des PR lentes (C4) | Temps en statut de revue | à faire |
| V6 | Compass accessible depuis l'app Jira | Zones par composant Compass (§8) | Composants Jira (défaut actuel) | à faire |

## Protocole commun

1. Un site de développement dédié, une app déployée, une date notée.
2. Chaque point = un script jetable + une note de trois lignes : ce qu'on a
   mesuré, ce qui a cassé, le verdict.
3. Le verdict s'écrit ici **et** dans `memory/AAAA-MM-JJ.md` : une validation
   qui n'est pas écrite n'a pas eu lieu.
4. Un point « abandonné » n'est pas un échec : c'est le repli qui devient la
   règle, et le repli est déjà prévu au §17.

---

## V1 — Volume et débit de lecture des historiques

**Pourquoi** : l'initialisation lit des milliers de tickets et leur historique
complet (DT-12) ; le recalcul nocturne doit tenir en 15 minutes pour 5 000
tickets (§18).

**Comment on le teste**
- Script `tools/probe-history.mjs` : lecture par lots de 50 (`/rest/api/3/search/jql`
  puis l'historique de chaque ticket), sur 180 jours, en mesurant le nombre de
  requêtes, la durée, les `429` et les `Retry-After`.
- Mesures à relever : tickets lus, requêtes émises, durée totale, plus longue
  attente imposée, taux d'échec.
- Critère de réussite : 5 000 tickets lus et enregistrés en moins de 15 minutes,
  sans erreur non reprise.

**Où est le code** : à écrire — `src/platform/jira.ts` (lecture) et
`src/jobs/bootstrap.ts` (lots de 50, `consumer` à 900 s). Le découpage des durées
est déjà écrit (`src/core/duration.ts`), il ne dépend pas du débit.

**Repli prévu** : fenêtre ramenée à 90 jours ; lots plus petits ; reprise sur
erreur lot par lot (§24). Le produit reste utilisable : la fenêtre d'analyse est
un réglage (`windowDays`).

**État** : à faire.

---

## V2 — Écriture en masse d'un champ d'app en lecture seule

**Pourquoi** : le champ « Coût de la dette (j-p / 90 j) » doit être triable et
utilisable en JQL (DT-11, §20.8). C'est ce qui fait entrer le chiffre dans Jira
au lieu de le garder dans une page à part.

**Comment on le teste**
- Créer un `jira:customField` de type app, en lecture seule, via le manifeste.
- Écrire la valeur sur 200 tickets en une seule invocation (charge utile
  plafonnée à 5 Mo), puis vérifier : tri d'une liste de tickets, et requête JQL
  du type `"Coût de la dette" > 10`.
- Mesurer le débit et le comportement en cas d'échec partiel (reprise
  idempotente).

**Où est le code** : à écrire — `src/platform/customfield.ts` (écriture) et
`src/jobs/nightly.ts` (écriture du champ après le recalcul nocturne). Le calcul
de la valeur, lui, existe déjà (`DebtBill.lowJp` / `highJp` dans
`src/core/types.ts`).

**Repli prévu** : propriété de ticket indexée, interrogeable en JQL (§17).

**Risque** : un champ en lecture seule peut refuser l'écriture par l'app
elle-même. Le test doit le faire sur un vrai site, pas seulement avec
`forge lint`.

**État** : à faire.

---

## V3 — Données du site de démonstration

**Pourquoi** : sans incidents, sans composants et sans historique, il n'y a
aucun coût à mesurer. Or le coût se lit dans l'historique, qu'on ne peut pas
antidater par l'API (§22).

**Comment on le teste**
- Inventaire du site : composants du projet cible, incidents JSM (projet et
  champ « services affectés »), ancienneté des tickets (plus de 180 jours ?),
  présence d'un historique de statuts sur 20 tickets pris au hasard.
- Verdict binaire : ce site peut-il produire une addition crédible ?

**Où est le code** : à écrire — `src/sample/` (jeu d'exemple, DT-13) ; le
bandeau « données d'exemple » est porté par `settings.demoData`.

**Repli prévu** : jeu d'exemple injecté dans les tables de l'app — un projet
fictif de 6 mois, 3 dettes, 60 preuves, 1 remboursement (§22). Tous les écrans,
l'agent et les outils MCP fonctionnent dessus.

**État** : à faire. C'est le point le plus probablement « abandonné » : le repli
est déjà une fonctionnalité du produit, pas un pis-aller.

---

## V4 — Champ « services affectés » des incidents

**Pourquoi** : c'est ce qui rattache un incident JSM à une zone quand le mode
`service` est choisi (§8, famille C1).

**Comment on le teste**
- Lire le champ sur 5 incidents réels, par REST et dans la charge utile d'un
  événement de ticket.
- Mesurer le taux de remplissage : un champ vide ne casse rien, il fait tomber
  le ticket dans la cascade suivante.

**Où est le code** : à écrire — le mapping dans `src/platform/jira.ts`
(alimentation de `IssueFact.affectedServices`). La cascade de repli est déjà
écrite et testable : `src/core/zones.ts` (`pickByMode`, mode `service`).

**Repli prévu** : composant du ticket d'incident — déjà géré par la cascade,
sans code supplémentaire.

**État** : à faire (le repli, lui, est déjà codé).

---

## V5 — Dates d'ouverture et de fusion des PR dans le graphe

**Pourquoi** : la famille C4 et l'approche de la lenteur des PR dépendent des
dates de PR (§15, DT-14).

**Comment on le teste**
- Sur un ticket dont le dépôt est relié à Jira, interroger le Teamwork Graph
  (Preview) sur les relations de PR et vérifier la présence des dates d'ouverture
  et de fusion.
- Tester aussi **sans** le scope : le résultat doit être vide **sans erreur**
  (§17) — c'est le piège principal, un écran vide ne prouve pas l'absence.

**Où est le code** : à écrire — `src/platform/graph.ts`.

**Repli prévu** : temps passé par les tickets dans les statuts de revue, déjà
calculable avec `src/core/duration.ts` (`activeDays` par catégorie). Une app
Forge installée sur Jira ne peut pas appeler l'API Bitbucket (§15) : la mesure
fine reste hors périmètre.

**État** : à faire.

---

## V6 — Compass accessible depuis l'app Jira

**Pourquoi** : le mode de zone `compass` et les équipes propriétaires viennent
du graphe (§8).

**Comment on le teste**
- Avec un scope accordé par un administrateur d'organisation, appeler la
  relation « Jira work item impacts Compass component » sur un ticket connu.
- Vérifier que les composants remontent, puis retirer le scope et vérifier
  qu'on obtient une liste vide sans erreur.

**Où est le code** : à écrire — `src/platform/graph.ts`. Le mode de zone est
déjà implémenté côté domaine (`src/core/zones.ts`, `zoneMode: 'compass'`).

**Repli prévu** : composants Jira — c'est déjà le mode par défaut
(`zoneMode: 'component'`), donc le produit fonctionne sans Compass.

**État** : à faire.

---

## Journal des verdicts

À remplir au fur et à mesure. Un point sans ligne ici n'est pas tranché.

| # | Date | Verdict | Décision retenue | Écrit dans |
|---|---|---|---|---|
| V1 | — | — | — | — |
| V2 | — | — | — | — |
| V3 | — | — | — | — |
| V4 | — | — | — | — |
| V5 | — | — | — | — |
| V6 | — | — | — | — |

## Ce que ces six points changent dans le produit

- **V1 échoue** → la fenêtre par défaut passe à 90 jours et l'initialisation se
  fait en plusieurs invocations ; l'écran affiche une progression, pas un
  blocage.
- **V2 échoue** → le coût reste consultable dans l'app et dans les outils MCP,
  mais plus triable dans Jira : la recette n° 8 devient « propriété indexée ».
- **V3 échoue** → le jeu d'exemple devient le seul chemin de démonstration ; la
  page projet affiche la qualité des données au lieu d'un classement vide.
- **V4 échoue** → les incidents se rattachent par le composant de leur ticket ;
  le mode `service` disparaît des réglages.
- **V5 échoue** → les PR ne sont pas mesurées ; C4 se limite aux réouvertures,
  et la lenteur repose sur les statuts de revue.
- **V6 échoue** → Compass sort du périmètre de la V1 ; les zones sont les
  composants Jira.
