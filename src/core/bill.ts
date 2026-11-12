/**
 * L'addition d'un ticket de dette (§9-§11, DT-06).
 *
 * `buildBill` rassemble les preuves rattachées à un ticket de dette et rend une
 * fourchette, une ventilation par famille et les indicateurs de retour.
 *
 * Quatre règles portent tout le module :
 * 1. **C5 ne paie jamais.** La famille C5 mesure un délai, pas de l'effort : elle
 *    n'entre ni dans la fourchette, ni dans la ventilation chiffrée, ni dans la
 *    liste des preuves de l'addition. Elle apparaît à zéro pour que la grille
 *    des familles reste complète à l'écran.
 * 2. **La fourchette basse est prudente.** Seules les attributions `link` et
 *    `confirmed` y entrent ; les `inferred` (rapprochements proposés par le
 *    modèle) n'ajoutent que de la fourchette haute. Une addition ne compte donc
 *    jamais une hypothèse comme un fait.
 * 3. **Jamais plus de 100 % d'une preuve** (principe 3 du §5). La somme des
 *    parts est plafonnée à la lecture : deux attributions sur la même preuve ne
 *    peuvent pas produire une addition supérieure au coût de la preuve.
 * 4. **Rien n'est jeté.** Une preuve inconnue, une part absurde, une estimation
 *    manquante : on ignore l'entrée et on continue, avec `null` là où le chiffre
 *    n'existe pas.
 *
 * Une dette sans zone n'a pas d'addition du tout : `buildBill` rend une addition
 * vide portée par `blockedReason: 'no-zone'`, l'écran demande un rattachement
 * (§19 cas 2) plutôt que d'afficher un chiffre qui ne veut rien dire.
 */

import type {
  Attribution,
  CostContext,
  DebtBill,
  Evidence,
  Family,
  FamilyTotal,
  IssueFact,
} from './types';
import { BILLED_FAMILIES } from './types';
import { round2 } from './time';
import { payback } from './payback';
import { maskHidden } from './privacy';
import { pointsToDays } from './units';
import { isUnclassified, zonesForIssue } from './zones';

/** Les cinq familles du §9, C5 comprise : la grille affichée reste complète. */
const ALL_FAMILIES: readonly Family[] = ['C1', 'C2', 'C3', 'C4', 'C5'];

/** Parts d'une même preuve : la basse (faits) et la haute (hypothèses). */
interface Share {
  /** Somme des parts `link` et `confirmed`, qui entrent dans la fourchette basse. */
  low: number;
  /** Somme des parts `inferred`, ajoutées uniquement à la fourchette haute. */
  high: number;
}

/** Une preuve retenue par l'addition, avec sa contribution aux deux bornes. */
interface CountedEvidence {
  evidence: Evidence;
  lowJp: number;
  highJp: number;
}

/** Accumulateur d'une famille pendant le parcours des preuves. */
interface FamilyAccumulator {
  lowJp: number;
  highJp: number;
  evidenceIds: Set<string>;
  insufficient: boolean;
}

/**
 * Addition d'un ticket de dette (§9-§11).
 *
 * @param debt le ticket de dette, source de la clé, des zones et du remboursement
 * @param evidence toutes les preuves connues ; seules celles attribuées comptent
 * @param attributions parts des preuves, tous tickets de dette confondus
 * @param ctx réglages du projet et instant de référence (aucune horloge implicite)
 */
export function buildBill(
  debt: IssueFact,
  evidence: Evidence[],
  attributions: Attribution[],
  ctx: CostContext,
): DebtBill {
  const repaymentJp = repaymentOf(debt, ctx);
  if (isZoneless(debt, ctx)) return blockedBill(debt, ctx, repaymentJp);

  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const counted = countEvidence(debt, evidenceById, attributions);
  const accumulators = accumulate(counted);
  const lowJp = round2(sumFamilies(accumulators, 'lowJp'));
  const highJp = round2(sumFamilies(accumulators, 'highJp'));
  const paybackResult = payback(lowJp, highJp, repaymentJp, ctx.settings);
  const masked = maskHidden(counted.map((item) => item.evidence));

  return {
    debtIssueId: debt.issueId,
    key: debt.key,
    computedAt: ctx.now,
    lowJp,
    highJp,
    byFamily: totalsOf(accumulators),
    evidenceIds: sortByCostDesc(counted),
    hiddenCount: masked.hiddenCount,
    repaymentJp,
    avoidableJp: paybackResult.avoidableJp,
    roiLow: paybackResult.roiLow,
    roiHigh: paybackResult.roiHigh,
    paybackDays: paybackResult.paybackDays,
    blockedReason: null,
  };
}

