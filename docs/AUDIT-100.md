# Audit — 100 manques à combler avant le 22 décembre

> Consolidation de dix audits parallèles menés le 11 novembre 2026 sur le code
> réel (un par périmètre : exigences §12, parcours §7 et écrans §14, cas limites
> §19 et principes §5, recette §20 et §22, couche plateforme, jobs et cycle de
> vie, UI et i18n, Rovo/MCP, sécurité et Marketplace, soumission).
> Chaque ligne est ancrée : un fichier, une fonction, ou un paragraphe du cahier
> des charges. Effort : **S** < 1 h, **M** ≈ une demi-journée, **L** > une journée.
>
> Ce qui est déjà vert n'est pas répété ici : domaine pur testé (206 assertions),
> `forge lint`/`build`/`deploy`/`install` en development **et** production,
> bootstrap et recalcul mesurés sur le site de démo, les 8 outils MCP exercés,
> champ calculé écrit et triable en JQL, MCP et panneau identiques.

## A. Chiffres faux sur données réelles (14)

1. **[M] C1 vaut 0 j-p sur tout incident sans temps saisi** — `src/platform/jira.ts:toIssueFact` code `participants: 0` en dur et `fetchComments` n'a aucun appelant ; `src/core/families/c1.ts:incidentCost` fait `durée × min(participants, 6)` = 0. La famille la plus visible du §7.1 (« 4 incidents, 11 j-p ») ne fonctionne que sur le jeu d'exemple, qui injecte ses propres participants.
2. **[S] Bonus post-mortem jamais appliqué** — `toIssueFact` code `hasPostMortem: false` ; les 0,5 j-p du §9 C1 ne tombent jamais sur données réelles.
3. **[M] `affectedServices` toujours vide** — le mode de zone `service` (§8 priorité 3) retombe silencieusement sur les composants Jira ; `fetchIncidentServices` n'est appelé que par la sonde de diagnostic.
4. **[M] `visible` toujours vrai, donc aucun masquage** — `hiddenCount` reste à 0 (`src/resolvers/billView.ts`) : le §18 « éléments masqués » n'existe pas, les preuves de projets interdits au lecteur seraient affichées.
5. **[M] Règle de dette « jql » inerte (DT-01)** — `isDebtIssue` exige `debtJqlMatch === true`, que personne ne pose jamais ; un projet configuré en JQL obtient zéro dette, sans avertissement.
6. **[M] Dettes ouvertes anciennes exclues du recalcul** — `gatherInput` ne charge que la fenêtre de 90 jours ; le héros du §7.1 (« ticket oublié depuis un an ») n'a ni addition ni champ rafraîchi.
7. **[M] Points → jours jamais converti (DT-15)** — `pointsToDays` et `velocityFromClosedIssues` n'ont aucun appelant, seul `timeoriginalestimate` est lu ; toute dette estimée en story points tombe en « remboursement non chiffré », donc pas de ROI ni de délai de retour.
8. **[S] `teamByZone` non saisissable** — absent de `patchFromForm` et des écrans de réglages : le « coût par équipe » du gadget (DT-18) est structurellement vide hors jeu d'exemple.
9. **[M] `jsmProjectKeys` jamais consommé** — `gatherInput` ne lit que le projet courant : les incidents JSM d'autres projets (C1) et les blocages (C5) n'entrent jamais dans le calcul.
10. **[S] Un score modèle ≥ 0,995 est promu « lien explicite »** — `attribution.ts:strongAttributions` arrondit à 1 puis classe en `basis: 'link'` : une hypothèse du modèle entre dans la fourchette **basse**, contrairement au principe 2 du §5.
11. **[S] Justification « Lien Jira explicite » fabriquée** — `implicitLinkRationale` invente un lien quand le `rationale` du modèle est vide : la méthode affichée est fausse (principe 1).
12. **[S] `buildBill` ne plafonne pas la somme des parts d'une preuve** — deux lignes en base (confirmed + inferred) donnent `highJp = 1,5 × coût` sans signal : le principe 3 (« pas de double compte ») n'est pas garanti à la lecture.
13. **[M] C5 inversé** — `blockedPairs` fait partir le délai de la **résolution** de la dette bloquante : dette ouverte + ticket bloqué → retard 0. Le retard induit n'apparaît qu'après remboursement, à l'inverse de son usage (§9 C5).
14. **[S] C4 « PR refusées » absent** — aucune requête PR dans `graph.ts` ; la seconde moitié du §9 C4 n'existe pas (le repli « statut de revue » n'est pas documenté comme tel dans le code).

