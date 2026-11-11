# Architecture — L'addition

> App Forge installée sur Jira. Une seule app, aucune sortie réseau (§15).
> Le domaine est pur, la plateforme est un adaptateur, l'UI ne calcule rien.

## Couches

```
src/core/        domaine pur — aucun import @forge/*, aucune I/O, aucune horloge
src/platform/    adaptateurs Forge : SQL, REST Jira, Teamwork Graph, LLM, champ
src/jobs/        points d'entrée Forge : triggers, scheduledTrigger, consumer
src/resolvers/   API des écrans : lecture des résultats enregistrés
src/ui/          Kit 2 — affiche, ne calcule pas
src/mcp/         agent Rovo + 8 actions exposées par rovo:mcp
src/sample/      jeu d'exemple injecté par un bouton (DT-13)
```

Règle de dépendance : `core` ne dépend de rien ; `platform` dépend de `core` ;
`jobs`, `resolvers`, `ui`, `mcp` dépendent des deux. Aucun import de `ui` dans `core`.

## Fichiers du domaine

| Fichier | Responsabilité | Statut |
|---|---|---|
| `core/types.ts` | contrat partagé (ne pas modifier sans coordination) | écrit |
| `core/time.ts` | conversions temps et j-p, semaines ISO | écrit |
| `core/settings.ts` | réglages par défaut et bornage | écrit |
| `core/units.ts` | conversion points → jours, vélocité, euros | à écrire |
| `core/zones.ts` | ticket → zones (§8), partage, « non classé » | écrit |
| `core/duration.ts` | durées par statut depuis l'historique | écrit |
| `core/baseline.ts` | références C3 : médiane par type et taille | écrit |
| `core/families/c1.ts` | incidents | écrit |
| `core/families/c2.ts` | bugs | écrit |
| `core/families/c3.ts` | lenteur | à écrire |
| `core/families/c4.ts` | retouches | écrit |
| `core/families/c5.ts` | retard induit (hors addition) | écrit |
| `core/families/index.ts` | sélection et calcul de toutes les preuves | à écrire |
| `core/attribution.ts` | §10 : parts, plafond, rejets | écrit |
| `core/bill.ts` | addition d'un ticket, fourchette, par famille | à écrire |
| `core/ranking.ts` | classement (DT-07) | à écrire |
| `core/phantom.ts` | dette fantôme (DT-08) | écrit |
| `core/dead.ts` | dette morte (DT-09) | écrit |
| `core/payback.ts` | retour, délai de retour | à écrire |
| `core/repayment.ts` | bulletin avant/après | à écrire |
| `core/quality.ts` | qualité des données | à écrire |
| `core/privacy.ts` | masquage, interdits (§18) | à écrire |

## Conventions

- **Fonctions pures.** Aucune fonction du domaine ne lit `Date.now()` : l'instant
  de référence est toujours `CostContext.now`.
- **Pas d'`enum`.** Node exécute les tests TypeScript en retirant les types : les
  `enum` et les `namespace` ne sont pas supportés. Utiliser des unions de chaînes
  et des objets `const` avec `as const`.
- **Imports explicites.** Toujours `import { x } from './y.ts'` (extension
  comprise) : c'est ce qui permet à `node --test` de charger les fichiers.
- **Imports de types.** `import type { X } from './types.ts'` (`verbatimModuleSyntax`).
- **Erreurs.** Une fonction de calcul ne jette jamais : elle rend `null`, `0`, ou
  un objet marqué `insufficient: true`.
- **Arrondis.** `round2()` de `core/time.ts`, jamais de `toFixed` dans un calcul.
- **Tests.** Un fichier `X.test.ts` à côté de `X.ts`, exécuté par
  `node --test --experimental-strip-types`.

## Contrat de nommage des fonctions du domaine

