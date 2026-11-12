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
 * Phrase ajoutée à la formule quand la source n'expose aucune donnée PR
 * (item A14) : le repli est assumé et dit d'où vient le chiffre — le temps en
 * statut de revue lu dans les séjours de statut — sans jamais prétendre à une
 * source absente.
 */
const PR_FALLBACK_NOTE =
  ' PR refusées : source absente — repli assumé, le chiffre vient du temps' +
  ' passé en statut de revue (séjours de statut), pas de PR refusées.';

/**
 * Une pull request refusée, telle que le graphe peut l'exposer (§9 C4).
 *
 * Paramètre **optionnel** de `c4Rework` : `undefined` signifie « la source
 * n'expose pas les PR » et C4 assume alors explicitement le repli « temps en
 * statut de revue » (la formule de la preuve le dit). Une liste fournie —
 * même vide — signifie « le graphe expose les PR » : les refus s'ajoutent au
 * coût du ticket, et zéro refus est un fait, pas une absence de donnée.
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

/** D'où viennent les PR refusées d'une preuve : du graphe, ou de nulle part. */
interface PrSource {
  /** Vrai quand la source expose les PR (liste fournie, même vide). */
  provided: boolean;
  /** PR refusées du ticket, vides quand la source est absente. */
  prs: RejectedPullRequest[];
}

/**
 * C4 — retouches (§9).
 *
 * Un ticket rouvert puis retravaillé coûte le temps de reprise : les jours
 * ouvrés écoulés entre chaque réouverture et la résolution suivante. Le coût
 * est porté par une personne, puis partagé entre les zones du ticket.
 *
 * **PR refusées.** Le §9 les ajoute à ce temps de reprise. Elles arrivent en
 * paramètre optionnel : `undefined` (cas de `collectEvidence`, dont la source
 * n'expose pas les PR) active le **repli assumé** — le temps en statut de
 * revue, déjà compté dans les séjours de statut du ticket (le statut de revue
 * fait partie des statuts actifs). La formule de la preuve dit alors d'où
 * vient le chiffre : le temps en statut de revue, pas des PR refusées ;
 * l'entrée `prRefusees` vaut `null` (donnée absente) et jamais `0` (qui
 * prétendrait un fait mesuré). Liste fournie : le détail compte les refus.
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
  rejectedPrs?: RejectedPullRequest[],
): Evidence[] {
  const prsByIssue = groupRejectedPrs(rejectedPrs ?? []);
  const provided = rejectedPrs !== undefined;
  const evidence: Evidence[] = [];
  for (const fact of facts) {
    const spans = ctx.spansByIssue.get(fact.issueId) ?? [];
    const reouvertures = reworkCount(spans);
    const prSource: PrSource = { provided, prs: prsByIssue.get(fact.issueId) ?? [] };
    if (reouvertures === 0 && prSource.prs.length === 0) continue;
    if (!lastResolutionInWindow(fact, ctx)) continue;
    const joursReprise = reouvertures > 0 ? round2(reworkDays(spans, ctx.now)) : 0;
    const revueJp = reviewCost(prSource.prs);
    if (joursReprise <= 0 && revueJp <= 0) continue;
    const costJp = round2(joursReprise * REWORK_PEOPLE + revueJp);
    for (const share of splitAcrossZones(costJp, zonesForIssue(fact, ctx.settings))) {
      evidence.push(
        buildEvidence(fact, share.zone, round2(share.costJp), reouvertures, joursReprise, prSource, revueJp, ctx),
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
  prSource: PrSource,
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
      formula: formulaFor(fact, zone, costJp, reouvertures, joursReprise, prSource, ctx.settings.hoursPerDay),
      // Source PR absente : `null` (donnée absente), jamais `0` (fait mesuré).
      inputs: {
        reouvertures,
        joursReprise,
        prRefusees: prSource.provided ? prSource.prs.length : null,
        revueJp,
      },
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
  prSource: PrSource,
  hoursPerDay: number,
): string {
  const logged = loggedHint(fact.loggedSeconds, hoursPerDay);
  return (
    `${formulaParts(reouvertures, joursReprise, prSource.prs).join(' + ')} = ${costJp} j-p ;` +
    ` part de la zone « ${zone} » : ${costJp} j-p.` +
    ` Temps saisi du ticket${logged} non retenu : C4 mesure le temps de reprise,` +
    ` le temps saisi est déjà compté en C2/C3.` +
    (prSource.provided ? '' : PR_FALLBACK_NOTE)
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
