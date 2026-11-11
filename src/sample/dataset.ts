/**
 * Jeu d'exemple (DT-13, §22) — un projet fictif de six mois.
 *
 * Le jeu ne contient que des **faits** : tickets, séjours de statut, liens Jira
 * et règles de rapprochement. Aucun coût n'est écrit à la main : les preuves,
 * les attributions et les coûts de zone sont calculés par le domaine dans
 * `load.ts`. C'est ce qui rend le jeu cohérent — les chiffres affichés sont
 * exactement ceux que la méthode produit (§18, transparence).
 *
 * Les dates sont exprimées en semaines écoulées depuis l'instant de référence
 * (`[semaines, jour]`, 0 = lundi) : une preuve datée « lundi de la semaine -6 »
 * reste lisible quelle que soit la date d'injection.
 */

import type { IssueFact, IssueLink, ProjectSettings, SizeClass, StatusCategory, StatusSpan } from '../core/types.ts';
import { makeSettings } from '../core/settings.ts';
import { addDays, isoWeekStart } from '../core/time.ts';

/** Clé du projet fictif, seule valeur que l'agent et les actions MCP reçoivent. */
export const SAMPLE_PROJECT_KEY = 'PAY';

/**
 * Identifiant interne du projet fictif : volontairement la clé elle-même.
 * Les dépôts sont indexés par identifiant de projet alors que les actions MCP
 * ne reçoivent que la clé (§13) ; une seule valeur pour les deux évite un pont
 * clé → identifiant que la couche MCP n'a pas les moyens de faire.
 */
export const SAMPLE_PROJECT_ID = SAMPLE_PROJECT_KEY;

/** Projet JSM fictif : les incidents y vivent (§8, §9 C1). */
export const SAMPLE_JSM_PROJECT_KEY = 'PAYSUP';

/** Les quatre zones d'analyse du §8. « non classé » reste un indicateur. */
export const SAMPLE_ZONES = ['facturation', 'notifications', 'paiements', 'reporting'] as const;

/** Les trois dettes mises en scène par le §7.1. */
export const MAIN_DEBT_KEYS = ['PAY-77', 'PAY-41', 'PAY-90'] as const;

/** Les sept dettes dormantes du §7.3. */
export const DEAD_DEBT_KEYS = ['PAY-12', 'PAY-19', 'PAY-23', 'PAY-31', 'PAY-38', 'PAY-45', 'PAY-52'] as const;

/** Instant de référence par défaut du jeu (un vendredi). */
export const SAMPLE_NOW = '2026-11-06T09:00:00.000Z';

/** Un jour ouvré : `[semaines écoulées, jour de la semaine]`, 0 = lundi. */
export type Day = [weeksBack: number, weekday: number];

/** Identifiant interne d'un ticket, dérivé de sa clé (le jeu est fictif). */
export function issueIdOf(key: string): string {
  return key.toLowerCase();
}

/** Réglages du projet fictif : les défauts du §9, plus le bandeau « données d'exemple ». */
export function sampleSettings(): ProjectSettings {
  return makeSettings(SAMPLE_PROJECT_ID, SAMPLE_PROJECT_KEY, {
    demoData: true,
    jsmProjectKeys: [SAMPLE_JSM_PROJECT_KEY],
    teamByZone: {
      facturation: 'Paiements',
      notifications: 'Croissance',
      paiements: 'Paiements',
      reporting: 'Data',
    },
  });
}

/** Un ticket du jeu, décrit par ses dates et son rôle. */
interface FactSeed {
  key: string;
  summary: string;
  from: Day;
  to?: Day | null;
  zone?: string;
  type?: string;
  size?: SizeClass;
  bug?: boolean;
  incident?: boolean;
  debt?: boolean;
  estimateJp?: number;
  loggedSeconds?: number;
  participants?: number;
  postMortem?: boolean;
  jsm?: boolean;
  /** Séjours explicites : utilisés par les retouches (C4). */
  spans?: Array<[Day, Day, StatusCategory]>;
}

