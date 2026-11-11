import type {
  Attribution,
  DebtBill,
  Evidence,
  IssueFact,
  ProjectSettings,
  RankedDebt,
  ZoneCost,
} from '../core/types.ts';
import { rankDebts } from '../core/ranking.ts';
import { addDays, weeksBetween } from '../core/time.ts';
import {
  listAttributions,
  listBills,
  listDebtIssues,
  listEvidence,
  listIssuesInWindow,
  listZoneWeeks,
} from '../platform/db/index.ts';
import { requireSettings } from '../jobs/projects.ts';

/**
 * Ce qu'un écran lit, en une lecture : réglages, tickets, preuves, additions.
 *
 * Aucun calcul lourd ici : les preuves et les additions sortent telles que le
 * calcul nocturne les a enregistrées (§15). Seuls le classement et les coûts de
 * zone sont repliés à la lecture — deux tris, aucune formule.
 */
export interface ProjectState {
  projectId: string;
  settings: ProjectSettings;
  facts: IssueFact[];
  debts: IssueFact[];
  evidence: Evidence[];
  attributions: Attribution[];
  bills: DebtBill[];
  ranking: RankedDebt[];
  /** Semaines ISO de la fenêtre d'analyse, de la plus ancienne à la plus récente. */
  weeks: string[];
  zoneCosts: ZoneCost[];
}

/** Charge l'état d'un projet sur sa fenêtre d'analyse. */
export async function loadState(projectId: string, now: string): Promise<ProjectState> {
  const settings = await requireSettings(projectId);
  const from = addDays(now, -settings.windowDays);
  const weeks = weeksBetween(from, now);
  const [inWindow, debts, evidence, attributions, bills, zoneCosts] = await Promise.all([
    listIssuesInWindow(projectId, from),
    listDebtIssues(projectId),
    listEvidence(projectId),
    listAttributions(projectId),
    listBills(projectId),
    listZoneWeeks(projectId, weeks),
  ]);
  return {
    projectId,
    settings,
    facts: mergeFacts(inWindow, debts),
    debts,
    evidence,
    attributions,
    bills,
    ranking: rankDebts(bills, debts),
    weeks,
    zoneCosts,
  };
}

/** Tickets de la fenêtre et tickets de dette, sans doublon. */
function mergeFacts(inWindow: IssueFact[], debts: IssueFact[]): IssueFact[] {
  const byId = new Map<string, IssueFact>();
  for (const fact of inWindow) byId.set(fact.issueId, fact);
  for (const debt of debts) if (!byId.has(debt.issueId)) byId.set(debt.issueId, debt);
  return [...byId.values()];
}
