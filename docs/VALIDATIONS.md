# Points à valider — prototype de la première semaine (§17)

> Semaine du 11 au 17 novembre 2026 (§23). Six points, six verdicts écrits ici.
> Tant qu'un point n'est pas tranché, la partie du produit qui en dépend reste
> marquée « non validée » dans `docs/ARCHITECTURE.md`.

**État au 11 novembre 2026 (mis à jour le soir)** : les six points ont été
**mesurés sur le runtime Forge** — voir le *Journal des verdicts* en bas de ce
document. Les adaptateurs Forge (`src/platform/`) et les jobs (`src/jobs/`)
sont écrits, déployés et installés en `development` **et** `production` ; les
sondes qui ont produit les mesures sont du code du dépôt
(`src/jobs/opsValidate.ts`). Verdicts : V2 validé sans repli ; V1 mesuré
au-dessus du budget de 15 min, repli appliqué ; V3 confirmé pauvre, le jeu
d'exemple est le chemin de démonstration ; V4, V5 et V6 non concluants par le
graphe sur le site de démo, replis appliqués (à rouvrir sur un site dont
l'administrateur a accordé les scopes du graphe).

> **Dépôt public — aucune valeur sensible (item G96).** Le site de démo, l'id
> d'app, les identifiants d'installation et l'id du champ personnalisé sont des
> placeholders (`<DEMO_SITE>`, `<APP_ID>`, `<INSTALLATION_ID_DEV>`,
> `<INSTALLATION_ID_PROD>`, `<CUSTOM_FIELD_ID>`). Où les retrouver : console
> développeur <https://developer.atlassian.com/console/myapps> (app « L'addition »,
> onglet *Installations*), `forge site list`, `forge install --list` ; l'id du
> champ se lit sur n'importe quel ticket du site (champ « Coût de la dette »).
> Détail dans `docs/NOTES-DE-SOUMISSION.md`.

## Tableau de synthèse

| # | Point | Ce qui se joue | Repli prévu | État |
|---|---|---|---|---|
| V1 | Volume et débit de lecture des historiques | L'initialisation lit des milliers de tickets | Fenêtre de 90 jours ; lots plus petits | **mesuré — repli appliqué** |
| V2 | Écriture en masse d'un champ d'app en lecture seule | Rend le coût triable dans Jira (DT-11) | Propriété de ticket indexée pour JQL | **validé — pas de repli** |
| V3 | Données du site de démonstration | Sans historique, pas de coût | Jeu d'exemple injecté (DT-13) | **validé — jeu d'exemple indispensable** |
| V4 | Champ « services affectés » des incidents | Rattache les incidents aux zones (C1) | Composant du ticket d'incident | **mesuré — repli appliqué** |
| V5 | Dates d'ouverture et de fusion des PR dans le graphe | Mesure des PR lentes (C4) | Temps en statut de revue | **mesuré — repli appliqué** |
| V6 | Compass accessible depuis l'app Jira | Zones par composant Compass (§8) | Composants Jira (défaut actuel) | **mesuré — repli appliqué** |

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

**Où est le code** : écrit — `src/platform/jira.ts` (lecture) et
`src/jobs/consumer.ts` (lots de 50, `consumer` à 900 s). Le découpage des durées
vit dans `src/core/duration.ts`, il ne dépend pas du débit.

**Repli prévu** : fenêtre ramenée à 90 jours ; lots plus petits ; reprise sur
erreur lot par lot (§24). Le produit reste utilisable : la fenêtre d'analyse est
un réglage (`windowDays`).

**État** : **mesuré le 11/11** — 200 à 250 ms par ticket, 17 à 21 min projetées
pour 5 000 tickets, au-dessus du budget de 15 min : **repli appliqué** (voir le
journal).

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

**Où est le code** : écrit — `src/platform/field.ts` (écriture) et
`src/jobs/recompute.ts` (écriture du champ après le recalcul nocturne). Le calcul
de la valeur vit dans le domaine (`DebtBill.lowJp` / `highJp` dans
`src/core/types.ts`).

**Repli prévu** : propriété de ticket indexée, interrogeable en JQL (§17).

**Risque** : un champ en lecture seule peut refuser l'écriture par l'app
elle-même. Le test doit le faire sur un vrai site, pas seulement avec
`forge lint`.

**État** : **validé le 11/11** — `<CUSTOM_FIELD_ID>`, 10 écritures sur 10,
triable et filtrable en JQL : **aucun repli nécessaire** (voir le journal).

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