/** Instant d'un jour ouvré, ancré sur le lundi de la semaine de `anchor`. */
function at(anchor: string, day: Day): string {
  return addDays(isoWeekStart(anchor), -7 * day[0] + day[1]);
}

/**
 * Convertit un ticket décrit en fait de ticket (§16 `issue_fact`).
 *
 * Les incidents gardent la **clé** de leur projet JSM (`PAYSUP`) mais sont
 * rangés dans la **partition** du projet d'exemple : le recalcul nocturne lit
 * une partition à la fois (`listIssuesInWindow(projectId)`), et un incident
 * rangé ailleurs disparaîtrait du jeu au premier recalcul. La clé, elle, est ce
 * que le lecteur voit ; la partition est un détail de stockage.
 */
function buildFact(seed: FactSeed, anchor: string): IssueFact {
  const resolvedAt = seed.to ? at(anchor, seed.to) : null;
  const zone = seed.zone;
  return {
    issueId: issueIdOf(seed.key),
    key: seed.key,
    projectId: SAMPLE_PROJECT_ID,
    projectKey: seed.jsm ? SAMPLE_JSM_PROJECT_KEY : SAMPLE_PROJECT_KEY,
    type: seed.type ?? (seed.bug ? 'Bug' : seed.incident ? 'Incident' : 'Task'),
    isBug: seed.bug === true,
    isIncident: seed.incident === true,
    isDebt: seed.debt === true,
    zones: zone ? [zone] : [],
    createdAt: at(anchor, seed.from),
    resolvedAt,
    closedAt: resolvedAt,
    size: seed.size ?? 'm',
    estimateJp: seed.estimateJp ?? null,
    loggedSeconds: seed.loggedSeconds ?? null,
    labels: seed.debt ? ['tech-debt'] : [],
    components: zone ? [zone] : [],
    affectedServices: seed.incident && zone ? [zone] : [],
    hasPostMortem: seed.postMortem === true,
    participants: seed.participants ?? 1,
    visible: true,
    summary: seed.summary,
  };
}

/** Incidents (§9 C1) : quatre sur `facturation`, deux sur `notifications`. */
const INCIDENTS: readonly FactSeed[] = [
  { key: 'PAYSUP-101', summary: 'Taxes appliquées deux fois sur les factures de septembre', zone: 'facturation', from: [12, 0], to: [12, 3], incident: true, jsm: true, participants: 1 },
  { key: 'PAYSUP-102', summary: 'Double prélèvement sur les abonnements annuels', zone: 'facturation', from: [6, 0], to: [6, 2], incident: true, jsm: true, participants: 2 },
  { key: 'PAYSUP-103', summary: 'Total de facture arrondi au centime inférieur', zone: 'facturation', from: [3, 0], to: [3, 1], incident: true, jsm: true, participants: 2 },
  { key: 'PAYSUP-104', summary: 'Taxe locale réappliquée après un changement d’adresse', zone: 'facturation', from: [1, 0], to: [1, 2], incident: true, jsm: true, participants: 1 },
  { key: 'PAYSUP-111', summary: 'Notifications d’échéance envoyées en double', zone: 'notifications', from: [6, 0], to: [6, 2], incident: true, jsm: true, participants: 3 },
  { key: 'PAYSUP-112', summary: 'File d’envoi des courriels saturée le lundi', zone: 'notifications', from: [10, 0], to: [10, 2], incident: true, jsm: true, participants: 3 },
];

