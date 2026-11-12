/**
 * Simulation de remboursement (DT-21) : « si on rembourse ces N dettes,
 * combien de capacité revient ? »
 *
 * Module **pur** (aucun import `@forge/*`, aucune I/O, aucune horloge). Il
 * répond exclusivement par **addition de chiffres déjà calculés et stockés** :
 * - le coût évitable sur deux trimestres vient de `debt_bill.avoidableJp`
 *   (persistance déjà appliquée par le calcul nocturne, §11) ;
 * - la baisse hebdomadaire observée vient du bulletin `repayment` publié
 *   (`beforeRate − afterRate`, coût de zone en j-p par semaine) ;
 * - le coût du travail de remboursement vient de `debt_bill.repaymentJp`.
 *
 * Rien n'est recalculé, aucune décision de modèle (principe 2 du §5), et
 * chaque chiffre rendu porte sa méthode (principe 1 du §5) : `methodText`
 * explique d'où vient la valeur, `caveats` reprend les limites stockées du
 * bulletin. Deux unités différentes (j-p sur deux trimestres, j-p par semaine)
 * ne sont **jamais** additionnées entre elles.
 */

import type { DebtBill, Repayment } from './types';
import { round2 } from './time';

/**
 * Borne d'une simulation : au-delà, le tableau n'est plus lisible et la
 * sélection n'a plus de sens métier. Règle du domaine, donc partagée entre le
 * résolveur (qui refuse) et l'écran (qui n'envoie jamais plus).
 */
export const MAX_SIMULATED_DEBTS = 50;

/** D'où vient le chiffre d'une ligne de simulation. */
export type SimulationMethod =
  /** Bulletin de remboursement publié : baisse observée avant/après. */
  | 'observed'
  /** Addition stockée : coût évitable sur deux trimestres. */
  | 'avoidable'
  /** Dette connue mais sans chiffre stocké exploitable. */
  | 'unquantified'
  /** Identifiant absent du projet. */
  | 'unknown';

/** Une dette sélectionnée, avec ses chiffres déjà stockés. */
export interface SimulationDebtInput {
  debtIssueId: string;
  key: string;
  /** Zone du ticket de dette ; vide = « non classé ». */
  zone: string;
  /** Addition stockée (`debt_bill`), null si jamais calculée. */
  bill: DebtBill | null;
  /** Bulletin de remboursement publié, null si la dette n'est pas remboursée. */
  bulletin: Repayment | null;
}

/** Ce que la simulation reçoit : la sélection et les chiffres stockés. */
export interface SimulationInput {
  /** Identifiants sélectionnés ; les doublons sont ignorés, l'ordre est gardé. */
  selectedIds: readonly string[];
  /** Dettes connues du projet, avec leurs valeurs stockées. */
  debts: readonly SimulationDebtInput[];
}

/** Une ligne du tableau de simulation : une dette, ses chiffres, sa méthode. */
export interface SimulationRow {
  debtIssueId: string;
  key: string;
  zone: string;
  /** Vrai quand un bulletin de remboursement publié existe. */
  repaid: boolean;
  /** Coût évitable stocké sur deux trimestres (j-p) ; null si non chiffré. */
  avoidableJp: number | null;
  /** Baisse hebdomadaire observée (j-p/semaine) ; null sans bulletin. */
  observedWeeklyJp: number | null;
  /** Coût stocké du travail de remboursement (j-p) ; null si non chiffré. */
  repaymentJp: number | null;
  /** Délai de retour stocké (jours calendaires) ; null si non chiffré. */
  paybackDays: number | null;
  method: SimulationMethod;
  /** Texte de la méthode, avec ses valeurs : affiché tel quel (principe 1). */
  methodText: string;
  /** Limites stockées du bulletin, recopiées telles quelles ; vide sinon. */
  caveats: string[];
}

/** Totaux de la sélection. Les deux unités restent séparées. */
export interface SimulationTotals {
  selectedCount: number;
  /** Somme des coûts évitables stockés des dettes non remboursées (j-p). */
  avoidableJp: number;
  /** Somme des baisses hebdomadaires observées (j-p/semaine). */
  observedWeeklyJp: number;
  /** Somme des coûts stockés du travail de remboursement (j-p). */
  repaymentJp: number;
  /** Dettes sélectionnées sans chiffre exploitable (inconnues comprises). */
  unquantifiedCount: number;
}

/** Le résultat complet de la simulation. */
export interface SimulationResult {
  rows: SimulationRow[];
  totals: SimulationTotals;
}

