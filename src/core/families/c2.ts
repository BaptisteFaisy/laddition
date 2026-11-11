/**
 * Famille C2 — bugs (§9).
 *
 * Un bug coûte le temps passé en statut « en cours », en jours ouvrés, pour une
 * personne. Sans historique de statuts, la durée est approchée (création →
 * résolution) et le coût est marqué « approximé » (§19). Le temps saisi, quand
 * il existe, remplace le calcul. Le coût est partagé entre les zones du ticket.
 *
 * Fonction pure : l'instant de référence vient de `ctx.now`, aucune I/O.
 */

import type { CostContext, CostMethod, Evidence, EvidenceDetail, IssueFact, StatusSpan } from '../types';
import { approximateDays, inProgressDays } from '../duration';
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
    const hasSpans = spans.length > 0;
    const durationDays = hasSpans ? inProgressDays(spans, ctx.now) : approximateDays(fact, ctx.now);
    const cost = bugCost(fact, durationDays, hasSpans, ctx.settings.hoursPerDay);
    const detail = buildDetail(fact, durationDays, cost, hasSpans, ctx.settings.hoursPerDay);

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
 * existe. `approximated` signale une durée déduite faute d'historique. Jamais
 * négatif.
 */
function bugCost(fact: IssueFact, durationDays: number, hasSpans: boolean, hoursPerDay: number): BugCost {
  const loggedJp = secondsToJp(fact.loggedSeconds, hoursPerDay);
  const raw = loggedJp ?? Math.max(0, durationDays) * 1;

  return {
    costJp: round2(Math.max(0, raw)),
    method: loggedJp !== null ? 'logged' : hasSpans ? 'computed' : 'approximated',
  };
}

/** Détail affiché au clic : formule, valeurs d'entrée, source. */
function buildDetail(
  fact: IssueFact,
  durationDays: number,
  cost: BugCost,
  hasSpans: boolean,
  hoursPerDay: number,
): EvidenceDetail {
  return {
    durationDays: round2(durationDays),
    method: cost.method,
    formula: formulaOf(fact, durationDays, cost, hasSpans, hoursPerDay),
    inputs: {
      durationDays: round2(durationDays),
      persons: 1,
      loggedSeconds: fact.loggedSeconds,
      statusHistory: hasSpans,
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
  hasSpans: boolean,
  hoursPerDay: number,
): string {
  const loggedJp = secondsToJp(fact.loggedSeconds, hoursPerDay);
  if (loggedJp !== null) {
    return (
      `temps saisi ${fmt(fact.loggedSeconds ?? 0)} s ÷ ${fmt(hoursPerDay)} h/j = ${fmt(loggedJp)} j-p ` +
      '(le temps saisi remplace le calcul)'
    );
  }

  const basis = hasSpans
    ? `${fmt(durationDays)} j ouvrés en cours`
    : `${fmt(durationDays)} j ouvrés (création → résolution, historique de statuts absent)`;
  return `${basis} × 1 personne = ${fmt(cost.costJp)} j-p`;
}

/** Nombre lisible : deux décimales au plus, virgule française. */
function fmt(value: number): string {
  return String(round2(value)).replace('.', ',');
}