/** Bugs de la zone `facturation` : sept d’un jour, deux chiffrés au temps saisi. */
const FACTURATION_BUGS: readonly FactSeed[] = [
  { key: 'PAY-201', summary: 'TVA à 0 sur les factures d’avoir', zone: 'facturation', from: [4, 0], to: [4, 1], bug: true },
  { key: 'PAY-202', summary: 'Taxe de séjour absente des factures groupées', zone: 'facturation', from: [6, 0], to: [6, 1], bug: true },
  { key: 'PAY-203', summary: 'Arrondi fiscal faux sur les lignes négatives', zone: 'facturation', from: [8, 0], to: [8, 1], bug: true },
  { key: 'PAY-204', summary: 'Deux moteurs de taxes pour la même facture', zone: 'facturation', from: [10, 0], to: [10, 1], bug: true },
  { key: 'PAY-205', summary: 'Taxe dupliquée après réémission d’une facture', zone: 'facturation', from: [12, 0], to: [12, 1], bug: true },
  { key: 'PAY-206', summary: 'Montant hors taxes recalculé par l’ancien moteur', zone: 'facturation', from: [2, 0], to: [2, 1], bug: true },
  { key: 'PAY-207', summary: 'Total TTC incohérent sur les factures multi-devises', zone: 'facturation', from: [5, 0], to: [5, 1], bug: true },
  { key: 'PAY-208', summary: 'Taxe appliquée avant remise sur les avoirs', zone: 'facturation', from: [9, 0], to: [9, 1], bug: true, loggedSeconds: 12600 },
  { key: 'PAY-209', summary: 'Exonération de taxe perdue à la clôture du mois', zone: 'facturation', from: [7, 0], to: [7, 1], bug: true, loggedSeconds: 12600 },
];

/** Tickets lents de `facturation` : sept jours ouvrés pour une référence de deux. */
const FACTURATION_SLOW: readonly FactSeed[] = [
  { key: 'PAY-301', summary: 'Exporter le calcul des taxes hors du moteur historique', type: 'Story', size: 'm', zone: 'facturation', from: [2, 0], to: [1, 2] },
  { key: 'PAY-302', summary: 'Isoler la table des taux dans un service dédié', type: 'Story', size: 'm', zone: 'facturation', from: [4, 0], to: [3, 2] },
  { key: 'PAY-303', summary: 'Rejouer les factures historiques dans le nouveau moteur', type: 'Story', size: 'm', zone: 'facturation', from: [6, 0], to: [5, 2] },
  { key: 'PAY-304', summary: 'Supprimer l’appel au calculateur de taxes hérité', type: 'Story', size: 'm', zone: 'facturation', from: [8, 0], to: [7, 2] },
  { key: 'PAY-305', summary: 'Unifier les règles d’arrondi fiscal', type: 'Story', size: 'm', zone: 'facturation', from: [10, 0], to: [9, 2] },
  { key: 'PAY-306', summary: 'Documenter le calcul des taxes pour l’audit', type: 'Story', size: 'm', zone: 'facturation', from: [12, 0], to: [11, 2] },
];

/** Dix tickets de référence de la famille C3 : deux jours ouvrés, type et taille identiques. */
const STORY_REFERENCES: readonly FactSeed[] = [
  { key: 'PAY-311', summary: 'Afficher le détail des taxes dans la facture PDF', type: 'Story', size: 'm', zone: 'reporting', from: [2, 0], to: [2, 2] },
  { key: 'PAY-312', summary: 'Ajouter le filtre par période au registre des ventes', type: 'Story', size: 'm', zone: 'reporting', from: [3, 0], to: [3, 2] },
  { key: 'PAY-313', summary: 'Exporter le registre au format comptable', type: 'Story', size: 'm', zone: 'reporting', from: [4, 0], to: [4, 2] },
  { key: 'PAY-314', summary: 'Afficher le solde client dans la fiche compte', type: 'Story', size: 'm', zone: 'reporting', from: [5, 0], to: [5, 2] },
  { key: 'PAY-315', summary: 'Corriger le libellé des relances automatiques', type: 'Story', size: 'm', zone: 'reporting', from: [6, 0], to: [6, 2] },
  { key: 'PAY-316', summary: 'Ajouter la mention des pénalités de retard', type: 'Story', size: 'm', zone: 'reporting', from: [7, 0], to: [7, 2] },
  { key: 'PAY-317', summary: 'Regrouper les lignes d’une facture par catégorie', type: 'Story', size: 'm', zone: 'reporting', from: [8, 0], to: [8, 2] },
  { key: 'PAY-318', summary: 'Afficher le taux de taxe appliqué ligne par ligne', type: 'Story', size: 'm', zone: 'reporting', from: [9, 0], to: [9, 2] },
  { key: 'PAY-319', summary: 'Trier les factures par date de valeur', type: 'Story', size: 'm', zone: 'reporting', from: [10, 0], to: [10, 2] },
  { key: 'PAY-320', summary: 'Afficher le motif d’annulation d’une facture', type: 'Story', size: 'm', zone: 'reporting', from: [11, 0], to: [11, 2] },
];

