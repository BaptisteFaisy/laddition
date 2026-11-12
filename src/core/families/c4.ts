import type { CostContext, Evidence, IssueFact } from '../types';
import { reworkCount, reworkDays } from '../duration';
import { addDays, parseIso, round2 } from '../time';
import { splitAcrossZones, zonesForIssue } from '../zones';

/** Famille « retouches » (§9, lot S). */
const FAMILY = 'C4' as const;
const FAMILY_LABEL = 'Retouches';

/** Une reprise est portée par une seule personne (§9). */
const REWORK_PEOPLE = 1;

/**
 * Une pull request refusée, telle que le graphe peut l'exposer (§9 C4).
 *
 * Paramètre **optionnel** : par défaut la liste est vide, et C4 se lit alors
 * dans le seul temps de reprise. Quand le graphe expose les PR, les refus
 * s'ajoutent au coût du ticket.
 */
export interface RejectedPullRequest {
  /** Ticket Jira auquel la PR se rattache. */
  issueId: string;
  /** Clé de la PR, rappelée dans la justification. */
  prKey: string;
  /** Jours ouvrés passés en revue (statut « en revue »). */
  reviewDays: number;
  /** Nombre de relecteurs ayant participé aux allers-retours ; 1 par défaut. */
  reviewers?: number;
}

/**
 * C4 — retouches (§9).
 *
 * Un ticket rouvert puis retravaillé coûte le temps de reprise : les jours
 * ouvrés écoulés entre chaque réouverture et la résolution suivante. Le coût
 * est porté par une personne, puis partagé entre les zones du ticket.
 *
 * **PR refusées.** Le §9 les ajoute à ce temps de reprise. Elles arrivent en
 * paramètre, liste vide par défaut : quand le graphe n'expose pas les PR, le
 * repli est le **temps en statut de revue**, déjà compté dans les séjours de
 * statut du ticket (le statut de revue fait partie des statuts actifs). Le
 * détail de la preuve dit lequel des deux a servi.
 *
 * Choix explicite : même quand `fact.loggedSeconds` est renseigné, C4 ne
 * remplace pas la mesure par le temps saisi. C4 chiffre le *temps de reprise*
 * (le retour en arrière), alors que le temps saisi du ticket est déjà compté
 * par C2 (bugs) et C3 (lenteur) ; le retenir ici compterait deux fois le même
 * travail. La formule affichée le dit au lecteur.
 */
export function c4Rework(
  facts: IssueFact[],
  ctx: CostContext,
  rejectedPrs: RejectedPullRequest[] = [],
): Evidence[] {
  const prsByIssue = groupRejectedPrs(rejectedPrs);
  const evidence: Evidence[] = [];
  for (const fact of facts) {
    const spans = ctx.spansByIssue.get(fact.issueId) ?? [];
    const reouvertures = reworkCount(spans);
    const prs = prsByIssue.get(fact.issueId) ?? [];
    if (reouvertures === 0 && prs.length === 0) continue;
    if (!lastResolutionInWindow(fact, ctx)) continue;
    const joursReprise = reouvertures > 0 ? round2(reworkDays(spans, ctx.now)) : 0;
    const revueJp = reviewCost(prs);
    if (joursReprise <= 0 && revueJp <= 0) continue;
    const costJp = round2(joursReprise * REWORK_PEOPLE + revueJp);
    for (const share of splitAcrossZones(costJp, zonesForIssue(fact, ctx.settings))) {
      evidence.push(
        buildEvidence(fact, share.zone, round2(share.costJp), reouvertures, joursReprise, prs, revueJp, ctx),
      );
    }
  }
  return evidence;
}

/** PR refusées regroupées par ticket. */
function groupRejectedPrs(prs: RejectedPullRequest[]): Map<string, RejectedPullRequest[]> {
  const grouped = new Map<string, RejectedPullRequest[]>();
  for (const pr of prs) {
    const list = grouped.get(pr.issueId) ?? [];
    list.push(pr);
    grouped.set(pr.issueId, list);
  }
  return grouped;
}

/**
 * Temps de revue des PR refusées, en jours-personne : jours de revue ×
 * relecteurs, pour chaque PR refusée du ticket.
 */
