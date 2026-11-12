# Notes de soumission — Codegeist 2026

> Échéance : **mardi 22 décembre 2026, 21 h (Paris)**. Catégorie : Apps for Software Teams.
> Bonus visés : Teamwork Graph, Agents Rovo, MCP, Marketplace.

> **Dépôt public — aucune valeur sensible ici (item G96).** Dans les *docs*,
> le site de démonstration, les identifiants d'installation, l'id du champ
> personnalisé et les clés des tickets de test réels sont remplacés par des
> placeholders : `<APP_ID>`, `<DEMO_SITE>`, `<INSTALLATION_ID_DEV>`,
> `<INSTALLATION_ID_PROD>`, `<CUSTOM_FIELD_ID>`, `<OPS_WEBTRIGGER_URL>`,
> `<TICKET_A>`, `<TICKET_B>`, `<TICKET_C>`, `<TICKET_D>`. Où les retrouver :
> - `<APP_ID>` : console développeur
>   <https://developer.atlassian.com/console/myapps> (app « L'addition ») —
>   voir l'exception ci-dessous, la valeur réelle figure en tête de
>   `manifest.yml` ;
> - `<DEMO_SITE>` : `forge site list` sur le compte développeur ;
> - `<INSTALLATION_ID_DEV>` / `<INSTALLATION_ID_PROD>` :
>   `forge install --site <DEMO_SITE> --product jira -e development|production`
>   puis console de l'app, onglet *Installations* ;
> - `<CUSTOM_FIELD_ID>` : n'importe quel ticket du site → champ
>   « Coût de la dette (j-p / 90 j) » → *Where is my field?* / API REST ;
> - `<OPS_WEBTRIGGER_URL>` : `forge webtrigger create <DEMO_SITE> laddition-ops` ;
> - `<TICKET_A>` / `<TICKET_B>` : le couple dette/bug de test créé dans le
>   projet PAY du site de démo ; `<TICKET_C>` / `<TICKET_D>` : le couple
>   dette/bug du projet ENGS qui vérifie la recette §20 n° 1 (retrouvables par
>   leur résumé dans le Jira du site).
>
> **Exception vérifiée le 12/11/2026 : l'identifiant d'app, lui, est présent
> dans le dépôt avec sa valeur réelle.** La ligne 2 de `manifest.yml` porte
> l'ARI `ari:cloud:ecosystem::app/…` complet : `forge deploy` l'exige, le
> fichier ne peut pas être pseudonymisé sans casser la procédure de build
> documentée (`docs/JUGES.md`, « Install it on your own site »). L'affirmation
> précédente (« l'id […] n'est pas publié dans ce dépôt avec sa valeur réelle »)
> était fausse — elle est corrigée ici. Évaluation du risque : un ARI d'app
> n'est pas un secret d'authentification (il identifie l'app ; il figure dans
> les écrans d'administration des sites clients une fois l'app publiée) ; aucun
> jeton n'est committé (`LADDITION_OPS_TOKEN` est une variable d'app Forge,
> échec fermé). Le risque résiduel est l'identification immédiate de l'app et
> de son éditeur depuis le dépôt. Réécrire l'historique public pour autant est
> une décision du propriétaire — procédure et risques documentés ci-dessous,
> **réécriture non effectuée**.

## Ce qui est prêt

- [x] Arbre complet de l'app Forge (domaine pur, adaptateurs, jobs, écrans, agent Rovo, outils MCP).
- [x] `manifest.yml` valide contre le schéma Forge officiel (`node tools/validate_manifest.mjs`).
- [x] Typage strict sans erreur (`npx tsc --noEmit`), **206 tests** au vert (`npm test`).
- [x] Jeu d'exemple cohérent avec le §7.1 du cahier des charges (bouton « Load sample data »).
- [x] Documentation : `README.md`, `docs/JUGES.md` (parcours de test en 5 min),
      `docs/METHODE.md` (formules), `docs/VIDEO.md` (script de la vidéo),
      `docs/VALIDATIONS.md` (les six points à valider).
- [x] SOCLE CI : workers self-hosted, file Mergify, budget CI 5 min, couche 0,
      agent hermes de résolution de conflits.

## Enregistrement et déploiement — fait