/** Neuf tickets de référence courts : un jour ouvré, type et taille identiques. */
const TASK_REFERENCES: readonly FactSeed[] = [
  { key: 'PAY-321', summary: 'Renommer les libellés de la page de paiement', type: 'Task', size: 's', zone: 'reporting', from: [2, 0], to: [2, 1] },
  { key: 'PAY-322', summary: 'Ajouter le lien vers les conditions de vente', type: 'Task', size: 's', zone: 'reporting', from: [3, 0], to: [3, 1] },
  { key: 'PAY-323', summary: 'Corriger une faute dans le courriel de confirmation', type: 'Task', size: 's', zone: 'reporting', from: [4, 0], to: [4, 1] },
  { key: 'PAY-324', summary: 'Aligner le bouton de paiement sur la charte', type: 'Task', size: 's', zone: 'reporting', from: [5, 0], to: [5, 1] },
  { key: 'PAY-325', summary: 'Masquer le champ obsolète du formulaire', type: 'Task', size: 's', zone: 'reporting', from: [6, 0], to: [6, 1] },
  { key: 'PAY-326', summary: 'Ajouter une infobulle sur le moyen de paiement', type: 'Task', size: 's', zone: 'reporting', from: [7, 0], to: [7, 1] },
  { key: 'PAY-327', summary: 'Corriger le lien mort de l’aide en ligne', type: 'Task', size: 's', zone: 'reporting', from: [8, 0], to: [8, 1] },
  { key: 'PAY-329', summary: 'Afficher le délai de traitement sur la page', type: 'Task', size: 's', zone: 'reporting', from: [10, 0], to: [10, 1] },
  { key: 'PAY-330', summary: 'Trier les moyens de paiement par pays', type: 'Task', size: 's', zone: 'reporting', from: [11, 0], to: [11, 1] },
];

/** Zone `notifications` : quatre bugs d’un jour et trois tickets lents. */
const NOTIFICATION_ISSUES: readonly FactSeed[] = [
  { key: 'PAY-211', summary: 'Courriel de relance envoyé deux fois', zone: 'notifications', from: [2, 0], to: [2, 1], bug: true },
  { key: 'PAY-212', summary: 'Lien de désabonnement inopérant', zone: 'notifications', from: [4, 0], to: [4, 1], bug: true },
  { key: 'PAY-213', summary: 'Notification d’échéance en doublon après un paiement', zone: 'notifications', from: [6, 0], to: [6, 1], bug: true },
  { key: 'PAY-214', summary: 'Accusé de réception jamais envoyé', zone: 'notifications', from: [8, 0], to: [8, 1], bug: true },
  { key: 'PAY-331', summary: 'Regrouper les notifications quotidiennes', type: 'Task', size: 's', zone: 'notifications', from: [2, 0], to: [1, 0] },
  { key: 'PAY-332', summary: 'Passer la file d’envoi en traitement par lots', type: 'Task', size: 's', zone: 'notifications', from: [4, 0], to: [3, 0] },
  { key: 'PAY-333', summary: 'Dédoublonner les destinataires des relances', type: 'Task', size: 's', zone: 'notifications', from: [6, 0], to: [5, 0] },
];

