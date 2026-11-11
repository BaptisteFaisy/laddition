# Méthode — comment « L'addition » calcule un coût

> Document interne, en français. Chaque formule cite l'exigence qu'elle sert
> (DT-04, DT-05…) et le fichier qui l'implémente. Les valeurs entre parenthèses
> sont les réglages par défaut du projet, modifiables écran 6 (§14).
> Référence : `docs/CAHIER-DES-CHARGES.md`, § 8 à § 11.

## 1. Cadre de calcul

- **Fenêtre** : 90 jours glissants (`windowDays = 90`, bornes 7 à 365) — §9.
- **Unité** : le jour-personne (j-p). Une journée de travail vaut **7 h**
  (`hoursPerDay = 7`) et une semaine **5 jours ouvrés** (`daysPerWeek = 5`) — §9.
- **Jours ouvrés** : lundi à vendredi, bornes exclues à droite
  (`businessDaysBetween`, `src/core/time.ts`). Les jours calendaires ne servent
  qu'au retard induit (C5) et à l'ancienneté d'une dette morte.
- **Horloge** : l'instant de référence est toujours injecté (`CostContext.now`).
  Aucune fonction du domaine n'appelle `Date.now()` : c'est ce qui garantit
  qu'un même jeu de données donne la même addition (§18 « Stabilité »).
- **Transparence** : chaque preuve porte le texte de sa formule avec ses valeurs
  réelles (`EvidenceDetail.formula`) — §5.1, DT-06.

## 2. Du ticket à la zone (§8, DT-02)

Quatre sources, essayées dans cet ordre selon le mode choisi pour le projet
(`zoneMode`, écran 6) :

| Mode | Ordre de la cascade |
|---|---|
| `component` (défaut) | composant Jira → composant Compass → service affecté → étiquette `zone:` |
| `compass` | composant Compass → composant Jira → service affecté → étiquette |
| `service` | service affecté (incidents JSM) → composant Jira → composant Compass → étiquette |
| `label` | étiquette (préfixe `zone:` ou étiquette brute) → composant Jira → … |

- Un ticket rattaché à plusieurs zones **partage son coût à parts égales** :
  `part = coût ÷ nombre de zones` (`splitAcrossZones`). La somme des parts vaut
  le coût, au centième près.
- Un ticket sans aucune source tombe dans la zone **« non classé »**, dont la
  part est affichée comme indicateur de qualité des données (§8).
- Le renommage ou la fusion d'un composant ne crée pas de nouvelle zone : les
  zones suivent l'identifiant, pas le nom (§19).
- Implémentation : `src/core/zones.ts` (écrit).

## 3. Durées par statut (DT-03)

`reconstructStatusSpans` reconstruit les séjours d'un ticket dans chaque
catégorie de statut (`todo`, `inprogress`, `done`) à partir de l'historique :
le premier séjour commence à la création, chaque changement de statut ferme le
séjour courant et en ouvre un nouveau, le dernier reste ouvert tant que le
ticket n'est pas résolu.

`activeDays` / `inProgressDays` comptent ensuite les **jours ouvrés** passés
dans une catégorie donnée, un séjour encore ouvert étant arrêté à `now`.

Sans historique de statuts, la durée est **approchée** par création → résolution
et le coût est marqué `approximated` : l'écran l'affiche comme tel (§19).
Implémentation : `src/core/duration.ts` (écrit).

## 4. C1 — Incidents (DT-04, priorité M)

Pour chaque incident rattaché à la zone, daté dans la fenêtre (date de
résolution, sinon de création) :

```
coût C1 = durée de résolution (j ouvrés) × min(intervenants, 6)
          remplacé par le temps saisi s'il existe
          + 0,5 j-p si un post-mortem est lié
```

- **Intervenants** : assignés et commentateurs distincts pendant l'incident,
  plafonnés à `maxIncidentPeople = 6`. Justification : au-delà de six personnes,
  on compte des observateurs, pas du travail.
- **Temps saisi** : s'il existe, il remplace le calcul
  (`secondes ÷ 3600 ÷ hoursPerDay`) ; la méthode retenue est alors `logged` et
  la formule affichée le dit.
- **Post-mortem lié** : `postMortemBonusJp = 0,5` j-p, forfaitaire.
- **Incident non résolu** : compté jusqu'à aujourd'hui et marqué « en cours »
  (§19).
- Le coût est ensuite partagé entre les zones du ticket (§8).
- Implémentation : `src/core/families/c1.ts` (écrit).

## 5. C2 — Bugs (DT-04, priorité M)

Pour chaque bug **créé dans la fenêtre** sur la zone :

