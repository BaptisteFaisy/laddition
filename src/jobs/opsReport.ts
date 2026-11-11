import type { Request } from '@forge/resolver';
import type { DataQuality, DeadDebt, PhantomDebt, Repayment } from '../core/types';
import {
  getProjectPage,
  listDeadDebt,
  listPhantomDebt,
  getRepaymentReport,
} from '../resolvers/read';
import { clearSampleData, loadSampleData } from '../resolvers/sample';
import { getDebtBill as panelGetDebtBill } from '../resolvers/billView';
import { getDebtBill as mcpGetDebtBill } from '../mcp/actions';
import type { DebtBillView } from '../ui/api';
import type { ProjectPageData } from '../resolvers/read';

/**
 * Lecture et injection des données d'exemple depuis le webtrigger d'exploitation.
 *
 * Les résolveurs sont appelés tels quels, avec une requête Forge reconstituée :
 * le rapport rendu ici est donc **exactement** celui que l'écran projet affiche
 * (recette §20 n° 9 : mêmes chiffres partout).
 */

/** Ce que rend le rapport : la page projet, plus les trois listes dédiées. */
export interface OpsReportData {
  page: ProjectPageData;
  phantom: PhantomDebt[];
  dead: DeadDebt[];
  repayments: Repayment[];
  quality: DataQuality;
}

/** Requête Forge minimale : les résolveurs ne lisent que `payload`. */
function fakeRequest(payload: Record<string, unknown>): Request<unknown> {
  return { payload, context: {} } as unknown as Request<unknown>;
}

/** Déballage d'une réponse de résolveur : `{ ok: false }` devient une erreur. */
function unwrap<T>(value: T | { ok: false; error: string }, what: string): T {
  if (typeof value === 'object' && value !== null && 'ok' in value && value.ok === false) {
    throw new Error(`${what} : ${value.error}`);
  }
  return value as T;
}

/** Injecte le jeu d'exemple du §22 dans la partition du projet visé. */
export async function injectSample(projectKey: string): Promise<unknown> {
  return unwrap(await loadSampleData(fakeRequest({ projectKey })), 'injection du jeu d\'exemple');
}

/** Retire le jeu d'exemple ; refuse sur un projet mesuré. */
export async function removeSample(projectKey: string): Promise<unknown> {
  return unwrap(await clearSampleData(fakeRequest({ projectKey })), 'retrait du jeu d\'exemple');
}

/**
 * Recette §20 n° 9 : `get-debt-bill` (outil MCP) doit rendre les mêmes chiffres
 * que le panneau du ticket (résolveur d'écran). On appelle les deux surfaces et
 * on compare, au lieu de le supposer.
 */
export interface BillComparison {
  issueKey: string;
  mcp: { lowJp: number; highJp: number; evidence: number; zone: string };
  panel: { lowJp: number; highJp: number; evidence: number; zone: string };
  identical: boolean;
}

/** Compare l'outil MCP et le panneau sur une dette donnée. */
export async function compareBill(issueKey: string): Promise<BillComparison> {
  const envelope = unwrap(await mcpGetDebtBill({ issueKey }), `outil MCP get-debt-bill(${issueKey})`);
  const tool = envelope.data;
  const panel = unwrap<DebtBillView>(
    await panelGetDebtBill(fakeRequest({ debtIssueId: tool.bill.debtIssueId, issueKey })),
    `panneau getDebtBill(${issueKey})`,
  );
  const mcp = {
    lowJp: tool.bill.lowJp,
    highJp: tool.bill.highJp,
    evidence: tool.evidence.length,
    zone: tool.debt.zone,
  };
  const ui = {
    lowJp: panel.bill.lowJp,
    highJp: panel.bill.highJp,
    evidence: panel.evidence.length,
    zone: panel.zone,
  };
  return { issueKey, mcp, panel: ui, identical: JSON.stringify(mcp) === JSON.stringify(ui) };
}

/**
 * Rapport complet d'un projet : classement, zones, dette fantôme, dette morte,
 * bulletins de remboursement et qualité des données.
 */
export async function readReport(projectKey: string): Promise<OpsReportData> {
  const request = fakeRequest({ projectKey });
  const page = unwrap<ProjectPageData>(await getProjectPage(request), 'page projet');
  const phantom = unwrap<PhantomDebt[]>(await listPhantomDebt(request), 'dette fantôme');
  const dead = unwrap<DeadDebt[]>(await listDeadDebt(request), 'dette morte');
  const repayments = unwrap<Repayment[]>(await getRepaymentReport(request), 'bulletins');
  return { page, phantom, dead, repayments, quality: page.quality };
}