/** Vrai quand la dette n'est rattachée à aucune zone réelle (§19 cas 2). */
function isZoneless(debt: IssueFact, ctx: CostContext): boolean {
  return isUnclassified(zonesForIssue(debt, ctx.settings));
}

/**
 * Addition vide d'une dette sans zone : aucun chiffre, aucun retour, et le motif
 * qui permet à l'écran de demander un rattachement plutôt que d'afficher 0 j-p.
 */
function blockedBill(debt: IssueFact, ctx: CostContext, repaymentJp: number | null): DebtBill {
  return {
    debtIssueId: debt.issueId,
    key: debt.key,
    computedAt: ctx.now,
    lowJp: 0,
    highJp: 0,
    byFamily: totalsOf(emptyAccumulators()),
    evidenceIds: [],
    hiddenCount: 0,
    repaymentJp,
    avoidableJp: null,
    roiLow: null,
    roiHigh: null,
    paybackDays: null,
    blockedReason: 'no-zone',
  };
}

/**
 * Preuves retenues par l'addition : attribuées à ce ticket, connues, et d'une
 * famille facturable. C5 est écartée ici, une fois pour toutes.
 */
function countEvidence(
  debt: IssueFact,
  evidenceById: Map<string, Evidence>,
  attributions: Attribution[],
): CountedEvidence[] {
  const factors = capFactors(attributions);
  const shares = sharesByEvidence(debt.issueId, attributions, factors);
  const counted: CountedEvidence[] = [];
  for (const [evidenceId, share] of shares) {
    const item = evidenceById.get(evidenceId);
    if (!item || !isBilled(item.family)) continue;
    const cost = nonNegative(item.costJp);
    counted.push({ evidence: item, lowJp: cost * share.low, highJp: cost * (share.low + share.high) });
  }
  return counted;
}

/**
 * Facteur de plafonnement d'une preuve, tous tickets de dette confondus.
 *
 * Principe 3 du §5 : une preuve est répartie à 100 % au plus. Des parts dont la
 * somme dépasse 1 (double attribution, données sales) sont ramenées à 1 en
 * conservant leurs proportions : aucune addition ne dépasse le coût de la preuve.
 */
function capFactors(attributions: Attribution[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const attribution of attributions) {
    const share = unitShare(attribution.share);
    if (share === 0) continue;
    totals.set(attribution.evidenceId, (totals.get(attribution.evidenceId) ?? 0) + share);
  }
  const factors = new Map<string, number>();
  for (const [evidenceId, total] of totals) {
    factors.set(evidenceId, total > 1 ? 1 / total : 1);
  }
  return factors;
}

/** Somme des parts plafonnées par preuve, pour un seul ticket de dette. */
function sharesByEvidence(
  debtIssueId: string,
  attributions: Attribution[],
  factors: Map<string, number>,
): Map<string, Share> {
  const shares = new Map<string, Share>();
  for (const attribution of attributions) {
    if (attribution.debtIssueId !== debtIssueId) continue;
    const share = unitShare(attribution.share) * (factors.get(attribution.evidenceId) ?? 1);
    if (share <= 0) continue;
    const current = shares.get(attribution.evidenceId) ?? { low: 0, high: 0 };
    if (attribution.basis === 'inferred') current.high += share;
    else if (attribution.basis === 'link' || attribution.basis === 'confirmed') current.low += share;
    else continue;
    shares.set(attribution.evidenceId, current);
  }
  return shares;
}

/** Vrai quand la famille entre dans l'addition : tout sauf C5. */
function isBilled(family: Family): boolean {
  return BILLED_FAMILIES.includes(family);
}

