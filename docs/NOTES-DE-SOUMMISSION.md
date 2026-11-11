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

- [ ] `forge register` sur le site de démonstration, puis remplacer l'identifiant
      `REPLACE_WITH_APP_ID` dans `manifest.yml` et déployer (`forge deploy`).
- [ ] Valider les six points du §17 (voir `docs/VALIDATIONS.md`) sur le site réel :
      volume et débit de lecture des historiques, écriture en masse du champ,
      données du site de démonstration, champ « services affectés » des incidents,
      dates d'ouverture et de fusion des PR, accès Compass.
- [ ] Enregistrer la vidéo de moins de cinq minutes (scénario prêt dans `docs/VIDEO.md`).
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