- [x] `forge register` sur le compte Atlassian : app id `<APP_ID>` posé dans `manifest.yml`.
- [x] `forge lint` propre (No issues found) et `forge build` OK (tag `b88e1c7b`).
- [x] `forge deploy -e development` : déployé.
- [x] `forge site provision` : site de démo `https://<DEMO_SITE>` (actif jusqu'au 09/02/2027).
- [x] `forge install --demo-site --product jira -e development` : installé et à jour sur Jira.
- [ ] `forge eligibility` : **non éligible en l'état** (mesuré le 12/11, versions
      development 4.14.0 et production 3.1.0) — motif unique : « App is using a
      webtrigger module that can egress data ». L'éligibilité revient dès que les
      deux modules `webtrigger` sont retirés du manifeste (tâche ci-dessous). Les
      affirmations d'éligibilité dans `docs/MARKETPLACE.md`, `docs/DEVPOST.md`,
      `docs/PRIVACY.md` et `docs/TERMS.md` ont été corrigées le 12/11 en
      conséquence : aucune ne déclare plus le programme comme acquis.
- [x] Tickets de test réels créés dans le projet PAY du site : `<TICKET_A>` (dette « Supprimer le double système de calcul des taxes ») et `<TICKET_B>` (bug « Montant de TVA incohérent »).
- [x] **Déployé et installé en `production`** sur `<DEMO_SITE>`
      (installation `<INSTALLATION_ID_PROD>`, à jour), en plus de l'environnement
      `development` (`<INSTALLATION_ID_DEV>`). Console :
      `https://developer.atlassian.com/console/myapps/<APP_ID>`.
- [x] **12/11** : toutes les corrections de l'audit mergées (PR #24 à #73),
      redéployé en `development` (**4.14.0**) et `production` (**3.1.0**,
      `forge install --upgrade` : « Upgrade complete! »). Le passage en
      production a exigé `--approve MAJOR_VERSION_RULE` (scopes modifiés depuis
      le dernier déploiement prod) — une seule fois, les scopes ne bougent plus
      avant le gel.