## B. Décisions humaines et cycle de vie des données (13)

15. **[S] Confirmer ou rejeter détruit les attributions par lien** — `decisions.ts:rebuild` passe `links: []` et `scoresOf` ne rejoue que les parts `inferred` ; `replaceAttributions` écrase tout. Un clic §7.4 effondre la fourchette basse au-delà de la preuve confirmée. La recette §20 n°1 est cassée par la n°3, dans l'ordre où `docs/JUGES.md` les fait tester.
16. **[S] Le recalcul nocturne efface le jeu d'exemple** — aucune garde `settings.demoData` dans `recalcProject` ; les identifiants synthétiques donnent des liens vides, les scores `SAMPLE_SCORE_RULES` sont rescorés, et `writeFields` PUT des coûts fictifs sur des clés `PAY-*` si elles existent sur le site. Les chiffres du §7.1 ne survivent pas à une nuit.
17. **[S] Dette rouverte : bulletin non retiré** — `publishProject` filtre `closedAt !== null`, donc une dette rouverte sort du lot : son bulletin reste affiché avec des chiffres périmés (§19 cas 8).
18. **[S] `mergeMonthlyRepayments` jamais branché** — écrite et testée, aucun appelant : deux dettes closes sur la même zone le même mois produisent deux bulletins, ce que le §19 cas 9 interdit.
19. **[M] Le bulletin n'est jamais publié sur le ticket** — §7.5 promet « un commentaire est publié » ; aucun POST commentaire n'existe dans le code. La séquence vidéo 3:10–3:40 est injouable.
20. **[M] L'invalidation « zone à recalculer » est écrite pour rien** — `listInvalid` n'a aucun appelant et `clearInvalid` efface tout sans filtre : une modification survenue **pendant** le recalcul perd sa marque et n'est jamais recalculée (§15 flux 2).
21. **[M] Aucun trigger sur worklog ni commentaire** — le temps saisi (C1/C2 en mode `logged`) et le décompte d'intervenants restent figés jusqu'à la nuit.
22. **[M] Ticket supprimé jamais traité** — pas de `avi:jira:deleted:issue`, aucun DELETE dans les repos : le ticket continue de produire preuves, zones et additions.
23. **[M] Ticket déplacé vers un projet sans réglages** — le trigger rend `{ok:false}` sans exception, donc **Forge ne rejoue pas** : la mise à jour est perdue en silence, et l'ancien projet garde les preuves d'un ticket qu'il ne possède plus.
24. **[L] Zones = noms, pas identifiants** — `IssueFact.zones` et `Evidence.zone` sont des chaînes issues de `component.name` : un renommage scinde l'historique en deux zones, une fusion mélange deux historiques (§19 cas 10). `zone_week` n'est jamais purgé des zones disparues.
25. **[M] Progression d'initialisation fausse après échec** — `advance` cumule `done` (non idempotent), `ingest` avale les erreurs par ticket, `enqueueNext` est poussé après `advance` : un rejeu double-compte et double-enfile (DT-12, §24 « reprise sur erreur »).
26. **[M] Consumer sans garde-fou** — `retryLater()` rejoue indéfiniment un lot en échec permanent ; `BootstrapProgress` n'a pas de champ d'erreur ni de dead-letter.
27. **[S] Changer les réglages ne déclenche rien** — `saveSettings` n'invalide ni ne recalcule : après un changement de règle de dette ou de mode de zone, les chiffres affichés restent ceux de l'ancien réglage jusqu'à la nuit.

## C. Performance, quotas et échelle (17)