/** Retouches (C4) : six bugs rouverts, trois sur `paiements`, trois sur `reporting`. */
const REWORK_BUGS: readonly FactSeed[] = [
  { key: 'PAY-601', summary: 'Remboursement partiel recalculé après réouverture', zone: 'paiements', from: [12, 0], to: [10, 2], bug: true, spans: [[[12, 0], [12, 4], 'inprogress'], [[12, 4], [10, 0], 'done'], [[10, 0], [10, 2], 'inprogress']] },
  { key: 'PAY-602', summary: 'Frais de service oubliés sur les paiements partiels', zone: 'paiements', from: [11, 0], to: [9, 2], bug: true, spans: [[[11, 0], [11, 4], 'inprogress'], [[11, 4], [9, 0], 'done'], [[9, 0], [9, 2], 'inprogress']] },
  { key: 'PAY-603', summary: 'Taux de remboursement inversé sur les avoirs', zone: 'paiements', from: [10, 0], to: [8, 2], bug: true, spans: [[[10, 0], [10, 4], 'inprogress'], [[10, 4], [8, 0], 'done'], [[8, 0], [8, 2], 'inprogress']] },
  { key: 'PAY-611', summary: 'Agrégat mensuel faux après correction du fuseau', zone: 'reporting', from: [5, 0], to: [3, 2], bug: true, spans: [[[5, 0], [5, 4], 'inprogress'], [[5, 4], [3, 0], 'done'], [[3, 0], [3, 2], 'inprogress']] },
  { key: 'PAY-612', summary: 'Compte des factures annulées doublé dans l’export', zone: 'reporting', from: [4, 0], to: [2, 2], bug: true, spans: [[[4, 0], [4, 4], 'inprogress'], [[4, 4], [2, 0], 'done'], [[2, 0], [2, 2], 'inprogress']] },
  { key: 'PAY-613', summary: 'Total du tableau de bord négatif après clôture', zone: 'reporting', from: [3, 0], to: [1, 2], bug: true, spans: [[[3, 0], [3, 4], 'inprogress'], [[3, 4], [1, 0], 'done'], [[1, 0], [1, 2], 'inprogress']] },
];

/** Tickets isolés : une preuve liée par dette, un rapprochement rejeté, un ticket sans zone. */
const ISOLATED_ISSUES: readonly FactSeed[] = [
  { key: 'PAY-401', summary: 'Remboursement partiel non remonté dans le grand livre', zone: 'paiements', from: [9, 0], to: [9, 1], bug: true },
  { key: 'PAY-402', summary: 'Rapport de rapprochement bancaire incomplet', zone: 'paiements', from: [1, 0], to: [1, 1], bug: true },
  { key: 'PAY-403', summary: 'Statut de paiement bloqué sur « en attente »', zone: 'paiements', from: [3, 0], to: [3, 2], bug: true },
  { key: 'PAY-501', summary: 'Agrégats du tableau de bord figés au jeudi', zone: 'reporting', from: [2, 0], to: [2, 1], bug: true },
  { key: 'PAY-701', summary: 'Libellé du bouton de validation tronqué', from: [1, 0], to: [1, 1], bug: true },
];

/** Les trois dettes du §7.1 : l’ancienne à 24-34 j-p, la remboursée, la récente. */
const MAIN_DEBTS: readonly FactSeed[] = [
  { key: 'PAY-77', summary: 'Supprimer le double système de calcul des taxes', type: 'Dette technique', size: 'xl', zone: 'facturation', from: [60, 0], to: null, debt: true, estimateJp: 8 },
  { key: 'PAY-41', summary: 'Rapatrier le remboursement des paiements partiels dans un seul service', type: 'Dette technique', size: 'xl', zone: 'paiements', from: [16, 0], to: [5, 4], debt: true, estimateJp: 5 },
  { key: 'PAY-90', summary: 'Sortir le calcul des agrégats de reporting du job nocturne', type: 'Dette technique', size: 'xl', zone: 'reporting', from: [3, 0], to: null, debt: true, estimateJp: 3 },
];