- [x] **12/11** : jeton d'exploitation posé en variable d'app sur les deux
      environnements (`forge variables set LADDITION_OPS_TOKEN … -e <env>`).
      Vérifié en réel : 403 sans jeton, 200 avec. Piège corrigé au passage (PR
      #65) : Forge expose la variable sous `FORGE_USER_VAR_LADDITION_OPS_TOKEN`,
      le garde ne lisait que le nom nu et refusait donc tout sur site installé.
- [x] **12/11** : jeu d'exemple réinjecté sur le projet **PAY** en production
      (68 faits, 65 preuves, 5 zones) avec `dayRateEur = 650` et
      `storyPointField = customfield_10016` ; PAY-77 à 19–34 j-p, PAY-41 à 1–2 j-p,
      1 dette fantôme, 7 dettes mortes, 1 bulletin, équipes et trimestres
      renseignés. Les chiffres de `docs/JUGES.md` sont donc reproductibles tels
      quels sur le site.

## Les six validations du §17 — mesurées le 11/11 sur le runtime

- [x] **Les six validations mesurées sur le site réel** (sondes exécutables
      `?action=probe`, code dans `src/jobs/opsValidate.ts`, détail dans
      `docs/VALIDATIONS.md`) :

      | # | Point | Verdict mesuré le 11/11 |
      |---|---|---|
      | V1 | Débit de lecture des historiques | 200-250 ms/ticket, 0 échec → 17-21 min projetées pour 5 000 tickets : **au-dessus du budget de 15 min**, repli appliqué (fenêtre 90 j, lots de 50 dans la file) |
      | V2 | Écriture en masse du champ d'app | **validé** : `<CUSTOM_FIELD_ID>`, 10 écritures sur 10, triable et filtrable en JQL — aucun repli |
      | V3 | Données du site de démo | **confirmé pauvre** : 26 projets, PLAT 31 161 tickets dont 0 sur 180 jours, ITO 9 640 dont 7 498 incidents et 0 sur 180 jours → le jeu d'exemple est le chemin de démonstration |
      | V4 | Services affectés des incidents | graphe muet (0 sur 5) → **repli** : composant Jira de l'incident |
      | V5 | Dates des PR dans le graphe | graphe muet → **repli** : temps passé en statut de revue |
      | V6 | Compass depuis l'app Jira | graphe muet (0 composant, 0 équipe) → **repli** : composants Jira |

- [x] **Bug majeur trouvé par les sondes, corrigé et verrouillé** : le changelog
      paginé répond `values` et non `histories`. Sur un vrai site, toutes les
      durées par statut étaient vides et C2, C3, C4 retombaient silencieusement
      sur la durée approximée. Corrigé (`historyItemsOf`, les deux formes
      acceptées), 4 tests ajoutés. Avant : 0 entrée sur 35 tickets. Après : 9
      entrées de statut sur 20 tickets ITO.
- [x] **Bug d'intégration corrigé** : une confirmation faite par l'agent (MCP)
      n'était pas enregistrée comme décision et disparaissait au recalcul
      nocturne. Écran et agent passent désormais par le même module
      (`src/jobs/decisions.ts`).
- [x] Recette §20 vérifiée sur le runtime : n° 8 (le champ se trie en JQL) et
      n° 9 (`get-debt-bill` et le panneau rendent les mêmes chiffres,
      `identical: true`).
- [x] Les huit outils MCP du §13 exercés un par un sur le runtime, tous verts.
- [x] **Recette §20 n° 1 vérifiée sur de vraies données Jira** (pas le jeu
      d'exemple) : projet ENGS, dette `<TICKET_C>` (étiquette `tech-debt`, composant
      *Billing Services*), bug `<TICKET_D>` sur le même composant avec **14 h de
      temps saisi** (= 2 j-p à 7 h/j), relié à la dette par un lien Jira.
      Initialisation 3/3, recalcul : **1 preuve, 2 additions, 2 champs écrits**,
      et l'addition de `<TICKET_C>` vaut **2 – 2 j-p** : le bug lié tombe bien à
      100 % dans la fourchette **basse**. MCP et panneau identiques.
- [x] Textes de soumission écrits : `docs/MARKETPLACE.md` (formulaire Marketplace,
      scopes justifiés un par un, 12 captures à produire) et `docs/DEVPOST.md`
      (champs du formulaire Devpost).
- [x] **Environnement `production` vérifié de bout en bout** (smoke test sur
      `<DEMO_SITE>`, projet ENGS) :

      | Étape | Résultat | Durée |
      |---|---|---|
      | `schema-sql` | tables créées dans la partition production | 3 804 ms |
      | `file-events` | message poussé dans la file Forge Events (jobId rendu) | 530 ms |
      | `lecture-jira` | projet ENGS, 20 tickets lus en tant qu'app | 742 ms |
      | `calcul-domaine` | 20 tickets analysés, 2 dettes, 1 preuve, 2 lignes de classement | 344 ms |

- [x] **Recalcul nocturne exécuté pour de vrai sur les cinq projets initialisés**
      (`?action=recalc-all`, le même code que le `scheduledTrigger`) :
      **40 secondes** au total, 66 preuves, 5 additions, champ écrit sans
      réécrire les valeurs identiques, puis **7 bulletins de remboursement**
      publiés par `?action=repayments`.

## Ce qui reste à faire avant le 22 décembre

- [ ] Enregistrer la vidéo de moins de cinq minutes (scénario prêt dans `docs/VIDEO.md`).
- [ ] Trancher les scopes `read:graph:*` **au gel du 15/12** (décision G93,
      voir `docs/MARKETPLACE.md` §5) : **conservés le 12/11**, parce que la
      sonde de diagnostic les appelle réellement et qu'un changement de scopes
      déclenche une **montée de version majeure** au déploiement (`forge lint`,
      règle `MAJOR_VERSION_RULE`). Le bonus « Teamwork Graph » n'est donc pas
      réclamé comme démontré sur cette soumission. Au gel, si le graphe ne peut
      toujours pas être démontré depuis un écran réel : retirer les trois scopes
      **et** le code graphe (`src/platform/graph.ts`, sonde V4/V5/V6) dans la
      même version — sinon `forge lint` laisse l'avertissement
      `teamwork-graph-scopes`. Les scopes seront redéclarés dans une version
      ultérieure, avec les fonctions §8 de priorité 2.
- [ ] Vérifier les six écrans **dans le navigateur** (Projet → L'addition, panneau
      de ticket, encart sur un bug, champ, gadget, réglages). Le chemin de données
      de toutes les surfaces est déjà vérifié en réel le 12/11 (sonde
      `?action=screens`, 26 surfaces vertes dont la simulation DT-21 et
      l'argumentaire DT-17 — voir `docs/VALIDATIONS.md`) ; il reste le rendu UI
      Kit 2, que seule l'ouverture dans Jira peut prouver. Une session navigateur
      authentifiée est nécessaire (l'agent ne saisit aucun identifiant).
- [ ] Produire les **14 captures** (12 prévues + l'onglet Simulation et
      l'argumentaire, ajoutés le 12/11) : la liste des écrans, les tickets à
      afficher, la recette §20 correspondante et les noms de fichiers sont dans
      `docs/CAPTURES.md` (les captions sont dans `docs/MARKETPLACE.md` §8).
- [ ] Publier la politique de confidentialité et les conditions d'utilisation
      (`docs/PRIVACY.md`, `docs/TERMS.md`) et coller leurs URL dans le
      formulaire Marketplace — plan de publication ci-dessous.
- [ ] Déposer sur Devpost (texte prêt dans `docs/DEVPOST.md`) et sur le
      Marketplace (texte prêt dans `docs/MARKETPLACE.md`) — les deux dépôts se
      font depuis un navigateur, avec ton compte.
- [ ] **Au gel du 15/12** : retirer les deux modules `webtrigger`
      (`laddition-smoke`, `laddition-ops`) du manifeste, puis redéployer et
      relancer `forge eligibility`. C'est la condition d'éligibilité **Runs on
      Atlassian** (motif mesuré le 12/11 : « webtrigger module that can egress
      data »). Conséquences à accepter ce jour-là : l'outillage d'exploitation
      disparaît (plus de `?action=init|bootstrap|sample|report|screens`), donc
      l'initialisation d'un site se fait par l'assistant en trois étapes de
      l'écran Réglages (DT-12, `BootstrapWizard`) et le bouton « Load sample
      data » ; retirer aussi `src/jobs/opsAuth.ts`, `opsTrigger.ts`,
      `smokeTrigger.ts` et leurs fonctions au manifeste pour que `forge lint` ne
      signale pas de code mort. En attendant, les deux webtriggers exigent le
      jeton `LADDITION_OPS_TOKEN` (échec fermé, `src/jobs/opsAuth.ts`) — vérifié
      en réel le 12/11 : 403 sans jeton, 200 avec.
- [ ] Exécuter la procédure de gel (version 1.0.0 + tag) au gel du 15/12 —
      procédure ci-dessous.

## Publication de PRIVACY.md et TERMS.md — plan (item G95)

Les textes sont rédigés et prêts : `docs/PRIVACY.md` et `docs/TERMS.md` (en
anglais, car le formulaire Marketplace et la fiche publique sont en anglais).
**Rien n'est publié à ce jour et aucune URL n'existe encore** : les emplacements
sont marqués `<PRIVACY_URL>` et `<TERMS_URL>` dans ce plan.

1. **Où héberger (recommandé) : GitHub Pages sur le dépôt public.** Le dépôt
   `github.com/BaptisteFaisy/laddition` est déjà public ; activer
   *Settings → Pages* (source : branche par défaut, dossier racine ou `/docs`)
   donne une URL stable, gratuite et sous notre contrôle. Les fichiers sont
   déjà au format publiable. Décision du propriétaire requise : activer Pages
   ou choisir un autre hébergement (site personnel, wiki du dépôt…) — dans
   tous les cas l'URL doit être **publique sans authentification** (exigence
   Marketplace) et **stable** (elle est imprimée dans la fiche).
2. **Vérifier avant publication** : remplacer `<EFFECTIVE_DATE>` par la date du
   jour dans les deux fichiers ; relire les deux textes une dernière fois
   (aucun placeholder résiduel : `grep -n "<" docs/PRIVACY.md docs/TERMS.md`
   ne doit sortir que les marques assumées).
3. **Où coller chaque URL** :
   - formulaire Marketplace (fiche de l'app) : champ *Privacy policy* →
     `<PRIVACY_URL>` ; champ *Terms of use* (ou équivalent) → `<TERMS_URL>` ;
   - `docs/MARKETPLACE.md` §4 : la note « text to paste » reste valable pour le
     champ descriptif ; ajouter les URL une fois connues ;
   - dépôt Devpost : ajouter les deux URL en fin de description (facultatif) ;
   - `README.md` : une ligne « Privacy / Terms » pointant vers les fichiers du
     dépôt (pas les URL Pages) — les fichiers font foi.
4. **Après publication** : noter les URL réelles ici à la place des
   placeholders, et vérifier que chaque lien rend le bon document en navigation
   privée (pas de page de login).

## Historique git public — procédure et risques de réécriture (item G96)

**Décision du propriétaire : NE PAS réécrire l'historique.** Cette section
documente ce qui serait nécessaire si la décision changeait, et le risque
résiduel accepté en l'état.

Ce qui reste trouvable dans l'historique public même après pseudonymisation du
HEAD : l'ARI réel d'app (`manifest.yml`, tous les commits depuis l'origine) et
les quatre clés de tickets de test réelles des projets PAY et ENGS (remplacées
dans le HEAD par `<TICKET_A>`–`<TICKET_D>` ; leurs valeurs littérales restent
lisibles dans les versions antérieures de `docs/NOTES-DE-SOUMISSION.md`, par
exemple via `git log -p -- docs/NOTES-DE-SOUMISSION.md`).

Procédure si réécriture décidée (à faire par le propriétaire, jamais par un
agent sans accord explicite) :

1. Annoncer la maintenance (forks, clones, juges en train de tester).
2. `git clone --mirror` du dépôt ; travailler sur le miroir.
3. Lister les commits porteurs : `git log --all -S '<valeur littérale>'
   --oneline` pour chaque valeur sensible (ARI et les quatre clés de tickets,
   non recopiées ici) ; vérifier `git log --all` (toutes les branches, pas
   seulement la défaut).
4. Réécrire avec `git filter-repo --replace-text expressions.txt` (outil
   recommandé ; `filter-branch` est déprécié et lent).
5. `git push --force --mirror` vers le dépôt public.
6. **Purger les caches GitHub** : les commits isolés restent accessibles par
   leur SHA via l'API et l'UI tant que GitHub n'a pas ramassé ; demander au
   support GitHub la purge des vues en cache. Les forks existants **ne sont
   pas purgés** — ce qui a été forké est perdu.
7. Faire re-cloner tous les environnements locaux (l'ancien historique y
   subsiste sinon), et réinitialiser les worktrees en cours.

Risques : perte des références issues/PR vers les SHA réécrits ; cassure de
tous les forks et clones existants ; fenêtre où l'ancien contenu reste lisible
(caches, forks, archives tierces) ; **irrévocabilité** — une donnée publiée
sur un dépôt public doit de toute façon être considérée comme compromise : la
réécriture réduit l'exposition, elle ne l'annule pas. C'est pourquoi le choix
du propriétaire (ne pas réécrire) est tenable : l'ARI n'est pas un secret
d'authentification, aucun jeton n'est dans l'historique, et les tickets
concernent un site de démonstration jetable.

## Procédure de gel — version 1.0.0 + tag annoté (item G97)

État vérifié le 12/11 : `package.json` porte `0.1.0` (version de développement)
et **aucun tag n'existe** (`git tag` vide). L'écart est documenté dans
`docs/MARKETPLACE.md` §6 : la version déclarée à la soumission sera **1.0.0**.
La procédure ci-dessous s'exécute **au gel du 15 décembre** (§23), par le
propriétaire ; elle n'a pas encore été lancée.

1. **Vérifications avant bump** (tout doit être vert) :
   - `npm ci && npm test` (206 tests) ;
   - `npx tsc --noEmit` ;
   - `node tools/validate_manifest.mjs manifest.yml` ;
   - `node tools/check_manifest_exports.mjs manifest.yml src/index.tsx` ;
   - `forge lint` ;
   - working tree propre (`git status`), branche à jour.
2. **Bump** : passer `"version"` de `0.1.0` à `1.0.0` dans `package.json`
   (seul changement du commit), commit dédié :
   `git commit -am "release: 1.0.0"`.
3. **Déployer** : `forge deploy -e production`, puis smoke test sur
   `<DEMO_SITE>` (les six écrans + `?action=smoke`).
4. **Taguer le commit exact déployé** :
   `git tag -a v1.0.0 -m "Codegeist 2026 entry — L'addition 1.0.0"` puis
   `git push origin v1.0.0`. Le tag annoté est la référence : il lie la
   version Marketplace au commit précis du code déployé.
5. **Déclarer** : saisir **1.0.0** dans le formulaire Marketplace ; coller
   `<PRIVACY_URL>` et `<TERMS_URL>` (section ci-dessus).
6. **Après le gel** : tout redéploiement est une version **postérieure**
   (1.0.1+) ; ne jamais déplacer le tag `v1.0.0`.

## Les trois chiffres à dire à l'oral

1. **19 à 34 jours-personne** : ce que la dette oubliée « supprimer le double système
   de calcul des taxes » a coûté sur 90 jours, en quatre incidents, neuf bugs et
   six tickets deux fois plus longs que la référence.
2. **1 à 2 jours-personne** : ce que coûte le refactoring que l'équipe réclame
   depuis des mois — la dette qui gagne l'arbitrage n'est pas celle qui coûte.
3. **22 jours-personne** : ce que coûte la zone `notifications`, qui n'a aucun
   ticket de dette. L'app prépare le brouillon ; le tech lead relit et crée.

Le reste n'est que de la méthode : fourchette basse et haute, preuves cliquables,
formule visible en deux clics, et aucun indicateur par personne.