28. **[M] Liens Jira en N+1 sériel, plafond destructif** — `linksOf` fait jusqu'à 300 GET un par un ; au-delà, le commentaire promet « les attributions de la veille » alors que `replaceAttributions` les a supprimées.
29. **[M] Écriture du champ : un PUT par ticket** — `putValue` dans une boucle ; 5 000 dettes = 5 000 requêtes sérialisées dans le budget de 15 min.
30. **[M] Scores LLM repayés chaque nuit** — `scoreCandidates(…, new Map())` : le cache d'empreintes ne survit pas à l'invocation, alors que le §18 exige « recalculés seulement si un texte change ». Jusqu'à 300 appels par projet et par nuit, en série.
31. **[M] Aucun garde de débit LLM** — rien ne respecte les 100 requêtes/min et 500 000 jetons/min du §17 ; `nightlyRecalc` boucle sur tous les projets sans budget global.
32. **[M] Zéro gestion du 429 côté Jira** — `jiraGetJson`/`jiraSendJson` journalisent puis rendent `null` : pas de `Retry-After`, pas de backoff, pas de second essai. Des trous silencieux dans les données.
33. **[M] SELECT nocturnes non bornés** — `listIssuesInWindow` fait un `SELECT *` (dont `description` MEDIUMTEXT) avec un prédicat `OR` non sargable ; `listStatusSpans` joint **tous** les tickets du projet, hors fenêtre comprise. Risque réel sur la limite de 5 s par SELECT (§17).
34. **[M] Nuit monolithique** — tous les projets en série dans un seul `scheduledTrigger` à 900 s : coupe nette possible au milieu de `persist()`, sans point de reprise. La file (`consumer`) existe déjà, elle n'est pas utilisée pour ça.
35. **[M] `persist` non atomique** — `DELETE FROM evidence WHERE project_id=?` puis INSERT par paquets de 200 : un échec au paquet 12/25 laisse le projet **sans aucune preuve** jusqu'au lendemain, et des additions qui référencent des preuves absentes.
36. **[S] `upsertBill` en N+1 SQL** — un INSERT par addition avec une sous-requête `projectOfIssue` par ligne, alors que `insertRows` groupé existe et que le `projectId` est connu ; si le ticket est absent d'`issue_fact`, la sous-requête rend NULL et l'addition est perdue sans erreur.
37. **[L] Aucune purge → plafond de 1 Gio** — `issue_fact` (avec descriptions), `status_span`, `rejection` et surtout `zone_week` (un instantané par zone et par semaine, à vie) ne sont jamais purgés. §17 : 1 Gio par installation en production.
38. **[M] Page projet : quatre charges complètes à l'ouverture** — `ProjectTabs` rend tous les `TabPanel`, et PhantomTab/DeadTab/RepaymentTab refont chacun `loadState` (les 6 mêmes tables déjà lues par `getProjectPage`). La promesse « moins de 2 s » (§18) ne tient pas à 5 000 tickets.
39. **[S] Champ personnalisé : tout l'état du projet pour une ligne** — `custom-field.tsx` → `getDebtBill` → `loadState` (6 lectures SQL plein projet + toutes les preuves) à chaque ticket ouvert.
40. **[S] Gadget : `getProjectPage` complet puis `slice(0,5)`** — aucun resolver réduit pour trois petits tableaux.
41. **[S] Changelog tronqué à 40 pages sans marqueur** — au-delà de 4 000 entrées, les durées sont calculées sur un historique partiel et **écrites en base** comme si elles étaient complètes ; seul un log le dit. Les tickets les plus actifs sont les plus faux.
42. **[S] Comparaison flottante stricte avant écriture du champ** — `current.get(key) === target` sans arrondi : la moindre dérive de représentation fait réécrire tous les tickets chaque nuit (300 PUT + 300 triggers en cascade, item 21).
43. **[M] Cache Teamwork Graph partagé entre utilisateurs, sans TTL, empoisonné par les échecs** — les Maps module de `graph.ts` stockent des résultats obtenus `asUser()` sans clé utilisateur ni expiration, et remplissent `[]` pour les clés manquantes **avant** de lire la réponse : un 429 ou un scope manquant est caché vide pour la vie du conteneur. Fuite de zones d'un utilisateur à l'autre (§18) et scope manquant indétectable (§17).
44. **[S] `MAX_SCORED_PAIRS = 300` tronque en ordre de tri** — les dernières preuves d'un gros projet ne sont jamais scorées, sans aucun signal dans l'onglet Méthode.

## D. Écrans et parcours (23)