/** Les sept dettes mortes du §7.3 : closes depuis plus de six mois, sans preuve. */
const DEAD_DEBTS: readonly FactSeed[] = [
  { key: 'PAY-12', summary: 'Migrer le référentiel clients vers le nouveau schéma', type: 'Dette technique', size: 'l', zone: 'reporting', from: [60, 0], to: [54, 4], debt: true },
  { key: 'PAY-19', summary: 'Remplacer la bibliothèque de graphiques abandonnée', type: 'Dette technique', size: 'l', zone: 'reporting', from: [60, 0], to: [54, 4], debt: true },
  { key: 'PAY-23', summary: 'Découper le service de reporting en deux modules', type: 'Dette technique', size: 'l', zone: 'reporting', from: [60, 0], to: [54, 4], debt: true },
  { key: 'PAY-31', summary: 'Supprimer les appels synchrones entre services', type: 'Dette technique', size: 'l', zone: 'paiements', from: [60, 0], to: [54, 4], debt: true },
  { key: 'PAY-38', summary: 'Remplacer les fichiers de configuration dupliqués', type: 'Dette technique', size: 'l', zone: 'paiements', from: [60, 0], to: [54, 4], debt: true },
  { key: 'PAY-45', summary: 'Extraire les règles de facturation du contrôleur', type: 'Dette technique', size: 'l', zone: 'facturation', from: [60, 0], to: [54, 4], debt: true },
  { key: 'PAY-52', summary: 'Renommer les tables héritées du premier moteur', type: 'Dette technique', size: 'l', zone: 'facturation', from: [60, 0], to: [54, 4], debt: true },
];

/** Tous les tickets du jeu, dans un ordre stable. */
export function sampleFacts(anchor: string = SAMPLE_NOW): IssueFact[] {
  const seeds: readonly FactSeed[] = [
    ...INCIDENTS,
    ...FACTURATION_BUGS,
    ...FACTURATION_SLOW,
    ...STORY_REFERENCES,
    ...TASK_REFERENCES,
    ...NOTIFICATION_ISSUES,
    ...REWORK_BUGS,
    ...ISOLATED_ISSUES,
    ...MAIN_DEBTS,
    ...DEAD_DEBTS,
  ];
  return seeds.map((seed) => buildFact(seed, anchor));
}

/**
 * Séjours de statut (table `status_span`).
 *
 * Un ticket résolu passe tout son temps « en cours » : c’est la lecture la plus
 * favorable au lecteur, elle ne gonfle aucun coût. Les retouches portent leurs
 * séjours explicites (en cours → terminé → en cours), seules sources de C4.
 */
export function sampleSpans(facts: IssueFact[], anchor: string = SAMPLE_NOW): StatusSpan[] {
  const explicit = new Map<string, Array<[Day, Day, StatusCategory]>>();
  for (const seed of REWORK_BUGS) {
    if (seed.spans) explicit.set(seed.key, seed.spans);
  }
  const spans: StatusSpan[] = [];
  for (const fact of facts) {
    const custom = explicit.get(fact.key);
    if (custom) {
      for (const [from, to, category] of custom) {
        spans.push({ issueId: fact.issueId, category, startedAt: at(anchor, from), endedAt: at(anchor, to) });
      }
      continue;
    }
    if (fact.resolvedAt === null) continue;
    spans.push({ issueId: fact.issueId, category: 'inprogress', startedAt: fact.createdAt, endedAt: fact.resolvedAt });
  }
  return spans;
}

/** Un groupe de liens Jira : des tickets sources pointant vers une dette. */
interface LinkGroup {
  debtKey: string;
  type: string;
  sources: readonly string[];
}

/** Liens explicites du §10 : ils alimentent la fourchette basse de l’addition. */
const LINK_GROUPS: readonly LinkGroup[] = [
  { debtKey: 'PAY-77', type: 'caused by', sources: ['PAYSUP-101', 'PAYSUP-102', 'PAYSUP-103', 'PAYSUP-104'] },
  { debtKey: 'PAY-77', type: 'relates to', sources: ['PAY-201', 'PAY-202', 'PAY-203', 'PAY-204', 'PAY-205', 'PAY-206', 'PAY-207', 'PAY-208'] },
  { debtKey: 'PAY-41', type: 'caused by', sources: ['PAY-401'] },
  { debtKey: 'PAY-90', type: 'relates to', sources: ['PAY-501'] },
];