```
coût C2 = jours ouvrés en catégorie « en cours » × 1 personne
          remplacé par le temps saisi s'il existe
```

- Un bug n'occupe qu'une personne à la fois : pas de coefficient
  d'occupation, pas de multiplicateur d'intervenants.
- Sans historique de statuts : durée approchée création → résolution, marquée
  `approximated` (§19).
- Implémentation : `src/core/families/c2.ts` (écrit).

## 6. C3 — Lenteur (DT-04, priorité M)

Pour chaque ticket **hors bug** terminé dans la fenêtre sur la zone :

```
surcoût C3 = max(0, durée du ticket − durée de référence) × coefficient d'occupation
```

- **Durée** : jours ouvrés passés en statuts actifs.
- **Référence** : **médiane** des tickets de même type et de même classe de
  taille dans l'organisation, **hors zone étudiée** — sinon la lenteur se
  comparerait à elle-même (`computeBaselines`, `excludeZones`).
- **Classe de taille** : celle fournie par Jira (`xs` à `xl`) quand elle existe ;
  sinon déduite du temps saisi (moins d'un jour → `s`, moins de trois → `m`,
  au-delà → `l`) ; sans taille ni temps saisi → `unknown`.
- **Coefficient d'occupation** : `occupationCoefficient = 0,5` — un ticket en
  cours n'occupe pas quelqu'un à plein temps (§9).
- **Valeurs extrêmes rabotées au 95e centile** (`clipPercentile = 95`) : un
  ticket aberrant ne peut pas fixer à lui seul la référence. Le rabotage
  s'applique valeur par valeur, seuil = rang `ceil(0,95 × n)`.
- **Moins de 5 tickets de référence** (`minBaselineSample = 5`) : la famille est
  déclarée « données insuffisantes » pour cette zone, **aucun chiffre n'est
  affiché** (§9, §20.7).
- Implémentation : `src/core/baseline.ts` (écrit) pour les références ;
  `src/core/families/c3.ts` (à écrire) pour le calcul du surcoût.

## 7. C4 — Retouches (DT-14, priorité S)

Pour chaque ticket rouvert dont la dernière résolution tombe dans la fenêtre :

```
coût C4 = jours ouvrés entre chaque réouverture et la résolution suivante × 1 personne
```

- Une réouverture = un passage de `done` vers une autre catégorie
  (`reworkCount`).
- **Le temps saisi n'est pas retenu ici**, même quand il existe : C4 chiffre le
  *temps de reprise*, alors que le temps saisi du ticket est déjà compté par C2
  et C3 — le retenir compterait deux fois le même travail. La formule affichée
  l'explique au lecteur.
- Si le Teamwork Graph expose les PR, les PR refusées s'ajoutent (§9).
- Implémentation : `src/core/families/c4.ts` (écrit).

## 8. C5 — Retard induit (DT-14, priorité S)

Pour chaque ticket bloqué par un ticket de dette (lien `blocks`, de la dette
vers le ticket bloqué) :

```
retard C5 = jours calendaires entre la résolution du ticket de dette
            et la résolution du ticket bloqué (ou aujourd'hui s'il court encore)
```

**C5 n'entre jamais dans l'addition.** C'est du délai, pas de l'effort : il est
affiché à part, en jours de retard. `BILLED_FAMILIES` ne contient que C1 à C4,
et la preuve porte `detail.inputs.delai = true`.
Implémentation : `src/core/families/c5.ts` (écrit).

## 9. Attribution des preuves (§10, DT-05)

Une preuve appartient à une zone. Reste à dire quelle dette de la zone
l'explique.

| Situation | Attribution | Fourchette |
|---|---|---|
| Lien Jira explicite entre la preuve et le ticket de dette | 100 % à ce ticket | basse **et** haute |
| Rapprochement confirmé par un humain | 100 % à ce ticket | basse **et** haute |
| Même zone, aucun lien | partage au prorata du score de pertinence | haute **seulement** |
| Pertinence < 0,3 pour toutes les dettes de la zone | non attribuée → alimente la dette fantôme | — |

Règles de mise en œuvre (`src/core/attribution.ts`, écrit) :

- **Types de lien retenus** comme explicites : `relates to`, `caused by`,
  `blocks` ; le lien est lu dans les deux sens.
