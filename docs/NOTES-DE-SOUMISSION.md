# Notes de soumission — Codegeist 2026

> Échéance : **mardi 22 décembre 2026, 21 h (Paris)**. Catégorie : Apps for Software Teams.
> Bonus visés : Teamwork Graph, Agents Rovo, MCP, Marketplace.

## Ce qui est prêt

- [x] Arbre complet de l'app Forge (domaine pur, adaptateurs, jobs, écrans, agent Rovo, outils MCP).
- [x] `manifest.yml` valide contre le schéma Forge officiel (`node tools/validate_manifest.mjs`).
- [x] Typage strict sans erreur (`npx tsc --noEmit`), 202 assertions au vert (`npm test`).
- [x] Jeu d'exemple cohérent avec le §7.1 du cahier des charges (bouton « Load sample data »).
- [x] Documentation : `README.md`, `docs/JUGES.md` (parcours de test en 5 min),
      `docs/METHODE.md` (formules), `docs/VIDEO.md` (script de la vidéo),
      `docs/VALIDATIONS.md` (les six points à valider).
- [x] SOCLE CI : workers self-hosted, file Mergify, budget CI 5 min, couche 0,
      agent hermes de résolution de conflits.

## Ce qui reste à faire avant le 22 décembre

- [x] `forge register` sur le compte Atlassian : app id `15da522f-986f-4b46-8844-d4b8c2bcaf8e` posé dans `manifest.yml`.
- [x] `forge lint` propre (No issues found) et `forge build` OK (tag `b88e1c7b`).
- [x] `forge deploy -e development` : déployé.
- [x] `forge site provision` : site de démo `https://one-atlas-cndz.atlassian.net` (actif jusqu'au 09/02/2027).
- [x] `forge install --demo-site --product jira -e development` : installé et à jour sur Jira.
- [x] `forge eligibility` : confirmé éligible au programme **Runs on Atlassian**.
- [x] Tickets de test réels créés dans le projet PAY du site : `PAY-17` (dette « Supprimer le double système de calcul des taxes ») et `PAY-18` (bug « Montant de TVA incohérent »).

## Ce qui reste à faire avant le 22 décembre

- [x] **Les six validations du §17 mesurées sur le site réel** (sondes exécutables
      `?action=probe`, code dans `src/jobs/opsValidate.ts`, détail dans
      `docs/VALIDATIONS.md`) :

      | # | Point | Verdict mesuré le 11/11 |
      |---|---|---|
      | V1 | Débit de lecture des historiques | 200-250 ms/ticket, 0 échec → 17-21 min projetées pour 5 000 tickets : **au-dessus du budget de 15 min**, repli appliqué (fenêtre 90 j, lots de 50 dans la file) |
      | V2 | Écriture en masse du champ d'app | **validé** : `customfield_10867`, 10 écritures sur 10, triable et filtrable en JQL — aucun repli |
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

## Ce qui reste à faire avant le 22 décembre

- [ ] Enregistrer la vidéo de moins de cinq minutes (scénario prêt dans `docs/VIDEO.md`).
- [ ] Rouvrir V4, V5 et V6 sur un site dont l'administrateur d'organisation a
      accordé les scopes du Teamwork Graph, **et depuis un écran** : le graphe ne
      s'appelle qu'au nom d'un utilisateur (§15), un webtrigger n'en a pas. Les
      replis sont en place ; le bonus « Teamwork Graph » se joue là.
- [ ] Vérifier les six écrans dans le navigateur (Projet → L'addition, panneau de
      ticket, encart sur un bug, champ, gadget, réglages).
- [ ] Déployer en `production` et installer en production avant le gel du 15 décembre.
- [ ] Rédiger la description Marketplace (boutons, permissions, captures).
- [ ] Déposer sur le Marketplace (le dépôt reste public, licence MIT).

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