/** Liens Jira du jeu (table `issue_link`, lue par C5 et par l’attribution). */
export function sampleLinks(): IssueLink[] {
  const links: IssueLink[] = [];
  for (const group of LINK_GROUPS) {
    for (const source of group.sources) {
      links.push({
        fromIssueId: issueIdOf(source),
        toIssueId: issueIdOf(group.debtKey),
        toKey: group.debtKey,
        type: group.type,
      });
    }
  }
  return links;
}

/** Rapprochement proposé par le modèle (§10) : note et justification affichées. */
export interface ScoreRule {
  sourceKey: string;
  debtKey: string;
  relevance: number;
  rationale: string;
}

/** Rapprochement confirmé par un humain (§7.4) : entre dans la fourchette basse. */
export interface ConfirmationRule {
  sourceKey: string;
  debtKey: string;
  by: string;
}

/** Rapprochement rejeté (§7.4) : il n’est plus proposé. */
export interface RejectionRule {
  sourceKey: string;
  debtKey: string;
  rejectedBy: string;
}

/** Notes du modèle : les quatre tickets lents que seul le rapprochement explique. */
export const SAMPLE_SCORE_RULES: readonly ScoreRule[] = [
  { sourceKey: 'PAY-301', debtKey: 'PAY-77', relevance: 0.65, rationale: 'Sortir le calcul des taxes du moteur historique, même zone' },
  { sourceKey: 'PAY-302', debtKey: 'PAY-77', relevance: 0.7, rationale: 'Table des taux isolée : premier pas vers un seul moteur' },
  { sourceKey: 'PAY-303', debtKey: 'PAY-77', relevance: 0.7, rationale: 'Rejouer les factures historiques touche le calcul des taxes' },
  { sourceKey: 'PAY-304', debtKey: 'PAY-77', relevance: 0.75, rationale: 'Suppression du calculateur hérité, même zone' },
  { sourceKey: 'PAY-305', debtKey: 'PAY-77', relevance: 0.8, rationale: 'Unifier les arrondis suppose un seul moteur de taxes' },
  { sourceKey: 'PAY-306', debtKey: 'PAY-77', relevance: 0.85, rationale: 'Documenter le calcul des taxes, c’est décrire le double système' },
  { sourceKey: 'PAY-402', debtKey: 'PAY-41', relevance: 0.6, rationale: 'Rapprochement bancaire : le même service que le remboursement partiel' },
];

/** Confirmations humaines : un bug de `facturation` et un ticket lent de PAY-77. */
export const SAMPLE_CONFIRMATION_RULES: readonly ConfirmationRule[] = [
  { sourceKey: 'PAY-209', debtKey: 'PAY-77', by: 'Camille' },
];

/** Rejet : PAY-402 ne ressemble pas à PAY-90, l’équipe l’a dit. */
export const SAMPLE_REJECTION_RULES: readonly RejectionRule[] = [
  { sourceKey: 'PAY-402', debtKey: 'PAY-90', rejectedBy: 'Baptiste' },
];

/** Travail de remboursement de la dette close (§11) : début, clôture, publication. */
export interface RepaymentPlan {
  debtKey: string;
  workStartAt: string;
  publishedAt: string;
}

/** La dette déjà remboursée, seule à porter un bulletin (§7.5). */
export const SAMPLE_REPAID_DEBT_KEY = 'PAY-41';

/**
 * Plan du bulletin de remboursement : le travail a commencé le lundi de la
 * semaine -8, la dette a été close le vendredi de la semaine -5 et le bulletin
 * a été publié cinq semaines plus tard — assez de recul des deux côtés pour que
 * la comparaison porte sur des semaines réellement observées (§11).
 */
export function sampleRepaymentPlan(closedAt: string, anchor: string = SAMPLE_NOW): RepaymentPlan {
  return { debtKey: SAMPLE_REPAID_DEBT_KEY, workStartAt: at(anchor, [8, 0]), publishedAt: addDays(closedAt, 35) };
}