function reviewCost(prs: RejectedPullRequest[]): number {
  let total = 0;
  for (const pr of prs) {
    const days = Number.isFinite(pr.reviewDays) ? Math.max(0, pr.reviewDays) : 0;
    const people = pr.reviewers === undefined ? 1 : Math.max(0, pr.reviewers);
    total += days * people;
  }
  return round2(total);
}

/** La dernière résolution du ticket doit tomber dans la fenêtre d'analyse. */
function lastResolutionInWindow(fact: IssueFact, ctx: CostContext): boolean {
  const resolved = parseIso(fact.resolvedAt);
  const now = parseIso(ctx.now);
  if (!resolved || !now) return false;
  const start = parseIso(addDays(ctx.now, -ctx.settings.windowDays));
  if (!start) return false;
  return resolved.getTime() >= start.getTime() && resolved.getTime() <= now.getTime();
}

/** Construit la preuve d'une zone à partir du coût partagé. */
function buildEvidence(
  fact: IssueFact,
  zone: string,
  costJp: number,
  reouvertures: number,
  joursReprise: number,
  prs: RejectedPullRequest[],
  revueJp: number,
  ctx: CostContext,
): Evidence {
  return {
    id: `${FAMILY}:${fact.issueId}:${zone}`,
    zone,
    family: FAMILY,
    sourceIssueId: fact.issueId,
    sourceKey: fact.key,
    occurredAt: fact.resolvedAt ?? ctx.now,
    costJp,
    method: 'computed',
    visible: fact.visible,
    detail: {
      // Les deux termes sont des jours-personne : la reprise est portée par une
      // personne, la revue est déjà pondérée par ses relecteurs.
      durationDays: round2(joursReprise + revueJp),
      method: 'computed',
      formula: formulaFor(fact, zone, costJp, reouvertures, joursReprise, prs, ctx.settings.hoursPerDay),
      inputs: { reouvertures, joursReprise, prRefusees: prs.length, revueJp },
      familyLabel: FAMILY_LABEL,
      sourceSummary: fact.visible ? fact.summary : undefined,
    },
  };
}

/** Texte de formule lisible, valeurs incluses (transparence §18). */
function formulaFor(
  fact: IssueFact,
  zone: string,
  costJp: number,
  reouvertures: number,
  joursReprise: number,
  prs: RejectedPullRequest[],
  hoursPerDay: number,
): string {
  const logged = loggedHint(fact.loggedSeconds, hoursPerDay);
  return (
    `${formulaParts(reouvertures, joursReprise, prs).join(' + ')} = ${costJp} j-p ;` +
    ` part de la zone « ${zone} » : ${costJp} j-p.` +
    ` Temps saisi du ticket${logged} non retenu : C4 mesure le temps de reprise,` +
    ` le temps saisi est déjà compté en C2/C3.`
  );
}

/**
 * Termes de la formule : le temps de reprise lu dans les séjours de statut
 * (statut de revue compris), puis les PR refusées quand le graphe les expose.
 */
function formulaParts(
  reouvertures: number,
  joursReprise: number,
  prs: RejectedPullRequest[],
): string[] {
  const parts: string[] = [];
  if (reouvertures > 0) {
    parts.push(
      `${reouvertures} réouverture(s) × ${joursReprise} j ouvrés de reprise × ${REWORK_PEOPLE} personne` +
        ' (temps en statut de revue compris, lu dans les séjours de statut)',
    );
  }
  if (prs.length > 0) {
    parts.push(`PR refusée(s) ${prs.map(prText).join(', ')}`);
  }
  return parts.length > 0 ? parts : ['temps en statut de revue, lu dans les séjours de statut'];
}

/** Une PR refusée, en clair : jours de revue et relecteurs. */
function prText(pr: RejectedPullRequest): string {
  const jours = Number.isFinite(pr.reviewDays) ? Math.max(0, pr.reviewDays) : 0;
  const gens = pr.reviewers === undefined ? 1 : Math.max(0, pr.reviewers);
  return gens === 1 ? `${pr.prKey} : ${jours} j de revue` : `${pr.prKey} : ${jours} j de revue × ${gens} relecteur(s)`;
}

/** Rappel du temps saisi, sans jamais l'utiliser comme coût. */
function loggedHint(seconds: number | null, hoursPerDay: number): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return ' absent';
  return ` (${round2(seconds / 3600)} h pour ${hoursPerDay} h/j)`;
}