```ts
// duration.ts
reconstructStatusSpans(history: HistoryEntry[], createdAt: string, resolvedAt: string | null): StatusSpan[]
activeDays(spans: StatusSpan[], category: StatusCategory): number
approximateDays(fact: IssueFact): number   // création → résolution, marqué « approximé »

// zones.ts
zonesForIssue(fact: IssueFact, settings: ProjectSettings): string[]
splitAcrossZones(costJp: number, zones: string[]): Array<{ zone: string; costJp: number }>

// baseline.ts
sizeClassOf(fact: IssueFact, settings: ProjectSettings): SizeClass
computeBaselines(facts: IssueFact[], spansByIssue: Map<string, StatusSpan[]>, settings: ProjectSettings, now: string): Map<string, Baseline>
baselineKey(issueType: string, size: SizeClass): string

// families/*.ts
c1Incidents(facts: IssueFact[], ctx: CostContext): Evidence[]
c2Bugs(facts: IssueFact[], ctx: CostContext): Evidence[]
c3Slowness(facts: IssueFact[], ctx: CostContext): Evidence[]
c4Rework(facts: IssueFact[], ctx: CostContext): Evidence[]
c5Delay(facts: IssueFact[], ctx: CostContext): Evidence[]
collectEvidence(facts: IssueFact[], ctx: CostContext): Evidence[]   // families/index.ts

// attribution.ts
attributeEvidence(evidence: Evidence[], debts: IssueFact[], scores: RelevanceScore[], rejections: Rejection[], settings: ProjectSettings): Attribution[]

// bill.ts
buildBill(debt: IssueFact, evidence: Evidence[], attributions: Attribution[], ctx: CostContext): DebtBill

// ranking.ts
rankDebts(bills: DebtBill[], debts: IssueFact[]): RankedDebt[]

// phantom.ts
findPhantomDebt(zoneCosts: ZoneCost[], debts: IssueFact[], evidence: Evidence[], settings: ProjectSettings): PhantomDebt[]

// dead.ts
findDeadDebt(debts: IssueFact[], evidence: Evidence[], attributions: Attribution[], settings: ProjectSettings, now: string): DeadDebt[]

// payback.ts
payback(billLowJp: number, repaymentJp: number | null, settings: ProjectSettings): { avoidableJp: number | null; roiLow: number | null; roiHigh: number | null; paybackDays: number | null }

// repayment.ts
buildRepayment(debt: IssueFact, zoneWeekly: Array<{ week: string; costJp: number }>, closedAt: string, workStartAt: string): Repayment

// quality.ts
computeQuality(facts: IssueFact[], evidence: Evidence[], settings: ProjectSettings): DataQuality
```

## Budget CI

Chaque job GitHub Actions déclare `timeout-minutes: 5` au plus (règle user
2026-10-24). Le check `ci-budget` est exigé par la file Mergify.

## Schéma des flux (§15)

```
Jira (le site)                  App Forge — aucune sortie réseau
──────────────                  ─────────────────────────────────────────────
tickets, liens ──trigger──────▶ jobs/ ──▶ platform/jira.ts ──▶ Forge SQL
historique     ──consumer─────▶ (lots de 50, 900 s)               │
                                scheduledTrigger (chaque nuit)    ▼
                                                          core/ : calculs purs
                                                                  │
écrans ───────────────────────▶ resolvers/ ◀── résultats enregistrés (lecture)
Rovo, MCP ────────────────────▶ mcp/       ◀── mêmes chiffres que les écrans
Teamwork Graph ◀── lecture au nom de l'utilisateur, à l'ouverture des écrans
```

1. **Initialisation** (DT-12). À l'installation, 180 jours de tickets sont lus
   par lots de 50 avec leur historique ; chaque lot est un message de file
   traité par le `consumer`, qui enregistre les durées par statut. La barre de
   progression lit `BootstrapProgress`.
2. **Au fil de l'eau**. `avi:jira:updated:issue` et les événements de lien
   mettent à jour les `status_span` du ticket et marquent sa zone « à
   recalculer ». Aucun calcul de coût n'est fait dans le trigger : il est trop
   court.