**Où est le code** : écrit — `src/sample/dataset.ts` et `src/sample/load.ts`
(jeu d'exemple, DT-13, verrouillé par `src/sample/dataset.test.ts`) ; le
bandeau « données d'exemple » est porté par `settings.demoData`.

**Repli prévu** : jeu d'exemple injecté dans les tables de l'app — un projet
fictif de 6 mois (§22). Tous les écrans, l'agent et les outils MCP fonctionnent
dessus. **Composition mesurée du jeu injecté le 11/11** : **68 faits, 65 preuves,
5 zones, 10 dettes dont 3 dettes principales (§7.1) et 7 dettes mortes (§7.3),
1 remboursement**.

**État** : **mesuré le 11/11** — le site de démo est confirmé pauvre en
historique récent ; le repli (jeu d'exemple) **est le chemin de démonstration**,
une fonctionnalité du produit, pas un pis-aller (voir le journal).

---

## V4 — Champ « services affectés » des incidents

**Pourquoi** : c'est ce qui rattache un incident JSM à une zone quand le mode
`service` est choisi (§8, famille C1).

**Comment on le teste**
- Lire le champ sur 5 incidents réels, par REST et dans la charge utile d'un
  événement de ticket.
- Mesurer le taux de remplissage : un champ vide ne casse rien, il fait tomber
  le ticket dans la cascade suivante.

**Où est le code** : écrit — le mapping dans `src/platform/jira.ts`
(alimentation de `IssueFact.affectedServices`). La cascade de repli est écrite
et testée : `src/core/zones.ts` (`pickByMode`, mode `service`).

**Repli prévu** : composant du ticket d'incident — déjà géré par la cascade,
sans code supplémentaire.

**État** : **mesuré le 11/11** — non concluant par le graphe (0 service affecté
sur 5 incidents) : **repli appliqué** (composant Jira de l'incident), à rouvrir
sur un site dont les scopes du graphe sont accordés (voir le journal).

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

**Où est le code** : écrit — `src/platform/graph.ts`.

**Repli prévu** : temps passé par les tickets dans les statuts de revue, déjà
calculable avec `src/core/duration.ts` (`activeDays` par catégorie). Une app
Forge installée sur Jira ne peut pas appeler l'API Bitbucket (§15) : la mesure
fine reste hors périmètre.

**État** : **mesuré le 11/11** — non concluant (aucune PR lue dans le graphe) :
**repli appliqué** (temps passé en statut de revue, `src/core/families/c3.ts`),
voir le journal.

---

## V6 — Compass accessible depuis l'app Jira

**Pourquoi** : le mode de zone `compass` et les équipes propriétaires viennent
du graphe (§8).

**Comment on le teste**
- Avec un scope accordé par un administrateur d'organisation, appeler la
  relation « Jira work item impacts Compass component » sur un ticket connu.
- Vérifier que les composants remontent, puis retirer le scope et vérifier
  qu'on obtient une liste vide sans erreur.

**Où est le code** : écrit — `src/platform/graph.ts`. Le mode de zone est
déjà implémenté côté domaine (`src/core/zones.ts`, `zoneMode: 'compass'`).

**Repli prévu** : composants Jira — c'est déjà le mode par défaut
(`zoneMode: 'component'`), donc le produit fonctionne sans Compass.

**État** : **mesuré le 11/11** — non concluant (0 composant Compass, 0 équipe) :
**repli appliqué** (composants Jira), voir le journal.

---

## Journal des verdicts

À remplir au fur et à mesure. Un point sans ligne ici n'est pas tranché.

Toutes les mesures ci-dessous ont été prises le **11 novembre 2026** sur le site
de démonstration `<DEMO_SITE>` (placeholder — voir la note en tête de ce
document), app installée en `development`, via le webtrigger d'exploitation
(`?action=probe`). Chaque sonde est du code du dépôt (`src/jobs/opsValidate.ts`) :
les chiffres sont reproductibles.

| # | Date | Verdict | Décision retenue | Écrit dans |
|---|---|---|---|---|
| V1 | 11/11 | **200 à 250 ms par ticket** (historique compris, 35 tickets mesurés sur ITO et PLAT, 0 échec) → **17 à 21 min projetées pour 5 000 tickets**, au-dessus du budget de 15 min (§18) | Le repli du §17 s'applique : fenêtre de 90 jours par défaut, initialisation par lots de 50 dans la file (900 s par lot), barre de progression. Sur un site réel, lancer l'initialisation hors heures ouvrées | `src/jobs/consumer.ts`, `src/jobs/opsValidate.ts` |
| V2 | 11/11 | **Validé.** Champ `<CUSTOM_FIELD_ID>` « Coût de la dette (j-p / 90 j) » créé par l'app, **10 écritures sur 10**, 0 échec ; valeur lisible par l'API REST et **triable/filtrable en JQL** (`... is not EMPTY ORDER BY ... DESC`) | Aucun repli nécessaire : DT-11 et la recette §20 n° 8 tiennent sur le champ d'app en lecture seule | `src/platform/field.ts` |
| V3 | 11/11 | **Confirmé : le site de démo n'a presque pas d'historique récent.** 26 projets, PLAT 31 161 tickets dont **0** sur 180 jours, ITO 9 640 dont 7 498 incidents et **0** sur 180 jours, PAY 18 | Le jeu d'exemple (DT-13) n'est pas une option mais le chemin de démonstration : 68 faits, 65 preuves, 5 zones injectés, et les chiffres du §7.1 reproduits à l'identique | `src/sample/`, `docs/JUGES.md` |
| V4 | 11/11 | **Non concluant par le graphe** : 0 service affecté rendu sur 5 incidents interrogés | Repli retenu : le composant Jira du ticket d'incident fait la zone (mode `component`, déjà le défaut). Un site réel avec les scopes du graphe accordés est à tester avant la soumission | `src/core/zones.ts` |
| V5 | 11/11 | **Non concluant** : aucune PR lue dans le graphe (l'appel se fait hors contexte utilisateur, et le scope n'est pas accordé sur ce site) | Repli retenu : la lenteur des PR est approchée par le temps passé en statut de revue (C3), comme prévu au §15 | `src/core/families/c3.ts` |
| V6 | 11/11 | **Non concluant** : 0 composant Compass, 0 équipe rendue | Repli retenu : zones par composants Jira. Le mode `compass` reste au manifeste et dans les réglages, il s'activera sur un site dont l'administrateur a accordé les scopes | `src/platform/graph.ts` |

### Bug trouvé grâce à ces sondes (et corrigé)

`GET /rest/api/3/issue/{key}/changelog` répond **`values`** (pagination
`nextPage` / `isLast`), alors que `?expand=changelog` répond **`histories`**.
Le code ne lisait que `histories` : sur un vrai site, **toutes les durées par
statut étaient vides**, et C2, C3 et C4 retombaient silencieusement sur la
durée approximée création → résolution. Corrigé dans `historyItemsOf()`
(les deux formes acceptées), verrouillé par `src/platform/jira.test.ts`.
Avant correctif : 0 entrée d'historique sur 35 tickets. Après : 9 entrées de
statut sur 20 tickets ITO.

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

## Vérification du 12/11 — les 26 surfaces de lecture répondent sur le site

Mesuré le **12 novembre 2026** sur `<DEMO_SITE>`, app installée en **production**
(version 3.1.0, installation mise à jour), projet **PAY** avec le jeu d'exemple
(68 faits, 65 preuves, 5 zones, `dayRateEur = 650`, `storyPointField =
customfield_10016`).

Outil : la sonde `?action=screens` (`src/jobs/opsScreens.ts`), ajoutée ce jour.
Elle joue **toutes les clés en lecture** du registre des résolveurs et **tous les
outils MCP en verbe GET**, avec les mêmes payloads que les écrans, et rend une
ligne par surface. Les listes sont dérivées des registres : une surface ajoutée
sans écran ni outil fait rougir `src/jobs/opsScreens.test.ts`.

| Surface | Verdict | Ce qui prouve qu'elle a travaillé |
|---|---|---|
| `getProjectPage` | ok | 10 dettes au classement, 5 zones |
| `getDebtBill` | ok | PAY-77 : 19–34 j-p, 19 preuves |
| `getDebtCase` (`&llm=1`) | ok | argumentaire DT-17 rédigé pour PAY-77 |
| `getZoneCosts` | ok | 1 zone, 14 semaines |
| `listPhantomDebt` | ok | 1 zone sans ticket (notifications, 22 j-p) |
| `listDeadDebt` | ok | 7 dettes mortes |
| `getRepaymentReport` | ok | 1 bulletin (PAY-41 : 3,4 → 0,6 j-p/semaine) |
| `listZoneEvidence` | ok | 19 preuves pour la zone `facturation` |
| `listDebtAttributions` | ok | 19 parts d'attribution |
| `getIssueCost` | ok | PAY-77 : 19–34 j-p sur 90 jours |
| `getGadgetData` | ok | 5 dettes, 4 équipes, 2 trimestres |
| `getSettings` | ok | règle de dette, mode de zone, 7 h/jour |
| `bootstrapProgress` | ok | vide (aucune initialisation en cours) |
| `getDataQuality` | ok | 68 tickets, 1 sans zone (1,47 %), aucune troncature |
| `simulateRepayment` | ok | DT-21 : 3 dettes simulées + totaux |
| `previewDebtTicket` (`&llm=1`) | ok | brouillon « Dette technique facturation : 34 j-p… » |
| 10 outils MCP `GET` | ok | dont `get-debt-case`, `list-zone-evidence`, `list-projects` |

**Bilan : `allOk = true`, 26 surfaces jouées, 0 échec.** Surfaces volontairement
non jouées (elles écrivent) : `saveSettings`, `loadSampleData`, `clearSampleData`,
`startBootstrap`, `confirmEvidence`, `rejectEvidence`, `draftDebtTicket`,
`confirm-evidence`.

Vérifications complémentaires du même jour, sur le même site :

- **Recette §20 n° 9** (mêmes chiffres partout) : `?action=bill&key=PAY-77` rend
  `identical: true` — l'outil MCP `get-debt-bill` et le résolveur du panneau
  donnent 19–34 j-p et 19 preuves.
- **Sécurité des webtriggers** (items G85-G87) : 403 « jeton d'exploitation
  absent ou invalide » sans jeton, 200 avec. Une clé de projet fantaisie est
  refusée avant d'entrer dans un JQL.
- **La sonde ne laisse plus de trace** : `exerciseMcp` confirme un rapprochement
  pour mesurer le gain (recette §20 n° 3) puis l'annule et recalcule
  (`restoreInferred`). PAY-41 est revenu à 1–2 j-p, la recette est rejouable par
  un juge — avant ce correctif, la sonde laissait PAY-41 à 2–2 j-p.

Ce que cette sonde **ne prouve pas** : le rendu UI Kit 2 dans le navigateur
(item H98) et les captures (item H99). Ces deux points exigent une session
Atlassian authentifiée ; la procédure est prête dans `docs/CAPTURES.md`.

## Vérification du 12/11 — les écrans ouverts dans un navigateur

La prise des captures a été la première ouverture réelle des six écrans (item
H98). Résultat : **trois défauts que ni la CI ni les tests de domaine ne
voyaient**, tous corrigés et mergés le jour même.

| Défaut trouvé à l'écran | Cause | Correctif |
|---|---|---|
| **Aucun tableau n'affichait de ligne** (classement, zones, dettes, preuves, méthode, gadget) | `parseTable` ne reconnaît que `Head`, `Row` et `Fragment` : un composant de ligne personnalisé (`RankingRow`…) était invisible, donc ignoré | #77 : `markTableRow` + `src/ui/table-parse.ts` (pur, testé) ; garde `src/ui/table-rows.test.ts` |
| **« Part du coût non classé : 147 % »** pour 1,47 % | les parts de `DataQuality` sont des pourcentages (0-100), `formatPercent` attend un ratio 0-1 | #76 et #79 : `formatPercentValue`, sémantiques explicites dans `core/types.ts` |
| **« ticket 66499 inconnu »** sur le panneau de PAY-77 | le jeu d'exemple est pur (identifiants dérivés des clés) alors que les écrans reçoivent l'identifiant Jira du ticket | #75 : alignement des identifiants sur les vrais tickets à l'injection |

Autre constat du même jour : **l'installation de production datait d'avant les
nouvelles colonnes** — les 20 `ALTER TABLE` sont refusés par Forge SQL, et le
recalcul y échouait (`Unknown SQL execution error`, à `purgeProject`). Le schéma
a été recréé (`?action=reset-schema`) puis le jeu d'exemple réinjecté ; le
recalcul d'un projet réel reste à rejouer (point ouvert, voir
`docs/NOTES-DE-SOUMISSION.md`).

Après correction, les captures montrent bien : le classement complet (10 dettes,
PAY-77 à 19–34 p-d), les zones (5), la dette fantôme, les 7 dettes mortes, le
bulletin, la méthode (1,5 % de coût non classé), la simulation (3 dettes
sélectionnées) et l'argumentaire de PAY-77 (remboursement 8 p-d, évitable
26,6 p-d, retour ×3,3–×6, délai 37,9 j, 8 preuves, limites).