/** Part bornée à [0, 1] ; une valeur illisible vaut 0. */
function unitShare(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value);
}

/** Coût utilisable : un coût absent ou négatif ne retire jamais d'argent. */
function nonNegative(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

/** Un accumulateur par famille, tous à zéro, C5 compris. */
function accumulate(counted: CountedEvidence[]): Map<Family, FamilyAccumulator> {
  const accumulators = emptyAccumulators();
  for (const item of counted) {
    const accumulator = accumulators.get(item.evidence.family);
    if (!accumulator) continue;
    accumulator.lowJp += item.lowJp;
    accumulator.highJp += item.highJp;
    accumulator.evidenceIds.add(item.evidence.id);
    if (item.evidence.insufficient === true) accumulator.insufficient = true;
  }
  return accumulators;
}

/** Un accumulateur vide par famille, C5 comprise. */
function emptyAccumulators(): Map<Family, FamilyAccumulator> {
  const accumulators = new Map<Family, FamilyAccumulator>();
  for (const family of ALL_FAMILIES) accumulators.set(family, emptyAccumulator());
  return accumulators;
}

/** Accumulateur vide, partagé comme valeur de repli. */
function emptyAccumulator(): FamilyAccumulator {
  return { lowJp: 0, highJp: 0, evidenceIds: new Set(), insufficient: false };
}

/** Somme d'un champ sur les seules familles facturables (C5 exclue). */
function sumFamilies(
  accumulators: Map<Family, FamilyAccumulator>,
  field: 'lowJp' | 'highJp',
): number {
  let total = 0;
  for (const family of BILLED_FAMILIES) {
    total += accumulators.get(family)?.[field] ?? 0;
  }
  return total;
}

/** Ventilation affichée : arrondie au centième, familles insuffisantes marquées. */
function totalsOf(accumulators: Map<Family, FamilyAccumulator>): Record<Family, FamilyTotal> {
  const totals = {} as Record<Family, FamilyTotal>;
  for (const family of ALL_FAMILIES) {
    const accumulator = accumulators.get(family) ?? emptyAccumulator();
    totals[family] = {
      lowJp: round2(accumulator.lowJp),
      highJp: round2(accumulator.highJp),
      evidenceCount: accumulator.evidenceIds.size,
      insufficient: accumulator.insufficient,
    };
  }
  return totals;
}

/**
 * Identifiants des preuves comptées, les plus coûteuses d'abord. À coût égal,
 * l'identifiant tranche : le même jeu de preuves donne toujours le même ordre.
 */
function sortByCostDesc(counted: CountedEvidence[]): string[] {
  return counted
    .slice()
    .sort((a, b) => {
      const difference = nonNegative(b.evidence.costJp) - nonNegative(a.evidence.costJp);
      if (difference !== 0) return difference;
      return compareText(a.evidence.id, b.evidence.id);
    })
    .map((item) => item.evidence.id);
}

/**
 * Remboursement chiffré du ticket (§11), `null` quand rien ne le chiffre.
 *
 * L'estimation en jours-personne passe en premier. À défaut, l'estimation en
 * points est convertie au rythme de l'équipe (`ctx.velocityPointsPerWeek`) : sans
 * vélocité mesurable, le remboursement reste « non chiffré » — jamais 0, car 0
 * afficherait un remboursement gratuit qui n'existe pas.
 */
function repaymentOf(debt: IssueFact, ctx: CostContext): number | null {
  const estimate = positiveOrNull(debt.estimateJp);
  if (estimate !== null) return round2(estimate);
  const points = positiveOrNull(debt.storyPoints ?? null);
  if (points === null) return null;
  const velocity = positiveOrNull(ctx.velocityPointsPerWeek ?? null);
  if (velocity === null) return null;
  return positiveOrNull(pointsToDays(points, velocity, ctx.settings.daysPerWeek));
}

/** Nombre fini et strictement positif, sinon `null`. */
function positiveOrNull(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Comparaison de texte indépendante de la locale, partagée avec `ranking.ts` :
 * un classement doit être identique sur toutes les machines (§18, stabilité).
 */
export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
