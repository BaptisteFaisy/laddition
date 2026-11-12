import { listAttributions, listBills } from '../platform/db/index';
import { invokeAction } from '../mcp/index';
import { nightlyRecalc } from './scheduled';
import { projectIdByKey } from './projects';
import type { ActionEnvelope } from '../mcp/result';

/**
 * Exercice des huit outils MCP du §13, sur données réelles.
 *
 * Chaque appel est rendu sous forme compacte (réussi/échoué + un chiffre clé) :
 * l'objectif est de prouver que la surface exposée à Rovo répond, pas de déverser
 * son contenu. La dernière étape confirme un rapprochement déduit et mesure ce
 * que la fourchette basse gagne — c'est la recette §20 n° 1 et n° 3.
 */

/** Résultat compact d'un appel d'outil. */
export interface ToolCall {
  tool: string;
  ok: boolean;
  /** Ce qui prouve que l'outil a travaillé, en une ligne. */
  summary: string;
}

/** Bilan de l'exercice complet. */
export interface McpExercise {
  projectKey: string;
  calls: ToolCall[];
  /** Tous les outils ont répondu sans erreur. */
  allOk: boolean;
}

/** Enchaîne les huit outils du §13 dans l'ordre du cahier des charges. */
export async function exerciseMcp(projectKey: string, issueKey: string, zone: string): Promise<McpExercise> {
  const calls: ToolCall[] = [
    await call('get-debt-ranking', { projectKey, limit: 5 }, summarizeRanking),
    await call('get-debt-bill', { issueKey }, summarizeBill),
    await call('get-zone-costs', { projectKey, zone }, summarizeZone),
    await call('list-phantom-debt', { projectKey }, summarizePhantom),
    await call('list-dead-debt', { projectKey }, summarizeDead),
    await call('get-repayment-report', { issueKey: 'PAY-41' }, summarizeRepayment),
    await call('draft-debt-ticket', { projectKey, zone: 'notifications' }, summarizeDraft),
  ];
  calls.push(await confirmOneMatch(projectKey));
  return { projectKey, calls, allOk: calls.every((item) => item.ok) };
}

/** Un appel d'outil, son résumé, et jamais d'exception remontée. */
async function call(
  tool: string,
  payload: Record<string, unknown>,
  summarize: (data: never) => string,
): Promise<ToolCall> {
  const result = (await invokeAction(tool, payload)) as ActionEnvelope<unknown>;
  if (!result.ok) return { tool, ok: false, summary: result.error };
  try {
    return { tool, ok: true, summary: (summarize as (data: unknown) => string)(result.data) };
  } catch (error) {
    return { tool, ok: true, summary: `réponse reçue, résumé illisible (${String(error)})` };
  }
}

/** Confirme un rapprochement déduit, recalcule, puis mesure le gain réel. */
async function confirmOneMatch(projectKey: string): Promise<ToolCall> {
  const projectId = await projectIdByKey(projectKey);
  if (!projectId) return { tool: 'confirm-evidence', ok: false, summary: 'projet non initialisé' };
  const target = await inferredTarget(projectId);
  if (!target) return { tool: 'confirm-evidence', ok: false, summary: 'aucun rapprochement déduit à confirmer' };
  const before = await lowBandOf(projectId, target.key);
  const result = (await invokeAction('confirm-evidence', {
    evidenceKey: target.evidenceId,
    debtKey: target.key,
    confirmed: true,
  })) as ActionEnvelope<unknown>;
  if (!result.ok) return { tool: 'confirm-evidence', ok: false, summary: result.error };
  // L'action ne calcule rien (§10) : c'est le recalcul qui fait entrer la
  // preuve confirmée dans la fourchette basse. Sans lui, rien ne bougerait.
  await nightlyRecalc();
  const after = await lowBandOf(projectId, target.key);
  await restoreInferred(projectId, target);
  const restored = await lowBandOf(projectId, target.key);
  return {
    tool: 'confirm-evidence',
    ok: true,
    summary:
      `${target.key} : fourchette basse ${before} → ${after} j-p après confirmation, ` +
      `remise à ${restored} après annulation (la sonde ne laisse pas de trace)`,
  };
}

