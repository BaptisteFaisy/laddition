/**
 * Classement des tickets de dette (DT-07).
 *
 * L'écran « L'addition » présente les dettes de la plus chère à la moins chère.
 * Le classement est **totalement ordonné** : à addition basse égale on départage
 * par addition haute, puis par clé de ticket. Deux exécutions sur les mêmes
 * données donnent donc exactement le même ordre — sans quoi l'écran bougerait
 * tout seul d'un rafraîchissement à l'autre (§18, stabilité).
 */

import type { DebtBill, IssueFact, RankedDebt } from './types.ts';
import { UNCLASSIFIED_ZONE } from './zones.ts';
import { compareText } from './bill.ts';

/**
 * Classe les additions d'un projet (DT-07).
 *
 * @param bills additions calculées par `buildBill`
 * @param debts tickets de dette, source du résumé et de la zone affichés
 * @returns une ligne par addition, la plus coûteuse d'abord
 */
export function rankDebts(bills: DebtBill[], debts: IssueFact[]): RankedDebt[] {
  const debtById = new Map(debts.map((debt) => [debt.issueId, debt]));
  return bills.map((bill) => toRow(bill, debtById.get(bill.debtIssueId))).sort(compareRows);
}

/** Ligne de classement : l'addition, complétée par le ticket quand il est connu. */
function toRow(bill: DebtBill, debt: IssueFact | undefined): RankedDebt {
  return {
    debtIssueId: bill.debtIssueId,
    key: bill.key,
    summary: debt?.summary ?? '',
    zone: debt?.zones[0] ?? UNCLASSIFIED_ZONE,
    lowJp: bill.lowJp,
    highJp: bill.highJp,
    repaymentJp: bill.repaymentJp,
    roiLow: bill.roiLow,
    roiHigh: bill.roiHigh,
    paybackDays: bill.paybackDays,
  };
}

/**
 * Ordre du classement : addition basse décroissante, puis addition haute
 * décroissante, puis clé alphabétique. Le troisième critère garantit qu'aucune
 * paire de lignes n'est à égalité.
 */
function compareRows(a: RankedDebt, b: RankedDebt): number {
  const byLow = compareDescending(a.lowJp, b.lowJp);
  if (byLow !== 0) return byLow;
  const byHigh = compareDescending(a.highJp, b.highJp);
  if (byHigh !== 0) return byHigh;
  return compareText(a.key, b.key);
}

/** Compare deux nombres du plus grand au plus petit ; un nombre illisible vaut 0. */
function compareDescending(a: number, b: number): number {
  const left = Number.isFinite(a) ? a : 0;
  const right = Number.isFinite(b) ? b : 0;
  return right - left;
}