- **Aucun double compte** : pour une preuve donnée, la somme des parts vaut
  exactement 1,00 quand elle est attribuée, 0 sinon (`normalizeShares` +
  `closeToOne`, qui corrige la dérive d'arrondi sur la dernière part) — §5.3,
  DT-05.
- **Score de pertinence** (0 à 1) rendu par le modèle de langage, qui compare le
  texte de la preuve à la description du ticket de dette et **justifie sa note en
  une phrase** ; cette phrase est affichée telle quelle (`rationale`). Le modèle
  rapproche et rédige, il ne calcule pas (§5.5).
- **Seuil** : `relevanceFloor = 0,3`, réglable. En dessous, aucun rapprochement
  n'est proposé.
- **Rejet** : un rejet (table `rejection`) retire le couple preuve/dette de tous
  les calculs suivants et n'est plus proposé (§7.4, §20.3).
- **Stabilité** : les scores sont mis en cache avec une empreinte des textes
  comparés (`RelevanceScore.fingerprint`) et ne sont recalculés que si un texte
  change (§18).
- **Une seule dette sur la zone** : toutes les preuves sans lien lui sont
  proposées, mais restent dans la fourchette haute (§19).

## 10. Fourchette basse et fourchette haute

- **Basse** : uniquement les preuves liées explicitement ou confirmées par un
  humain — le fait, pas l'hypothèse.
- **Haute** : la basse, plus les preuves attribuées par rapprochement (partage
  au prorata).
- Une preuve ne pèse jamais plus de 100 % : une preuve partagée entre trois
  dettes contribue à hauteur de sa part, pas de son montant total (§5.2, §5.3).
- L'addition d'un ticket (`DebtBill`) publie `lowJp`, `highJp` et la ventilation
  par famille (`byFamily`, avec le nombre de preuves et le drapeau
  `insufficient` pour C3).

## 11. Remboursement, retour, délai de retour (§11, DT-15)

- **Remboursement** : estimation du ticket de dette. Points convertis en jours
  d'après la vélocité de l'équipe, ou estimation initiale en temps. Sans
  estimation : le ticket est classé par coût seul, avec la mention
  « remboursement non chiffré » (`repaymentJp = null`).
- **Coût évitable sur deux trimestres** :
  `addition basse × 2 × facteur de persistance`, avec
  `persistenceFactor = 0,7`. Justification : sur deux trimestres, une partie du
  coût disparaît d'elle-même (correctifs annexes, changements d'usage) — on ne
  crédite pas 100 % du coût passé au remboursement.
- **Retour** : `coût évitable ÷ remboursement` (bornes basse et haute).
- **Délai de retour** : `remboursement ÷ coût hebdomadaire moyen` de la zone.
- Implémentation : `src/core/payback.ts` (à écrire).

## 12. Bulletin de remboursement (§11, DT-16)

Quand un ticket de dette est clos, l'app compare le **coût hebdomadaire de la
zone** sur les **8 semaines précédant le début du travail** et les **8 semaines
suivant la clôture**, puis publie le résultat avec ses limites : autres
changements survenus dans la zone, taille de l'échantillon. C'est une
comparaison avant/après, **jamais une preuve de causalité** (§7.5).

Cas prévus : dette close puis rouverte → le bulletin est retiré et recalculé à
la clôture suivante ; plusieurs dettes closes sur la même zone le même mois →
un bulletin commun (§19).
Implémentation : `src/core/repayment.ts` (à écrire).

## 13. Dette fantôme (DT-08, §7.2)

```
zone signalée  ⟺  coût de la zone ≥ phantomThresholdJp (10 j-p)
                  ET aucun ticket de dette rattaché à cette zone
```

- Le seuil porte sur `ZoneCost.totalJp`, qui est déjà la somme des familles
  facturées (C5 exclue). Réglage `phantomThresholdJp = 10`, en cohérence avec
  §20.4 (« une zone coûtant plus de 10 j-p sans ticket de dette »).
- On ne propose pas un remboursement mais un **brouillon de ticket** rédigé à
  partir des preuves : les 5 preuves les plus coûteuses de la zone
  (`PHANTOM_TOP_EVIDENCE`), visibles pour le lecteur.
- Aucune preuve masquée pour le lecteur n'est citée (§18 « Droits »).
- Implémentation : `src/core/phantom.ts` (écrit).

## 14. Dette morte (DT-09, §7.3)

```
ticket de dette mort  ⟺  aucune preuve (part > 0) depuis plus de deadDays (180 jours)
```

- Un ticket jamais alimenté compte depuis sa **création** : « jamais justifié ».
- Comptage en **jours calendaires** : six mois d'oubli restent six mois,
  week-ends compris (choix documenté dans le code).
- Tri : jours sans preuve décroissants, puis clé alphabétique — l'ordre est
  stable pour que deux exécutions rendent la même liste.
- On signale le ticket pour qu'il soit rouvert, requalifié ou fermé ; il n'est
  jamais retiré du classement en silence.
- Implémentation : `src/core/dead.ts` (écrit).