/**
 * Annule la confirmation posée par la sonde, puis recalcule.
 *
 * Une sonde qui écrit laisse le site dans un état que personne n'a demandé :
 * constaté le 12/11 sur le site de démo, où la confirmation d'exercice faisait
 * passer PAY-41 de 1–2 à 2–2 j-p et rendait la recette §20 n°3 injouable — le
 * rapprochement était déjà confirmé. `recalc` est injectable pour les tests.
 */
export async function restoreInferred(
  projectId: string,
  target: { evidenceId: string; key: string },
  recalc: () => Promise<unknown> = nightlyRecalc,
): Promise<void> {
  await invokeAction('confirm-evidence', {
    evidenceKey: target.evidenceId,
    debtKey: target.key,
    confirmed: false,
  });
  await recalc();
}

/** Premier rapprochement déduit (fourchette haute seule) et sa dette cible. */
async function inferredTarget(projectId: string): Promise<{ evidenceId: string; key: string } | null> {
  const [attributions, bills] = await Promise.all([listAttributions(projectId), listBills(projectId)]);
  const inferred = attributions.find((item) => item.basis === 'inferred');
  if (!inferred) return null;
  const bill = bills.find((item) => item.debtIssueId === inferred.debtIssueId);
  return bill ? { evidenceId: inferred.evidenceId, key: bill.key } : null;
}

/** Fourchette basse actuelle d'une addition, ou `null` si absente. */
async function lowBandOf(projectId: string, key: string): Promise<number | null> {
  const bills = await listBills(projectId);
  return bills.find((item) => item.key === key)?.lowJp ?? null;
}

/* --------------------------------------------- résumés, un par outil (§13) */

function summarizeRanking(data: unknown): string {
  const typed = data as { total?: number; debts?: Array<{ key: string; lowJp: number; highJp: number }> };
  const first = typed.debts?.[0];
  return `${typed.debts?.length ?? 0}/${typed.total ?? 0} dette(s), tête : ${first?.key ?? '-'} ${first?.lowJp ?? 0}–${first?.highJp ?? 0} j-p`;
}

function summarizeBill(data: unknown): string {
  const typed = data as { debt?: { key: string }; bill?: { lowJp: number; highJp: number }; evidence?: unknown[] };
  return `${typed.debt?.key ?? '-'} : ${typed.bill?.lowJp ?? 0}–${typed.bill?.highJp ?? 0} j-p, ${typed.evidence?.length ?? 0} preuve(s)`;
}

function summarizeZone(data: unknown): string {
  const typed = data as {
    zone?: { zone?: string; totalJp?: number; weeklyJp?: number[] };
    trend?: { direction?: string };
    coveredByDebt?: boolean;
  };
  const zone = typed.zone ?? {};
  const couvert = typed.coveredByDebt ? 'couverte par une dette' : 'dette fantôme';
  return `zone ${zone.zone ?? '-'} : ${zone.totalJp ?? 0} j-p sur ${zone.weeklyJp?.length ?? 0} semaine(s), tendance ${typed.trend?.direction ?? '?'} (${couvert})`;
}

function summarizePhantom(data: unknown): string {
  const typed = data as { zones?: Array<{ zone: string; totalJp: number }> };
  const list = typed.zones ?? [];
  return `${list.length} zone(s) sans ticket : ${list.map((z) => `${z.zone} ${z.totalJp}`).join(', ') || '-'}`;
}

function summarizeDead(data: unknown): string {
  const typed = data as { debts?: Array<{ key: string; daysWithoutEvidence: number }> };
  return `${typed.debts?.length ?? 0} dette(s) morte(s)`;
}

function summarizeRepayment(data: unknown): string {
  const typed = data as { repayment?: { key: string; beforeRate: number; afterRate: number } };
  const r = typed.repayment;
  return r ? `${r.key} : ${r.beforeRate} → ${r.afterRate} j-p/semaine` : 'aucun bulletin';
}

function summarizeDraft(data: unknown): string {
  const typed = data as { summary?: string; description?: string };
  return `brouillon « ${typed.summary ?? '-'} » (${(typed.description ?? '').length} caractères)`;
}
