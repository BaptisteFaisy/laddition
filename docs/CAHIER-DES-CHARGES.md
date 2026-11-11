# Le coût réel de la dette (« L'addition ») — cahier des charges

> Codegeist 2026 · catégorie **Apps for Software Teams**
> Bonus visés : Teamwork Graph, Agents Rovo, MCP, Marketplace
> Version 1 du 11 novembre 2026 · soumission avant le mardi 22 décembre 2026, 21 h (Paris)

## 1. L'idée en une phrase

L'app chiffre ce que chaque ticket de dette technique a réellement coûté sur les 90 derniers jours (incidents, bugs, lenteur, retouches), le compare au coût de sa correction, puis mesure ce qui change une fois la dette remboursée.

## 2. Le problème

Les tickets de dette technique perdent tous les arbitrages, pour une raison simple : leur coût est invisible. Face à une fonctionnalité qui a un client et une date, « il faudrait refactorer le module de facturation » n'a aucun chiffre à opposer.

Pourtant ce coût existe et laisse des traces partout :

- des incidents qui reviennent sur le même service ;
- des bugs qui retombent sur le même composant ;
- des tickets qui y prennent deux fois plus de temps qu'ailleurs ;
- des PR qui font trois allers-retours ;
- des tickets bloqués en attendant que « quelqu'un s'en occupe ».

Personne ne relie ces traces au ticket de dette qui les explique. Deux effets en découlent : la dette qui coûte vraiment reste en bas du backlog, et l'équipe se bat pour le refactoring qui l'agace le plus, pas pour celui qui rapporte le plus.

Un troisième effet est moins visible : une fois une dette remboursée, personne ne vérifie si cela a servi. Le prochain arbitrage repart de zéro.

## 3. Utilisateurs

| Qui | Moment | Attente |
|---|---|---|
| Tech lead | Préparation du trimestre, affinage du backlog | Savoir quelle dette traiter d'abord, avec des preuves |
| Product owner | Arbitrage | Un chiffre comparable à celui d'une fonctionnalité |
| Développeur | En ouvrant un ticket de dette ou un bug récurrent | Voir que le problème est mesuré, rattacher une preuve |
| Direction technique | Revue trimestrielle | Où part la capacité, ce que les remboursements ont rapporté |
| Agent de code | Avant de toucher une zone | Savoir que la zone est endettée et ce qui s'y casse |

## 4. Vocabulaire du produit

- **Ticket de dette** : un ticket désigné comme dette par une règle du projet (type, étiquette ou requête JQL).
- **Zone** : l'unité d'analyse, par défaut le composant Jira. Peut aussi être un composant Compass, un service ou une étiquette.
- **Preuve** : un fait daté qui a coûté du temps sur une zone : incident, bug, ticket anormalement long, réouverture.
- **Attribution** : la part d'une preuve imputée à un ticket de dette.
- **Addition** : le coût d'un ticket de dette sur 90 jours, en jours-personne, avec une fourchette et les preuves qui la composent.
- **Remboursement** : le coût estimé de la correction.
- **Retour** : ce que la correction ferait économiser, rapporté à son coût.
- **Dette fantôme** : une zone qui coûte cher sans aucun ticket de dette.
- **Dette morte** : un ticket de dette sans aucune preuve depuis 180 jours.
- **Bulletin de remboursement** : la comparaison avant/après, publiée quand une dette est close.

## 5. Principes

1. **Tout chiffre a sa méthode à portée de clic.** Aucun coût sans la liste des preuves et la formule.
2. **Une fourchette, pas une valeur.** Le bas ne compte que les preuves liées explicitement ou confirmées ; le haut ajoute les preuves attribuées par rapprochement.
3. **Pas de double compte.** Une preuve est répartie à 100 % au plus.
4. **Jamais de classement de personnes.** L'unité est la zone ou l'équipe.
5. **Le modèle de langage rapproche et rédige ; il ne calcule pas.**

## 6. Périmètre

Priorités : **M** = indispensable pour la soumission, **S** = souhaitable, **C** = après le hackathon.