3. **Chaque nuit**. `scheduledTrigger` recalcule preuves, attributions,
   additions et classement, écrit le champ sur les tickets de dette et prend
   l'instantané hebdomadaire (`zone_week`) qui sert aux tendances et au bulletin
   de remboursement.
4. **À la demande**. Les écrans et les outils MCP lisent les résultats
   enregistrés, jamais un calcul à la volée : c'est ce qui tient la promesse
   « page projet en moins de 2 s » (§18).

## Teamwork Graph

- L'app **consomme** le graphe ; elle ne fournit pas de connecteur — c'est
  l'un ou l'autre, pas les deux (§17).
- L'API ne s'appelle **qu'au nom d'un utilisateur** : les lectures ont donc lieu
  à l'ouverture des écrans, avec cache. Le calcul nocturne s'en passe et utilise
  l'API REST de Jira.
- Un **scope par type d'objet** est accordé par un administrateur
  d'organisation. Un scope manquant rend des résultats vides **sans erreur** :
  un écran vide n'est jamais une preuve d'absence, et l'interface doit le dire.
- Relations utilisées : ticket → composant Compass, équipe → composant Compass,
  incident JSM → service, incident JSM → ticket, utilisateur → PR relues.
- **PR** : une app installée sur Jira ne peut pas appeler l'API Bitbucket. La
  lenteur des PR est approchée par le temps en statut de revue et par les PR
  visibles dans le graphe ; la mesure fine (taille, allers-retours, délai de
  première revue) demande une seconde app côté Bitbucket et reste dans la
  vision (§15).

## Limites de la plateforme et conséquences de conception (§17)

| Limite | Valeur | Ce que ça impose |
|---|---|---|
| Stockage Forge SQL | 1 Gio par installation | on ne garde pas les tickets bruts : `issue_fact`, `status_span` et des agrégats ; purge par fenêtre |
| `SELECT` | 5 s | requêtes courtes et indexées ; pas de jointure longue à l'affichage |
| Clés étrangères | absentes | intégrité assurée par le code ; suppressions en cascade applicatives |
| Instructions | une requête par instruction | pas de lot multi-`INSERT` ; boucles bornées, écriture par paquets |
| Invocation | 900 s | initialisation découpée en lots de 50, reprise idempotente, progression visible |
| Charge utile | 5 Mo | pages de 50 tickets, jamais un projet entier |
| LLM | Claude, texte seul, 100 req/min et 500 000 jetons/min | scores de pertinence mis en cache par empreinte de texte ; rapprochements calculés la nuit, pas à l'ouverture d'un écran |
| Affichage | page projet < 2 s (§18) | les écrans lisent des résultats enregistrés (`debt_bill`, `zone_week`) |

## État de l'implémentation au 11 novembre 2026

Le domaine pur est écrit et tient en 1 850 lignes, sans un seul import
`@forge/*` :

| Fichier | Lignes |
|---|---|
| `core/types.ts` | 336 |
| `core/attribution.ts` | 289 |
| `core/families/c1.ts` | 153 |
| `core/baseline.ts` | 138 |
| `core/families/c2.ts` | 135 |
| `core/families/c5.ts` | 125 |
| `core/duration.ts` | 119 |
| `core/time.ts` | 118 |
| `core/families/c4.ts` | 107 |
| `core/dead.ts` | 98 |
| `core/phantom.ts` | 92 |
| `core/zones.ts` | 76 |
| `core/settings.ts` | 64 |

Absents à cette date : `src/platform/`, `src/jobs/`, `src/resolvers/`,
`src/ui/`, `src/mcp/`, `src/sample/`, ainsi que `core/bill.ts`,
`core/ranking.ts`, `core/payback.ts`, `core/repayment.ts`, `core/quality.ts`,
`core/units.ts`, `core/privacy.ts`, `core/families/c3.ts` et
`core/families/index.ts`. Les six validations de la semaine 1 sont décrites,
avec leur repli, dans `docs/VALIDATIONS.md`.

Aucun fichier `*.test.ts` n'existe encore : la convention de test est fixée
ci-dessus, la suite est à écrire avec les modules manquants.
