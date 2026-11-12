import type {
  Attribution,
  DebtBill,
  Evidence,
  IssueFact,
  ProjectSettings,
  RankedDebt,
  ZoneCost,
} from '../core/types';
import { rankDebts } from '../core/ranking';
import { addDays, weeksBetween } from '../core/time';
import { visibleKeysForUser } from '../platform/jira';
import {
  listAttributions,
  listBills,
  listDebtIssues,
  listEvidence,
  listIssuesInWindow,
  listZoneWeeks,
} from '../platform/db/index';
import { requireSettings } from '../jobs/projects';

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

/* ------------------------------------------------- droits du lecteur (§18) */

/** Lecture des clés visibles par le lecteur ; `null` quand elle échoue. */
export type VisibilityReader = (issueKeys: readonly string[]) => Promise<Set<string> | null>;

/** Issue de la lecture des droits du lecteur sur des preuves (item 4, §18). */
export interface ReaderRights {
  /** Preuves d'entrée ; celles hors des droits du lecteur portent `visible: false`. */
  evidence: Evidence[];
  /** Faux quand la lecture des droits a échoué : rien n'a été masqué à ce titre. */
  checked: boolean;
}

/**
 * Marque les preuves que le lecteur courant ne peut pas ouvrir (item 4, §18).
 *
 * La recherche au nom du lecteur ne rend que les tickets qu'il voit : une clé
 * absente du résultat vaut « masqué ». Une lecture en échec ne masque rien —
 * le doute n'efface pas les faits — mais `checked` reste faux, pour que le
 * résultat signale le trou au lieu de le taire.
 */
export async function withReaderRights(
  evidence: readonly Evidence[],
  read: VisibilityReader = visibleKeysForUser,
): Promise<ReaderRights> {
  const keys = [...new Set(evidence.map((item) => item.sourceKey).filter((key) => key.trim().length > 0))];
  const visible = await read(keys);
  if (visible === null) return { evidence: [...evidence], checked: false };
  return {
    evidence: evidence.map((item) =>
      item.sourceKey.trim().length > 0 && !visible.has(item.sourceKey) ? { ...item, visible: false } : item,
    ),
    checked: true,
  };
}