| Lot | Contenu |
|---|---|
| MVP (22 décembre) | Zones, trois familles de coût (incidents, bugs, lenteur), attribution, addition par ticket, classement, dette fantôme et dette morte, champ calculé sur les tickets, page projet, agent Rovo et outils MCP, jeu d'exemple |
| V1 | Retouches, retard induit, retour et délai de retour, bulletin de remboursement, gadget, fonction JQL, argumentaire d'une page |
| Vision | Mesure fine des PR, coût en euros, prévision, lien avec les objectifs de l'entreprise |

Hors périmètre : analyser le code source. La dette est mesurée par ses effets sur le travail, pas par des métriques de code.

## 7. Parcours détaillés

### 7.1 Le classement qui s'inverse

1. Le tech lead ouvre **Projet → L'addition**.
2. Trois tickets de dette sont classés. Celui que l'équipe réclame depuis des mois (« migrer vers le nouveau framework de tests ») affiche 1 à 2 jours-personne.
3. En tête, un ticket oublié depuis un an : « supprimer le double système de calcul des taxes », 19 à 34 jours-personne.
4. Il l'ouvre. L'addition détaille : 4 incidents (11 j-p), 9 bugs (8 j-p), 6 tickets deux fois plus longs que la référence (5 à 15 j-p selon l'attribution).
5. Chaque ligne se déplie jusqu'aux tickets sources.
6. Remboursement estimé : 8 jours. Retour sur deux trimestres : entre 3 et 6 fois la mise.

### 7.2 La dette fantôme

La page signale : « La zone `notifications` a coûté 22 jours-personne en 90 jours et n'a aucun ticket de dette. » Un bouton prépare un ticket, dont la description est rédigée à partir des preuves. Le tech lead relit, corrige, crée.

### 7.3 La dette morte

« 7 tickets de dette n'ont aucune preuve depuis 180 jours. » Le tech lead en ferme cinq. Le backlog de dette redevient crédible.

### 7.4 Le développeur rattache une preuve

Sur un bug, l'encart propose : « Ce bug ressemble à la dette PAY-77 (double calcul des taxes). Confirmer ? ». Un clic : la preuve passe dans la fourchette basse.

### 7.5 Après le remboursement

PAY-77 est clos le 2 février. Huit semaines plus tard, un commentaire est publié sur le ticket : « Avant : 2,6 jours-personne par semaine sur la zone. Après : 0,7. Aucun incident depuis la clôture. Comparaison avant/après, sans preuve de causalité. »

### 7.6 L'arbitrage

Dans Rovo Chat, la product owner demande : « Prépare l'argumentaire pour PAY-77. » L'agent produit une page : le coût, les preuves principales, le remboursement, le retour, les limites de la méthode.

## 8. Du travail aux zones

Chaque ticket est rattaché à une ou plusieurs zones, par ordre de priorité :

1. Composant Jira du ticket.
2. Composant Compass touché (relation « Jira work item impacts Compass component » du Teamwork Graph).
3. Service affecté, pour les incidents JSM.
4. Étiquette, si le projet a choisi ce mode.

Un ticket rattaché à plusieurs zones partage son coût à parts égales. Un ticket sans zone va dans « non classé », dont la taille est affichée : c'est un indicateur de qualité des données.

Les équipes viennent du graphe (« Atlassian team owns Compass component ») ou, à défaut, de la table de correspondance du projet.

## 9. Familles de coût

Fenêtre : 90 jours glissants. Unité : jour-personne (j-p), 7 heures par défaut, 5 jours par semaine, réglables.

### C1 — Incidents (M)

Pour chaque incident rattaché à la zone :

`coût = durée de résolution × nombre d'intervenants`

- Intervenants : assignés et commentateurs distincts pendant l'incident, plafonnés à 6.
- Si du temps a été saisi sur l'incident, il remplace le calcul.
- Un post-mortem lié ajoute 0,5 j-p.

### C2 — Bugs (M)

Pour chaque bug créé dans la fenêtre sur la zone :

`coût = temps passé en statuts actifs × 1 personne`

- Statuts actifs : catégorie « En cours » de Jira.
- Le temps saisi, s'il existe, remplace le calcul.

### C3 — Lenteur (M)

Pour chaque ticket hors bug terminé dans la fenêtre sur la zone :

`surcoût = max(0, durée du ticket − durée de référence) × coefficient d'occupation`

- Durée : temps en statuts actifs.
- Référence : médiane des tickets de même type et de même taille dans l'organisation, hors zone étudiée.
- Coefficient d'occupation : 0,5 par défaut (un ticket en cours n'occupe pas quelqu'un à plein temps).
- Valeurs extrêmes rabotées au 95e centile.
- Moins de 5 tickets de référence : la famille C3 est déclarée « données insuffisantes » pour cette zone.

### C4 — Retouches (S)

Chaque réouverture : temps en statuts actifs entre la réouverture et la résolution suivante. Si le graphe expose les PR, les PR refusées s'ajoutent.

### C5 — Retard induit (S)

Pour chaque ticket bloqué par le ticket de dette : jours passés bloqué. Ce chiffre est affiché **à part**, en jours de retard, et n'entre pas dans l'addition : c'est du délai, pas de l'effort.

## 10. Attribution

Une preuve appartient à une zone. Reste à dire quelle dette de la zone l'explique.

| Situation | Attribution | Fourchette |
|---|---|---|
| La preuve est liée au ticket de dette par un lien Jira | 100 % à ce ticket | Basse et haute |
| Un humain a confirmé le rapprochement | 100 % à ce ticket | Basse et haute |
| Même zone, pas de lien | Partage entre les dettes de la zone, au prorata d'un score de pertinence | Haute seulement |
| Pertinence inférieure à 0,3 pour toutes les dettes | Non attribuée ; alimente la dette fantôme | — |

Le score de pertinence (0 à 1) vient du modèle de langage, qui compare le texte de la preuve à la description du ticket de dette et justifie sa note en une phrase. Cette phrase est affichée. Un clic confirme ou rejette le rapprochement ; les rejets ne sont plus proposés.

## 11. Retour et remboursement

- **Remboursement** : estimation du ticket de dette. Points convertis en jours d'après la vélocité de l'équipe, ou estimation initiale en temps. Sans estimation, le ticket est classé par coût seul, avec la mention « remboursement non chiffré ».
- **Coût évitable sur deux trimestres** : `addition basse × 2 × facteur de persistance`. Facteur par défaut : 0,7, réglable.
- **Retour** : coût évitable ÷ remboursement.
- **Délai de retour** : remboursement ÷ coût hebdomadaire moyen.

**Bulletin de remboursement.** Quand un ticket de dette est clos, l'app compare le coût hebdomadaire de la zone sur les 8 semaines précédant le début du travail et les 8 semaines suivant la clôture. Elle publie le résultat avec ses limites : autres changements survenus dans la zone, taille de l'échantillon.

## 12. Exigences fonctionnelles

| N° | Exigence | Priorité |
|---|---|---|
| DT-01 | Désigner les tickets de dette par type, étiquette ou JQL | M |
| DT-02 | Rattacher chaque ticket à ses zones selon le § 8 | M |
| DT-03 | Reconstituer les durées par statut à partir de l'historique des tickets | M |
| DT-04 | Calculer C1, C2 et C3 sur 90 jours | M |
| DT-05 | Attribuer les preuves selon le § 10, sans double compte | M |
| DT-06 | Afficher l'addition d'un ticket : fourchette, détail par famille, preuves cliquables, formules | M |
| DT-07 | Classer les tickets de dette par coût | M |
| DT-08 | Signaler la dette fantôme et préparer un ticket | M |
| DT-09 | Signaler la dette morte | M |
| DT-10 | Confirmer ou rejeter un rapprochement depuis la preuve ou depuis la dette | M |
| DT-11 | Écrire le coût dans un champ du ticket, triable et utilisable en JQL | M |
| DT-12 | Initialiser 180 jours d'historique à l'installation, avec barre de progression | M |
| DT-13 | Jeu d'exemple pour tester sans historique | M |
| DT-14 | Familles C4 et C5 | S |
| DT-15 | Retour et délai de retour | S |
| DT-16 | Bulletin de remboursement | S |
| DT-17 | Argumentaire d'une page, rédigé à partir de l'addition | S |
| DT-18 | Gadget : principales dettes, coût par équipe et par trimestre | S |
| DT-19 | Fonction JQL listant les dettes les plus coûteuses | S |
| DT-20 | Conversion en euros avec un taux journalier réglé par l'administrateur | C |
| DT-21 | Simulation : « si on rembourse ces trois dettes, combien de capacité revient ? » | C |

## 13. Agent Rovo et outils MCP

### Agent « L'addition »

- « Quelle dette nous coûte le plus ? »
- « Détaille l'addition de PAY-77. »
- « Y a-t-il de la dette sans ticket ? »
- « Qu'a rapporté le remboursement de PAY-41 ? »
- « Prépare l'argumentaire pour PAY-77. »

### Actions, aussi exposées par `rovo:mcp`

| Clé | Verbe | Entrées | Retour |
|---|---|---|---|
| `get-debt-ranking` | GET | `projectKey`, `limit` | Dettes classées, fourchettes, retour |
| `get-debt-bill` | GET | `issueKey` | Addition détaillée et preuves |
| `get-zone-costs` | GET | `projectKey`, `zone` | Coût de la zone par famille, tendance |
| `list-phantom-debt` | GET | `projectKey` | Zones coûteuses sans ticket |
| `list-dead-debt` | GET | `projectKey` | Tickets de dette sans preuve |
| `get-repayment-report` | GET | `issueKey` | Avant/après et limites |
| `draft-debt-ticket` | GET | `projectKey`, `zone` | Brouillon de ticket rédigé depuis les preuves |
| `confirm-evidence` | UPDATE | `evidenceKey`, `debtKey`, `confirmed` | Rapprochement confirmé ou rejeté |

Usage par un agent de code : avant de modifier une zone, `get-zone-costs` lui indique qu'elle est endettée et ce qui s'y casse le plus souvent.

## 14. Écrans

1. **Page projet « L'addition »** (`jira:projectPage`). Classement des dettes ; onglets Zones (carte des coûts), Dette fantôme, Dette morte, Remboursements, Méthode.
2. **Panneau sur un ticket de dette** (`jira:issuePanel`). L'addition : fourchette, familles, preuves, rapprochements à confirmer, retour.
3. **Encart sur un bug ou un incident** (`jira:issueContext`). « Alimente la dette PAY-77 » ou « ressemble à PAY-77, confirmer ? ».
4. **Champ « Coût de la dette (j-p / 90 j) »** (`jira:customField`), en lecture seule, écrit par l'app.
5. **Gadget** (`jira:dashboardGadget`).
6. **Réglages du projet** : définition de la dette, mode de zone, journée de travail, coefficients, projets JSM.

L'onglet **Méthode** affiche les formules, les coefficients en vigueur et la qualité des données : part des tickets sans zone, familles déclarées insuffisantes.

## 15. Architecture Forge

Une seule app, installée sur Jira. Aucune sortie réseau.

```yaml
# Esquisse, à valider avec forge lint
modules:
  jira:projectPage:
  jira:issuePanel:
  jira:issueContext:
  jira:customField:        # coût, lecture seule
  jira:dashboardGadget:    # lot S
  jira:jqlFunction:        # lot S
  jira:projectSettingsPage:
  trigger:                 # avi:jira:created:issue, avi:jira:updated:issue,
                           # avi:jira:created:issuelink, avi:jira:deleted:issuelink
  scheduledTrigger:        # recalcul quotidien, bulletins de remboursement
  consumer:                # initialisation et recalculs, timeoutSeconds: 900
  sql:
  llm:
  rovo:agent:
  action:
  rovo:mcp:
```

### Flux

1. **Initialisation.** À l'installation, l'app parcourt 180 jours de tickets par lots de 50, avec leur historique, et enregistre les durées par statut. Chaque lot est un message de file.
2. **Au fil de l'eau.** Chaque modification de ticket met à jour ses durées par statut et marque sa zone « à recalculer ».
3. **Chaque nuit.** Recalcul des preuves, des attributions, des additions et du classement ; écriture du champ sur les tickets de dette ; instantané hebdomadaire pour les tendances.
4. **À la demande.** Les écrans lisent les résultats enregistrés.

### Teamwork Graph

L'app **consomme** le graphe : composants Compass touchés par un ticket, équipes propriétaires, incidents et services, PR et relecteurs. L'API ne s'appelle qu'au nom d'un utilisateur ; ces lectures se font donc à l'ouverture des écrans et sont mises en cache. Le calcul nocturne s'en passe et utilise l'API REST de Jira.

### Et les PR lentes ?

Une app installée sur Jira ne peut pas appeler l'API Bitbucket. La lenteur des PR est donc approchée de deux façons :

- le temps passé par les tickets dans les statuts de revue ;
- les PR vues dans le Teamwork Graph, quand le dépôt est relié à Jira.

Une mesure fine (taille, allers-retours, délai de première revue) demande une seconde app côté Bitbucket ; elle est classée dans la vision.

## 16. Modèle de données (Forge SQL)

| Table | Colonnes principales |
|---|---|
| `issue_fact` | issue_id, key, project_id, type, is_debt, zones_json, created_at, resolved_at, size |
| `status_span` | issue_id, status_category, started_at, ended_at |
| `evidence` | id, zone, family (C1 à C5), source_issue_id, occurred_at, cost_jp, detail_json |
| `attribution` | evidence_id, debt_issue_id, share, basis (lien, confirmé, rapprochement), relevance, rationale |
| `rejection` | evidence_id, debt_issue_id, rejected_by, at |
| `debt_bill` | debt_issue_id, computed_at, low_jp, high_jp, by_family_json, payback_days, roi_low, roi_high |
| `zone_week` | zone, week, cost_jp, by_family_json |
| `baseline` | issue_type, size_class, median_days, sample_size, computed_at |
| `repayment` | debt_issue_id, closed_at, before_rate, after_rate, caveats_json, published_at |
| `settings` | project_id, settings_json |

## 17. Contraintes vérifiées et points à valider

### Vérifié dans la documentation (10 et 11 novembre 2026)

- Modules Jira disponibles : page projet, panneau et encart de ticket, champ personnalisé, gadget de tableau de bord, fonction JQL, page de réglages du projet.
- Événements de tickets et de liens disponibles pour les déclencheurs.
- Fonctions asynchrones et planifiées : jusqu'à 900 s. Charge utile : 5 Mo.
- Forge SQL : 1 Gio par installation en production, 5 s par SELECT, pas de clés étrangères, une requête par instruction.
- Forge LLMs : modèles Claude, texte seul, 100 requêtes par minute et 500 000 jetons par minute et par modèle.
- API Teamwork Graph : en Preview, appel au nom de l'utilisateur, requêtes enregistrées, un scope par type d'objet accordé par un administrateur d'organisation ; un scope manquant vide les résultats sans erreur.
- Relations présentes : ticket → composant Compass, équipe → composant Compass, incident JSM → service, incident JSM → ticket, utilisateur → PR relues.
- Une app appelle l'API du graphe **ou** fournit un connecteur, pas les deux.
- Une app Forge installée sur Jira ne peut pas appeler l'API Bitbucket.

### À valider par un prototype la première semaine

| Point | Pourquoi | Solution de repli |
|---|---|---|
| Volume et débit de lecture des historiques | L'initialisation lit des milliers de tickets | Fenêtre de 90 jours ; lots plus petits |
| Écriture en masse d'un champ d'app en lecture seule | Rend le coût triable dans Jira | Propriété de ticket indexée pour JQL |
| Données du site de démonstration : incidents, composants, historique | Sans historique, pas de coût | Jeu d'exemple injecté dans les tables de l'app |
| Champ « services affectés » des incidents lisible par l'app | Rattache les incidents aux zones | Composant du ticket d'incident |
| Dates d'ouverture et de fusion des PR dans le graphe | Mesure des PR lentes | Temps en statut de revue |
| Compass accessible depuis l'app Jira | Zones par composant Compass | Composants Jira |

## 18. Exigences non fonctionnelles

- **Transparence.** Chaque chiffre affiché renvoie à ses preuves et à sa formule en deux clics au plus.
- **Stabilité.** Le même jeu de données donne la même addition ; les scores de pertinence sont mis en cache et ne sont recalculés que si un texte change.
- **Rapidité.** Page projet en moins de 2 s ; recalcul nocturne d'un projet de 5 000 tickets en moins de 15 minutes.
- **Vie privée.** Aucun indicateur par personne. Les noms n'apparaissent que sur des tickets que le lecteur peut déjà ouvrir.
- **Droits.** Les preuves issues de projets que le lecteur ne voit pas sont comptées, mais affichées comme « éléments masqués ».
- **Données.** Stockage Forge SQL, modèle hébergé par Atlassian, aucune sortie réseau.
- **Langues.** Interface en anglais et en français ; soumission en anglais.

## 19. Cas limites

- Projet sans composants : mode étiquette, ou zone unique « projet » avec un avertissement.
- Ticket de dette sans zone : pas d'addition, demande de rattachement.
- Zone avec une seule dette : toutes les preuves sans lien lui sont proposées, mais restent dans la fourchette haute.
- Incident sans date de résolution : compté jusqu'à aujourd'hui, marqué « en cours ».
- Tickets importés sans historique de statuts : durée approchée par création → résolution, signalée comme telle.
- Workflow sans statut de revue : la lenteur repose sur la seule durée totale.
- Équipe qui saisit du temps sur certains tickets seulement : temps saisi quand il existe, calcul sinon ; la part de chaque méthode est affichée.
- Dette close puis rouverte : le bulletin de remboursement est retiré et recalculé à la clôture suivante.
- Plusieurs dettes closes sur la même zone le même mois : un bulletin commun.
- Renommage ou fusion de composants : les zones suivent l'identifiant, pas le nom.

## 20. Recette

1. Étant donné un bug lié à un ticket de dette, alors son coût figure à 100 % dans la fourchette basse de ce ticket.
2. Étant donné un incident sur une zone à deux dettes, sans lien, alors son coût est partagé entre elles et la somme des parts ne dépasse pas 100 %.
3. Quand un utilisateur rejette un rapprochement, alors la preuve quitte l'addition et n'est plus proposée.
4. Étant donné une zone coûtant plus de 10 j-p sans ticket de dette, alors elle figure dans la dette fantôme et un brouillon de ticket est proposé.
5. Étant donné un ticket de dette sans preuve depuis 180 jours, alors il figure dans la dette morte.
6. Chaque ligne de l'addition ouvre la liste des tickets qui la composent.
7. Une zone avec moins de 5 tickets de référence affiche « données insuffisantes » pour la lenteur, et aucun chiffre.
8. Le champ « Coût de la dette » permet de trier une liste de tickets dans Jira.
9. `get-debt-bill` renvoie les mêmes chiffres que le panneau du ticket.
10. Aucune vue ne présente de total par personne.

## 21. Scénario de la vidéo (moins de 5 minutes, en anglais)

| Temps | Contenu |
|---|---|
| 0:00 – 0:30 | Une réunion d'arbitrage : la dette perd encore, faute de chiffre |
| 0:30 – 1:20 | Le classement : la dette préférée de l'équipe coûte 2 jours, la dette oubliée en coûte 30 |
| 1:20 – 2:10 | L'addition détaillée, dépliée jusqu'aux incidents et aux bugs |
| 2:10 – 2:40 | Un bug rattaché d'un clic ; la fourchette se resserre |
| 2:40 – 3:10 | Dette fantôme : une zone coûteuse sans ticket, brouillon créé |
| 3:10 – 3:40 | Bulletin de remboursement d'une dette déjà close |
| 3:40 – 4:20 | Agent Rovo : l'argumentaire d'une page ; un agent de code interroge la zone par MCP |
| 4:20 – 4:45 | Méthode et architecture : Forge SQL, Teamwork Graph, Rovo, MCP |

## 22. Comment les juges testeront

Le coût se lit dans l'historique, qu'on ne peut pas antidater par l'API. Les instructions prévoient donc :

1. **Jeu d'exemple.** Un bouton injecte dans les tables de l'app un projet fictif de 6 mois (3 dettes, 60 preuves, 1 remboursement). Un bandeau « données d'exemple » reste affiché. Tous les écrans, l'agent et les outils MCP fonctionnent dessus.
2. **Données réelles du site.** Un assistant en trois étapes : désigner la dette, choisir le mode de zone, lancer l'initialisation. Le résultat dépend de l'historique présent sur le site.

## 23. Plan jusqu'au 22 décembre

| Semaine | Objectif |
|---|---|
| 11 – 17 nov. | Les six validations du § 17 ; lecture des historiques et durées par statut |
| 18 – 24 nov. | Zones, preuves C1 et C2, stockage, initialisation par lots |
| 25 nov. – 1er déc. | C3 et références, attribution, rapprochement par modèle |
| 2 – 8 déc. | Addition, classement, page projet, panneau de ticket, champ calculé |
| 9 – 15 déc. | Dette fantôme et morte, agent, MCP, jeu d'exemple ; gel des fonctionnalités le 15 |
| 16 – 22 déc. | Recette, vidéo, instructions pour les juges, soumission, dépôt Marketplace |

## 24. Risques

| Risque | Parade |
|---|---|
| Chiffres contestés, donc ignorés | Fourchette, méthode affichée, preuves cliquables, confirmation humaine |
| Données pauvres sur le site de test | Jeu d'exemple ; qualité des données affichée |
| Dérive vers la surveillance des personnes | Principe 4, recette n° 10 |
| Rapprochements hasardeux | Fourchette haute seulement, justification visible, rejet en un clic |
| Ressemblance avec un outil de priorisation de backlog | Le produit mesure un coût passé et vérifie un remboursement ; il ne note pas le backlog |
| Initialisation trop lente | Lots de 50, reprise sur erreur, fenêtre réductible |

## 25. La vision poussée à l'extrême

- **La dette entre dans la comptabilité de l'équipe.** Chaque trimestre : intérêts payés, capital remboursé, retour constaté. La part de capacité consacrée à la dette se décide sur ces chiffres.
- **Prévision.** « À ce rythme, la zone `taxes` coûtera 45 jours-personne au prochain trimestre. »
- **Lien avec les objectifs.** Une dette qui ralentit les tickets d'un objectif d'entreprise affiche l'objectif menacé.
- **Mesure fine du code en mouvement.** Une app compagne côté Bitbucket apporte taille des PR, allers-retours et délais de revue ; les échecs de CI récurrents d'un composant s'ajoutent aux preuves.
- **Garde-fou pour les agents.** Un agent de code qui s'apprête à ajouter du code dans une zone endettée reçoit l'addition et les tickets de dette ouverts.
- **Mémoire des arbitrages.** « On a refusé de rembourser PAY-77 il y a deux trimestres ; depuis, il a coûté 41 jours-personne. »

## 26. Sources

- [Codegeist 2026](https://codegeist2026.devpost.com/) et son [règlement](https://codegeist2026.devpost.com/rules)
- [Gagnants de Codegeist 2025](https://www.atlassian.com/blog/developers/meet-the-winners-of-codegeist-2025-atlassian-williams-racing-edition)
- [Modules Jira](https://developer.atlassian.com/platform/forge/manifest-reference/modules/index-jira/) et [événements Jira](https://developer.atlassian.com/platform/forge/events-reference/jira/)
- [Appeler l'API Teamwork Graph](https://developer.atlassian.com/platform/teamwork-graph/call-the-teamwork-graph-api/)
- [Types de relations du graphe](https://developer.atlassian.com/platform/teamwork-graph/api-reference/relationship-types/overview/)
- [Limites d'invocation](https://developer.atlassian.com/platform/forge/limits-invocation/), [limites SQL](https://developer.atlassian.com/platform/forge/limits-sql/), [limites LLM](https://developer.atlassian.com/platform/forge/limits-llm/)
- [Module Rovo MCP](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-mcp/), [module Rovo Agent](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/), [module Action](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/)
- [Scopes Jira et Bitbucket dans une même app (fil de la communauté)](https://community.developer.atlassian.com/t/access-jira-and-bitbucket-scopes-in-the-same-forge-app/79065)