45. **[S] L'UI ignore les échecs des resolvers** — `ui/api.ts:unwrap` ne teste que `body`, jamais `ok:false` : sur un projet non configuré, `getProjectPage` rend `{ok:false,error}`, l'UI le prend pour un `ProjectPageData` et lève un TypeError sur `data.settings.demoData`. Écran blanc au lieu du bandeau d'erreur. `SampleDataButton` affiche « Terminé » même quand l'injection est refusée.
46. **[M] Aucune UI d'initialisation ni barre de progression (DT-12)** — `startBootstrap` et `bootstrapProgress` sont enregistrés côté resolver mais absents de `ui/api.ts` ; `grep bootstrap src/ui` = 0. L'assistant en trois étapes du §22 (données réelles) n'existe que par le webtrigger d'exploitation : **un juge ne peut pas initialiser son site depuis l'app**.
47. **[S] Pas de bouton « Load sample data » sur l'état vide du classement** — `SampleDataButton` n'est monté que dans la page de réglages, alors que `docs/JUGES.md` Step 1 annonce le bouton sur l'état vide. Le juge qui suit le guide à la lettre reste bloqué.
48. **[S] Retrait du jeu d'exemple inaccessible depuis un écran** — `clearSampleData` n'est pas dans `ResolverKey` ; le bandeau « données d'exemple » reste à vie.
49. **[M] Le gadget ne charge jamais** — `readContext` ne lit que `extension.project`, or le contexte d'un `jira:dashboardGadget` ne fournit pas de projet : `useResolver('')` reste en chargement pour toujours. DT-18 injouable là où les juges l'ajouteront.
50. **[M] Aucun ticket n'est cliquable nulle part** — `kit.tsx` n'exporte pas `Link` ; `EvidenceList`, `RankingTable`, `DeadTab`, `RepaymentTab`, `PhantomTab` rendent les clés en `<Text>` ; `context.siteUrl` est lu mais jamais utilisé. DT-06 « preuves cliquables », §7.1 étape 5 et la recette §20 n°6 sont impossibles.
51. **[M] Dette fantôme : le ticket est créé sans relecture** — `resolvers/draft.ts` POSTe `/rest/api/3/issue` dans la même invocation que la rédaction, sans composant ni étiquette (donc hors zone au sens du §8 et hors de la règle de dette par défaut). Le §7.2 (« relit, corrige, crée ») n'est pas tenu, et le ticket créé ne capte aucune preuve. L'outil MCP, lui, rend le texte sans créer : deux comportements divergents.
52. **[S] Encart sur bug : pas de rechargement, coût affiché sans sens** — `ProposalBlock.act` ne recharge rien (la proposition et ses boutons restent à l'écran après confirmation) et `ctx.cost` affiche l'addition d'un ticket qui n'est pas une dette (toujours 0–0).
53. **[S] « {key} » littéral après confirmation** — `t(locale, 'ctx.confirmed')` sans variables alors que la clé contient `{key}`.
54. **[S] Textes français codés en dur en UI anglaise** — les formules (`core/families/c1.ts:formulaOf`), les limites du bulletin (`core/repayment.ts`) et « équipe non renseignée » (`resolvers/aggregate.ts`) bypassent `t()` : la soumission est en anglais (§18).
55. **[M] Onglet Zones : des chiffres sans chemin vers les preuves** — `ZoneFamilies` affiche des sous-totaux nus, `PhantomRow` affiche `totalJp` alors que `byFamily` et `topEvidenceIds` existent dans le type, `ReturnBlock` affiche ROI et délai sans formule. Viole le principe 1 et le §18 « deux clics ».
56. **[S] « Données insuffisantes » non propagé dans les zones** — `ZoneCost.byFamily` n'a pas de drapeau : une zone à moins de 5 références affiche « 0 j-p » au lieu du badge, exactement sur l'écran que `docs/JUGES.md` indique pour la recette §20 n°7.
57. **[S] Parts d'attribution invisibles** — `Attribution.share` n'est exposé par aucun resolver ni composant : la recette §20 n°2 (« la somme des parts ne dépasse pas 100 % ») n'est vérifiable qu'en lisant la table.
58. **[S] Bandeau « données d'exemple » absent de deux écrans** — ni `issue-panel.tsx` (il ne l'obtient que via `BillSummary`) ni `custom-field.tsx` (un seul mot court) ; il devrait être posé une fois dans `ScreenShell`, sinon il disparaît dès qu'un écran tombe en erreur.
59. **[S] Réglages : « Enregistré » menteur** — une saisie non numérique devient NaN, `mergeSettings` garde l'ancienne valeur en silence, et le bandeau de succès s'affiche quand même ; le bouton n'est pas désactivé pendant l'envoi.
60. **[S] `Form` de la façade sans sémantique de formulaire** — `Stack` + `Button onClick` au lieu du composant `Form` natif : pas de soumission par Entrée, pas de regroupement aria.
61. **[S] Huit tableaux sans légende accessible** — `DynamicTable` monté sans `caption` ni `label` alors que les props existent.
62. **[S] Chargement éternel sans ticket** — `issue-context.tsx` et `custom-field.tsx` restent en `status:'loading'` pour toujours quand `issueId` est absent, alors que `issue-panel.tsx` affiche `ErrorState` dans le même cas.
63. **[S] Clé d'une preuve masquée quand même** — `MatchList` masque `sourceSummary` mais affiche toujours `sourceKey` : le lecteur tranche un rapprochement sur un ticket d'un projet qu'il ne peut pas ouvrir (§18 Droits).
64. **[S] Dix clés i18n mortes** — dont `ctx.openDebt`, `gadget.open`, `field.insufficient`, `phantom.col.families` : quatre signalent des fonctionnalités non câblées.
65. **[M] DT-20 (euros) non câblé** — `dayRateEur` existe en base et `jpToEuros` est testée, mais aucun réglage ne permet de le saisir et aucun écran n'affiche d'euros.
66. **[L] DT-21 (simulation) absente** — zéro occurrence de « simulation » dans `src/` ; « si on rembourse ces trois dettes, combien de capacité revient ? » n'a aucune réponse.
67. **[S] `getZoneCosts` ne propose pas les zones valides** — l'erreur « zone inconnue » ne liste pas les zones existantes et aucun outil ne les énumère : l'agent de code du §13 doit deviner le nom exact.