/**
 * Construit le résultat : une ligne par identifiant sélectionné (dédoublonné,
 * ordre de la sélection conservé), puis les totaux. Ne jette jamais : une
 * valeur illisible devient `null` ou `0`, jamais `NaN`.
 */
export function simulateRepayment(input: SimulationInput): SimulationResult {
  const byId = new Map<string, SimulationDebtInput>();
  for (const debt of input.debts) byId.set(debt.debtIssueId, debt);
  const rows: SimulationRow[] = [];
  for (const id of dedupe(input.selectedIds)) {
    rows.push(buildRow(id, byId.get(id) ?? null));
  }
  return { rows, totals: totalsOf(rows) };
}

/** Identifiants non vides, sans doublon, ordre d'origine conservé. */
function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Une ligne : bulletin publié d'abord, sinon addition stockée, sinon rien. */
function buildRow(id: string, debt: SimulationDebtInput | null): SimulationRow {
  if (debt === null) {
    return {
      debtIssueId: id,
      key: id,
      zone: '',
      repaid: false,
      avoidableJp: null,
      observedWeeklyJp: null,
      repaymentJp: null,
      paybackDays: null,
      method: 'unknown',
      methodText: 'dette absente du projet : sélection inconnue, aucun chiffre',
      caveats: [],
    };
  }
  const bill = debt.bill;
  const bulletin = debt.bulletin;
  const observed = bulletin === null ? null : observedWeeklyOf(bulletin);
  const method: SimulationMethod =
    bulletin !== null ? 'observed' : storedOrNull(bill?.avoidableJp) !== null ? 'avoidable' : 'unquantified';
  return {
    debtIssueId: debt.debtIssueId,
    key: debt.key,
    zone: debt.zone,
    repaid: bulletin !== null,
    avoidableJp: storedOrNull(bill?.avoidableJp),
    observedWeeklyJp: observed,
    repaymentJp: storedOrNull(bill?.repaymentJp),
    paybackDays: storedOrNull(bill?.paybackDays),
    method,
    methodText: methodTextOf(method, bill, bulletin, observed),
    caveats: bulletin?.caveats ?? [],
  };
}

/** Baisse hebdomadaire observée : avant − après, jamais négative, jamais NaN. */
function observedWeeklyOf(bulletin: Repayment): number {
  const before = finiteOr(bulletin.beforeRate, 0);
  const after = finiteOr(bulletin.afterRate, 0);
  return round2(Math.max(0, before - after));
}

/** Valeur stockée exploitable : finie et strictement positive, sinon null. */
function storedOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return null;
  return round2(value);
}

/** Nombre fini, sinon la valeur de repli. */
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Texte de la méthode, avec les valeurs stockées qu'il cite (principe 1). */
function methodTextOf(
  method: SimulationMethod,
  bill: DebtBill | null | undefined,
  bulletin: Repayment | null,
  observed: number | null,
): string {
  if (method === 'observed' && bulletin !== null) {
    const before = round2(finiteOr(bulletin.beforeRate, 0));
    const after = round2(finiteOr(bulletin.afterRate, 0));
    if (observed !== null && observed > 0) {
      return `bulletin publié : ${before} − ${after} = ${observed} j-p par semaine (coût de zone avant − après)`;
    }
    return `bulletin publié : aucune baisse observée (avant ${before}, après ${after} j-p par semaine)`;
  }
  if (method === 'avoidable') {
    return `addition stockée : ${storedOrNull(bill?.avoidableJp)} j-p évités sur deux trimestres (persistance déjà appliquée)`;
  }
  if (bill === null || bill === undefined) {
    return 'aucune addition stockée : capacité non chiffrable';
  }
  return 'addition stockée sans coût évitable chiffré (addition basse nulle ou absente)';
}

/** Totaux : les dettes déjà remboursées ne comptent que dans l'observé. */
function totalsOf(rows: readonly SimulationRow[]): SimulationTotals {
  let avoidable = 0;
  let observed = 0;
  let repayment = 0;
  let unquantified = 0;
  for (const row of rows) {
    if (row.method === 'avoidable') avoidable += row.avoidableJp ?? 0;
    if (row.method === 'observed') observed += row.observedWeeklyJp ?? 0;
    if (!row.repaid) repayment += row.repaymentJp ?? 0;
    if (row.method === 'unquantified' || row.method === 'unknown') unquantified += 1;
  }
  return {
    selectedCount: rows.length,
    avoidableJp: round2(avoidable),
    observedWeeklyJp: round2(observed),
    repaymentJp: round2(repayment),
    unquantifiedCount: unquantified,
  };
}
