/**
 * Résolveur de simulation (DT-21) : « si on rembourse ces N dettes, combien
 * de capacité revient ? »
 *
 * Adaptateur fin : il lit les chiffres **déjà stockés** (additions
 * `debt_bill`, bulletins `repayment`, tickets de dette) via la couche SQL, les
 * assemble, et délègue tout le travail à `core/simulation.ts` (pur). Aucun
 * coût n'est recalculé ici, aucune décision de modèle (principe 2 du §5) ;
 * chaque chiffre rendu porte sa méthode (principe 1 du §5).
 *
 * La clé du résolveur est exportée en constante : `src/ui/api.ts` et
 * `src/resolvers/index.ts` (non modifiables dans ce lot) la câbleront.
 */

import type { Request } from '@forge/resolver';
import type { DebtBill, IssueFact, Repayment } from '../core/types';
import type { SimulationDebtInput, SimulationResult } from '../core/simulation';
import { simulateRepayment as runSimulation } from '../core/simulation';
import type { Failure } from '../jobs/support';
import { guard, nowIso, payloadOf, requireString } from '../jobs/support';
import { listRepayments } from '../platform/db/index';
import { loadState } from './state';

/** Clé du résolveur, à câbler dans `RESOLVERS` et `src/ui/api.ts`. */
export const SIMULATION_RESOLVER_KEY = 'simulateRepayment';

/** Borne de la sélection : une simulation reste lisible et bon marché. */
export const MAX_SIMULATED_DEBTS = 50;

/** Ce que l'écran reçoit : le résultat pur, tel quel. */
export type SimulationView = SimulationResult;

/** Écran simulation : capacité retrouvée pour une sélection de dettes. */
export async function simulateRepayment(request: Request<unknown>): Promise<SimulationView | Failure> {
  return guard(async () => {
    const payload = payloadOf(request);
    const projectId = requireString(payload, 'projectId');
    const selectedIds = debtIdsOf(payload);
    const state = await loadState(projectId, nowIso());
    const bulletins = await listRepayments(projectId);
    return runSimulation({
      selectedIds,
      debts: inputsOf(state.debts, state.bills, bulletins),
    });
  });
}

/** Identifiants de la sélection : liste de chaînes non vides, bornée. */
function debtIdsOf(payload: Record<string, unknown>): string[] {
  const raw = payload['debtIssueIds'];
  if (!Array.isArray(raw)) {
    throw new Error('« debtIssueIds » doit être une liste d’identifiants de dette');
  }
  const ids = raw.filter((item): item is string => typeof item === 'string' && item.length > 0);
  if (ids.length === 0) throw new Error('« debtIssueIds » manquant ou vide');
  if (ids.length > MAX_SIMULATED_DEBTS) {
    throw new Error(`simulation bornée à ${MAX_SIMULATED_DEBTS} dettes : découper la sélection`);
  }
  return ids;
}

/** Rapproche les chiffres stockés : une entrée par dette connue du projet. */
function inputsOf(
  debts: readonly IssueFact[],
  bills: readonly DebtBill[],
  bulletins: readonly Repayment[],
): SimulationDebtInput[] {
  const billById = new Map<string, DebtBill>();
  for (const item of bills) billById.set(item.debtIssueId, item);
  const bulletinById = new Map<string, Repayment>();
  for (const item of bulletins) bulletinById.set(item.debtIssueId, item);
  return debts.map((fact) => ({
    debtIssueId: fact.issueId,
    key: fact.key,
    zone: fact.zones[0] ?? '',
    bill: billById.get(fact.issueId) ?? null,
    bulletin: bulletinById.get(fact.issueId) ?? null,
  }));
}