## E. Rovo et MCP (10)

68. **[M] DT-17 argumentaire : code mort** — `writeArgumentaire`/`draftArgumentaire` n'ont aucun appelant : ni 9e action MCP, ni resolver, ni bouton. L'amorce « Prépare l'argumentaire pour PAY-77 » est affichée mais injouable, et la séquence vidéo 3:40–4:20 repose dessus.
69. **[M] Le prompt servi n'est pas celui qui est testé** — `rovo:agent.prompt` du manifest est un texte statique en français, « 90 jours » en dur, sans les règles C5/causalité/données insuffisantes ; `agentPrompt()` (bilingue, complet) n'est branché sur rien. La soumission est en anglais.
70. **[S] `confirm-evidence` dans MCP mais pas dans l'agent, sans décision écrite** — asymétrie peut-être voulue, mais `agent.ts` et son test exigent les 8 actions : un juge qui compare y voit une incohérence.
71. **[S] Entrée `by` lue mais non déclarée** — `confirmEvidence` lit `payload.by` alors que le manifest ne déclare que `evidenceKey`/`debtKey`/`confirmed` : tout retombe sur `'rovo'`, et n'importe quel appelant peut attribuer la décision à un tiers.
72. **[S] `optionalNumber` avale les entrées fausses** — `limit: true` devient 1, `limit: 100000` devient 50, sans aucun écho : l'agent reçoit autre chose que ce qu'il a demandé.
73. **[S] `requireBoolean` renvoie un message trompeur** — `confirmed: "true"` (chaîne, cas classique d'un LLM) rend « paramètre requis » alors qu'il est fourni : boucle d'échec sur la seule action UPDATE.
74. **[S] Ambiguïté silencieuse sur `evidenceFor`** — le repli par `sourceKey` prend le premier homonyme sans avertir, sur une action qui **écrit**.
75. **[S] Amorces 1 et 3 sans contexte projet** — « Quelle dette nous coûte le plus ? » exige `projectKey` que rien ne fournit (pas d'outil `list-projects`) : les deux premières amorces du §13 aboutissent à une erreur.
76. **[M] Zéro test unitaire des 8 actions** — seul `agent.test.ts` existe ; rien ne couvre les paramètres manquants, les enveloppes d'erreur, le clamp de limite, ni la cohérence handlers ↔ `ACTIONS`.
77. **[S] Cohérence manifest ↔ code non contrôlée** — `tools/validate_manifest.mjs` ne compare que `rovo:mcp` aux clés d'actions ; rien ne vérifie `ACTIONS` de `src/mcp/index.ts` contre le YAML (dont le commentaire affirme à tort qu'il est la source unique).

## F. Tests et CI (7)

78. **[L] Aucun double de Forge SQL** — `query.ts` importe `@forge/sql` directement, sans injection : toute la couche resolvers/jobs/UI est non testable. C'est le chantier qui débloque les recettes §20 n°3, 6, 9 et tout le §22.
79. **[M] Zéro test sur six modules entiers** — `src/resolvers/`, `src/jobs/`, `src/ui/`, `src/mcp/actions.ts`, `src/platform/field.ts`, `src/platform/llm.ts`.
80. **[S] Recettes §20 n°6, 8, 9 non automatisées** — vérifiées à la main sur le site de démo le 11/11, mais rien ne les protège d'une régression.
81. **[M] `forge lint` et `forge build` absents de la CI** — ils exigent un login Atlassian ; une régression de manifest (module UI sans `render: native`, action sans fonction) passerait la CI et n'échouerait qu'au déploiement manuel.
82. **[S] Cohérence manifest ↔ exports non vérifiée en CI** — les 19 fonctions déclarées correspondent aujourd'hui aux exports de `src/index.tsx` (vérifié à la main le 11/11), mais rien ne le garantit.
83. **[S] Aucune mesure de couverture** — 206 assertions, mais aucune visibilité sur les branches non couvertes du domaine.
84. **[S] Actions GitHub épinglées par tag, pas par SHA** — `actions/checkout@v4`, `actions/setup-node@v4`, `actions/cache@v4` : reproductibilité et sécurité moindres sur un dépôt public.

## G. Sécurité, vie privée, Marketplace (13)

85. **[S] Webtriggers d'exploitation sans authentification** — `laddition-smoke` et `laddition-ops` exposent sans aucun contrôle `init`, `bootstrap`, `recalc-all`, `sample`, `clear-sample` et `mcp` (qui écrit une confirmation) : quiconque obtient l'URL peut effacer ou réinjecter les données, réécrire les réglages, lancer des recalculs avec scoring LLM. **Bloquant pour la revue Marketplace.**
86. **[S] Exfiltration de données de projet sans authentification** — `?action=report&project=X` rend classement, additions et bulletins de n'importe quel projet du site, hors du contrôle d'accès Jira ; `?action=init&project=X` suivi de `bootstrap` fait indexer 180 jours d'historique de n'importe quel projet.
87. **[S] Injection JQL par le paramètre `project`** — `smoke.ts` interpole la valeur brute (simplement trimée et mise en majuscules) dans `project = ${projectKey}` exécuté `asApp` : oracle JQL sur tout le site. Corriger par une validation `^[A-Z][A-Z0-9_]+$` et un guillemet.
88. **[S] `accountId` brut persisté et affiché** — `decide.ts:actorOf` stocke l'accountId complet dans `by`, puis le rationale « Rapprochement confirmé par 5b1f8c… » est persisté et rendu au panneau comme au MCP, sans `redactName`. Donnée personnelle exposée sans contrôle de visibilité (§18).
89. **[S] `privacy.ts` est du code mort** — `assertNoPersonRanking`, `maskHidden`, `redactName` ne sont appelés que par leur propre test. La recette §20 n°10 ne tient que par l'absence actuelle d'une colonne `assignee` : l'ajout d'un `assigneeTotal` passerait la CI.
90. **[M] Scope `read:jira-user` déclaré mais inutilisé** — aucun appel `/rest/api/3/user`, `fetchComments` sans appelant : le scope n'est justifié par aucun code (rejet au titre du moindre privilège) **et** il signale que C1 est cassé (item 1).
91. **[S] Justification de `write:jira-work` fausse dans `docs/MARKETPLACE.md`** — le texte promet la publication du bulletin en commentaire, qui n'existe pas (item 19). Les reviewers vérifient les déclarations de scopes.
92. **[S] Scope `storage:app` déclaré « réservé » sans aucun usage** — aucun import `@forge/storage` ; à retirer ou à justifier.
93. **[M] Les trois scopes `read:graph:*` ne servent qu'à la sonde** — appelés hors contexte utilisateur, ils ne rendent rien ; les modes `compass` et `service` retombent silencieusement sur les composants Jira. Scopes injustifiables en l'état et bonus Teamwork Graph non démontré.
94. **[S] Pas de fichier LICENSE** — `package.json` déclare MIT, le dépôt public n'a aucun fichier LICENSE : par défaut, tous droits réservés.
95. **[S] Conformité Marketplace incomplète** — aucune URL de politique de confidentialité (obligatoire pour une app qui lit historiques et commentaires et stocke des accountId), pas de conditions d'utilisation, support limité à « issues on the public repository ».
96. **[S] Infrastructure révélée dans un dépôt public** — `docs/NOTES-DE-SOUMISSION.md` et `docs/VALIDATIONS.md` publient le nom du site de démo, l'identifiant d'app, l'URL de la console, les identifiants d'installation et l'id du champ personnalisé ; combinés aux clés de webtrigger du manifest, c'est la surface d'attaque complète.
97. **[S] Version incohérente** — `docs/MARKETPLACE.md` annonce 1.0.0, `package.json` est à 0.1.0, aucun tag git.

## H. Soumission et démonstration (3)

98. **[L] Les six écrans n'ont jamais été ouverts dans un navigateur** — c'est le premier jalon qui peut faire rater le gel du 15 décembre : une erreur runtime UI Kit 2 découverte tard coûte la soumission. Le code, lui, a cinq semaines d'avance sur le plan du §23.
99. **[L] Zéro preuve visuelle** — aucune capture, aucun GIF, aucun diagramme d'architecture dans le dépôt : il manque les 12 captures de `docs/MARKETPLACE.md`, la galerie Devpost, le hero shot du README et le schéma demandé par `docs/VIDEO.md`.
100. **[S] Chiffres contradictoires d'un document à l'autre** — bulletin « 3,4 → 0,6 » (`DEVPOST.md`, `MARKETPLACE.md`) contre « 2,6 → 0,7 » (`VIDEO.md`, `JUGES.md`, §7.5) ; « 60 preuves » (`README`, `JUGES`) contre 65 mesurées ; « 3 dettes » contre 10 injectées ; `README` et `VALIDATIONS.md` encore périmés (« src/platform n'existe pas encore », « aucun des six points prototypé »). Le risque §24 « chiffres contestés donc ignorés » s'applique d'abord à nos propres documents.

---

## Les 10 à faire en premier

| # | Item | Pourquoi celui-là | Effort |
|---|---|---|---|
| 1 | **3 + 45** — Gérer `{ok:false}` côté UI | Premier contact du juge : aujourd'hui, ouvrir L'addition sur un projet non configuré donne un écran blanc, pas un état vide avec un bouton | S |
| 2 | **85 + 86 + 87** — Sécuriser ou retirer les webtriggers | Bloquant pour la revue de sécurité Marketplace ; écriture et lecture de données sans authentification | S |
| 3 | **1 + 2 + 90** — Renseigner `participants` (et `hasPostMortem`) ou neutraliser C1 | La famille « incidents » affiche 0 j-p sur tout site réel : le cœur du récit §7.1 est faux hors jeu d'exemple | M |
| 4 | **46** — Assistant d'initialisation + barre de progression (DT-12) | Sans lui, le parcours « données réelles du site » (§22) est impossible depuis l'app : les juges dépendent d'une URL d'exploitation | M |
| 5 | **15** — Rejouer les liens dans `rebuild` | Un clic sur « Confirmer » détruit les attributions par lien : la démo §7.4 casse la recette §20 n°1 | S |
| 6 | **16** — Garde `demoData` sur le recalcul nocturne | Les chiffres du §7.1 ne survivent pas à une nuit ; la démo des juges devient fausse sans que personne ne touche rien | S |
| 7 | **6** — Inclure les dettes ouvertes anciennes | Le héros du scénario (« oublié depuis un an ») n'existe pas dans le recalcul réel | M |
| 8 | **50** — Rendre les tickets cliquables | Le principe 1 (« tout chiffre a sa méthode à portée de clic ») et la recette §20 n°6 sont la promesse centrale du produit | M |
| 9 | **68 + 69** — Exposer l'argumentaire et aligner le prompt de l'agent | Deux bonus de soumission (Rovo, MCP) et la séquence vidéo 3:40 reposent sur du code mort et un prompt en français | M |
| 10 | **98 + 99** — Ouvrir les écrans, produire les captures | Seul moyen de découvrir une erreur runtime UI Kit 2 avant le gel du 15 décembre ; les juges regardent les images avant le code | L |

**Ordre conseillé** : 1 → 2 → 5 → 6 (quatre correctifs courts, tous bloquants pour la démo ou la soumission),
puis 3 → 4 → 7 → 8 → 9, et 10 en fil rouge dès que les écrans s'ouvrent.
Les items 94 (LICENSE), 100 (chiffres contradictoires) et 19 (bulletin en commentaire)
sont des S à glisser entre les deux premiers blocs.