## 15. Qualité des données (§8, §14 onglet Méthode)

Trois indicateurs, affichés avec les formules :

1. **Part des tickets sans zone** (`unclassifiedShare`, arrondie au centième) :
   la taille de « non classé » est un indicateur de qualité, pas un détail.
2. **Familles déclarées insuffisantes**, par zone (C3 sous 5 références).
3. **Part du coût venant d'un temps saisi** plutôt que d'un calcul, et **nombre
   de tickets dont l'historique manque** (§19 : « la part de chaque méthode est
   affichée »).

Implémentation : `src/core/quality.ts` (à écrire) ; `unclassifiedShare` existe
déjà dans `src/core/zones.ts`.

## 16. Coefficients par défaut et justification

Tous sont bornés dans `mergeSettings` (`src/core/settings.ts`) : un réglage
absurde ne casse jamais un calcul, il est ramené dans l'intervalle ou remplacé
par le défaut.

| Réglage | Défaut | Bornes | Pourquoi ce défaut |
|---|---|---|---|
| `hoursPerDay` | 7 h | 1 – 24 | Journée de travail retenue par le cahier des charges (§9) ; 8 h possible pour une autre convention. |
| `daysPerWeek` | 5 | 1 – 7 | Semaine ouvrée (§9). |
| `windowDays` | 90 | 7 – 365 | Un trimestre glissant : assez long pour capter les incidents récurrents, assez court pour rester actionnable (§9). |
| `deadDays` | 180 | 30 – 730 | Deux trimestres sans preuve : la dette ne coûte plus, elle dort (§9, DT-09). |
| `occupationCoefficient` | 0,5 | 0 – 1 | Un ticket en cours n'occupe personne à plein temps (§9). |
| `persistenceFactor` | 0,7 | 0 – 1 | Une partie du coût passé ne se reproduirait pas de toute façon ; on ne promet pas 100 % (§11). |
| `minBaselineSample` | 5 | 1 – 100 | Sous 5 tickets, une médiane n'est pas une référence (§9, §20.7). |
| `clipPercentile` | 95 | 50 – 100 | Rabote les valeurs extrêmes sans supprimer de ticket (§9). |
| `maxIncidentPeople` | 6 | 1 – 50 | Au-delà de six, on compte des observateurs (§9). |
| `postMortemBonusJp` | 0,5 | 0 – 10 | Coût forfaitaire d'un post-mortem lié (§9). |
| `relevanceFloor` | 0,3 | 0 – 1 | Sous 0,3, le rapprochement n'est plus défendable (§10). |
| `phantomThresholdJp` | 10 j-p | 0 – 1000 | Seuil de la dette fantôme (§20.4). |

Réglages non numériques : `debtRule` (type, étiquette ou JQL — DT-01),
`zoneMode` (§8), `jsmProjectKeys`, `teamByZone`, `demoData` (bandeau du jeu
d'exemple).

## 17. Ce que la méthode ne fait pas

- Elle n'analyse pas le code source (§6).
- Elle ne produit **aucun indicateur par personne** : l'unité est la zone ou
  l'équipe (§5.4, §18, recette n° 10).
- Elle ne prouve pas de causalité : le bulletin compare avant et après et
  énonce ses limites (§11).
- Elle ne note pas le backlog : elle mesure un coût passé et vérifie un
  remboursement (§24).
- Elle ne compte pas deux fois : une preuve est répartie à 100 % au plus, et C4
  ne réutilise pas le temps saisi déjà compté en C2/C3 (§5.3).

## 18. Où est le code

| Formule | Fichier | État |
|---|---|---|
| unités, jours ouvrés, arrondis | `src/core/time.ts` | écrit |
| réglages et bornes | `src/core/settings.ts` | écrit |
| zones et partage (§8) | `src/core/zones.ts` | écrit |
| durées par statut (DT-03) | `src/core/duration.ts` | écrit |
| références C3 | `src/core/baseline.ts` | écrit |
| C1, C2, C4, C5 | `src/core/families/c1.ts`, `c2.ts`, `c4.ts`, `c5.ts` | écrit |
| C3 (surcoût) | `src/core/families/c3.ts` | à écrire |
| attribution (§10, DT-05) | `src/core/attribution.ts` | écrit |
| dette fantôme, dette morte | `src/core/phantom.ts`, `dead.ts` | écrit |
| addition, classement | `src/core/bill.ts`, `ranking.ts` | à écrire |
| retour et délai de retour | `src/core/payback.ts` | à écrire |
| bulletin de remboursement | `src/core/repayment.ts` | à écrire |
| qualité des données | `src/core/quality.ts` | à écrire |
