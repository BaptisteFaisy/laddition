/**
 * Famille C2 — bugs (§9).
 *
 * Un bug coûte le temps passé en statut « en cours », en jours ouvrés, pour une
 * personne. Sans historique de statuts, ou dans un workflow sans statut actif,
 * la durée est approchée (création → résolution) et le coût est marqué
 * « approximé » ; les deux situations sont distinguées dans le détail (§19).
 * Le temps saisi, quand il existe, remplace le calcul. Le coût est partagé
 * entre les zones du ticket.
 *
 * Fonction pure : l'instant de référence vient de `ctx.now`, aucune I/O.
 */

import type { CostContext, CostMethod, Evidence, EvidenceDetail, IssueFact, StatusSpan } from '../types';
import { approximateDays, durationBasis, inProgressDays } from '../duration';
import type { DurationBasis } from '../duration';
import { addDays, parseIso, round2, secondsToJp } from '../time';
import { splitAcrossZones, zonesForIssue } from '../zones';

/** Nom lisible de la famille, affiché dans le détail d'une preuve. */
const FAMILY_LABEL = 'Bugs';

/** Coût d'un bug avant partage entre ses zones. */
interface BugCost {
  costJp: number;
  method: CostMethod;
}

/**
 * Preuves C2 d'un lot de tickets : une preuve par zone et par bug retenu.
 * Retenus : bugs créés dans la fenêtre d'analyse.
 */
export function c2Bugs(facts: IssueFact[], ctx: CostContext): Evidence[] {
  const windowStart = addDays(ctx.now, -ctx.settings.windowDays);
  const evidence: Evidence[] = [];

  for (const fact of facts) {
    if (!fact.isBug) continue;
    if (!createdInWindow(fact, windowStart, ctx.now)) continue;

    const spans: StatusSpan[] = ctx.spansByIssue.get(fact.issueId) ?? [];
    const basis = durationBasis(spans);
    const durationDays = basis === 'active-status' ? inProgressDays(spans, ctx.now) : approximateDays(fact, ctx.now);
    const cost = bugCost(fact, durationDays, basis, ctx.settings.hoursPerDay);
    const detail = buildDetail(fact, durationDays, cost, basis, ctx.settings.hoursPerDay);

    for (const share of splitAcrossZones(cost.costJp, zonesForIssue(fact, ctx.settings))) {
      evidence.push({
        id: `C2:${fact.issueId}:${share.zone}`,
        zone: share.zone,
        family: 'C2',
        sourceIssueId: fact.issueId,
        sourceKey: fact.key,
        occurredAt: fact.resolvedAt ?? fact.createdAt,
        costJp: round2(Math.max(0, share.costJp)),
        method: cost.method,
        visible: fact.visible,
        detail,
      });
    }
  }

  return evidence;
}

/** Vrai quand le ticket a été créé dans [début de fenêtre, now]. */
function createdInWindow(fact: IssueFact, windowStartIso: string, nowIso: string): boolean {
  const createdAt = parseIso(fact.createdAt);
  const start = parseIso(windowStartIso);
  const end = parseIso(nowIso);
  if (!createdAt || !start || !end) return false;
  return createdAt.getTime() >= start.getTime() && createdAt.getTime() <= end.getTime();
}

/**
 * Coût d'un bug : durée × 1 personne, remplacé par le temps saisi quand il
 * existe. `approximated` signale une durée déduite faute d'historique ou faute
 * de statut actif. Jamais négatif.
 */
function bugCost(fact: IssueFact, durationDays: number, basis: DurationBasis, hoursPerDay: number): BugCost {
  const loggedJp = secondsToJp(fact.loggedSeconds, hoursPerDay);
  const raw = loggedJp ?? Math.max(0, durationDays) * 1;

  return {
    costJp: round2(Math.max(0, raw)),
    method: loggedJp !== null ? 'logged' : basis === 'active-status' ? 'computed' : 'approximated',
  };
}

/** Détail affiché au clic : formule, valeurs d'entrée, source. */
function buildDetail(
  fact: IssueFact,
  durationDays: number,
  cost: BugCost,
  basis: DurationBasis,
  hoursPerDay: number,
): EvidenceDetail {
  return {
    durationDays: round2(durationDays),
    method: cost.method,
    formula: formulaOf(fact, durationDays, cost, basis, hoursPerDay),
    inputs: {
      durationDays: round2(durationDays),
      persons: 1,
      loggedSeconds: fact.loggedSeconds,
      statusHistory: basis !== 'missing-history',
      durationBasis: basis,
    },
    familyLabel: FAMILY_LABEL,
    sourceSummary: fact.summary,
  };
}

/** Texte de la formule avec les valeurs réelles, affiché tel quel (§18). */
function formulaOf(
  fact: IssueFact,
  durationDays: number,
  cost: BugCost,
  basis: DurationBasis,
  hoursPerDay: number,
): string {
  const loggedJp = secondsToJp(fact.loggedSeconds, hoursPerDay);
  if (loggedJp !== null) {
    return (
      `temps saisi ${fmt(fact.loggedSeconds ?? 0)} s ÷ ${fmt(hoursPerDay)} h/j = ${fmt(loggedJp)} j-p ` +
      '(le temps saisi remplace le calcul)'
    );
  }

  return `${fmt(durationDays)} j ouvrés ${fallbackLabel(basis)} × 1 personne = ${fmt(cost.costJp)} j-p`;
}

/**
 * Origine de la durée, en clair : un historique absent n'est pas un workflow
 * sans statut actif, et le lecteur doit le voir (§19 cas 6).
 */
function fallbackLabel(basis: DurationBasis): string {
  if (basis === 'missing-history') return '(création → résolution, historique de statuts absent)';
  if (basis === 'no-active-status') return '(création → résolution, workflow sans statut actif)';
  return 'en cours';
}

/** Nombre lisible : deux décimales au plus, virgule française. */
function fmt(value: number): string {
  return String(round2(value)).replace('.', ',');
}
