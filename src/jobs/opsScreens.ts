import type { Request } from '@forge/resolver';
import { RESOLVERS } from '../resolvers/index';
import { ACTIONS } from '../mcp/registry';
import { invokeAction } from '../mcp/index';
import type { ActionEnvelope } from '../mcp/result';
import { projectIdByKey } from './projects';

/**
 * Sonde « tout est visible » : chaque surface de **lecture** répond sur le site.
 *
 * L'audit du 11/11 a trouvé des fonctionnalités livrées côté serveur et
 * invisibles côté écran (argumentaire DT-17, simulation DT-21). Un test unitaire
 * ne le voit pas : il faut appeler les résolveurs tels que les écrans les
 * appellent. Cette sonde joue donc toutes les clés de `RESOLVERS` et tous les
 * outils MCP en lecture, et rend une ligne par surface.
 *
 * Deux règles :
 * - **jamais d'écriture** : les clés qui modifient des données sont listées dans
 *   `skipped`, pas jouées ;
 * - **les surfaces qui appellent le modèle sont opt-in** (`llm=1`) : elles
 *   coûtent des jetons et des secondes, la sonde par défaut reste bornée.
 */

/** Clés de résolveur qui écrivent : la sonde ne les joue jamais. */
export const WRITE_RESOLVERS: readonly string[] = [
  'saveSettings',
  'loadSampleData',
  'clearSampleData',
  'startBootstrap',
  'confirmEvidence',
  'rejectEvidence',
  'draftDebtTicket',
];

/** Surfaces qui appellent le modèle : jouées seulement avec `llm=1`. */
export const LLM_SURFACES: readonly string[] = ['getDebtCase', 'previewDebtTicket', 'get-debt-case', 'draft-debt-ticket'];

/** Une surface jouée : ce qu'elle a rendu, en une ligne. */
export interface SurfaceCall {
  kind: 'écran' | 'outil';
  key: string;
  ok: boolean;
  summary: string;
}

/** Bilan de la sonde. */
export interface ScreensExercise {
  projectKey: string;
  calls: SurfaceCall[];
  /** Surfaces volontairement non jouées (écriture, ou modèle sans `llm=1`). */
  skipped: string[];
  allOk: boolean;
}

/** Ce dont les payloads ont besoin, lu une fois sur la page projet. */
interface ProbeContext {
  projectId: string;
  projectKey: string;
  issueKey: string;
  debtIssueId: string;
  zone: string;
  debtIssueIds: string[];
  /** Dette dont un bulletin est publié : sinon l'outil n'a rien à rendre. */
  repaymentKey: string;
}

/** Payload de chaque résolveur de lecture : les mêmes clés que `src/ui/api.ts`. */
const RESOLVER_PAYLOADS: Record<string, (context: ProbeContext) => Record<string, unknown>> = {
  getProjectPage: (c) => ({ projectId: c.projectId, projectKey: c.projectKey }),
  getDebtBill: (c) => ({ debtIssueId: c.debtIssueId }),
  getDebtCase: (c) => ({ issueKey: c.issueKey }),
  listPhantomDebt: (c) => ({ projectId: c.projectId, projectKey: c.projectKey }),
  listDeadDebt: (c) => ({ projectId: c.projectId }),
  getRepaymentReport: (c) => ({ projectId: c.projectId }),
  getSettings: (c) => ({ projectId: c.projectId, projectKey: c.projectKey }),
  getDataQuality: (c) => ({ projectId: c.projectId }),
  bootstrapProgress: (c) => ({ projectId: c.projectId }),
  previewDebtTicket: (c) => ({ projectKey: c.projectKey, zone: c.zone }),
  listZoneEvidence: (c) => ({ projectId: c.projectId, zone: c.zone }),
  listDebtAttributions: (c) => ({ debtIssueId: c.debtIssueId }),
  getIssueCost: (c) => ({ issueId: c.debtIssueId }),
  getGadgetData: (c) => ({ projectId: c.projectId, projectKey: c.projectKey }),
  getZoneCosts: (c) => ({ projectId: c.projectId, projectKey: c.projectKey, zone: c.zone }),
  simulateRepayment: (c) => ({ projectId: c.projectId, debtIssueIds: c.debtIssueIds }),
};

/** Valeurs disponibles pour les entrées déclarées par le registre MCP. */
const TOOL_VALUES: Record<string, (context: ProbeContext) => unknown> = {
  projectKey: (c) => c.projectKey,
  issueKey: (c) => c.issueKey,
  zone: (c) => c.zone,
  limit: () => 5,
};

/** Joue toutes les surfaces de lecture d'un projet initialisé. */
export async function exerciseScreens(
  projectKey: string,
  issueKey: string,
  zone: string,
  withLlm = false,
): Promise<ScreensExercise> {
  const projectId = await projectIdByKey(projectKey);
  if (!projectId) throw new Error(`projet « ${projectKey} » non initialisé`);
  const calls: SurfaceCall[] = [];
  const page = await callResolver('getProjectPage', { projectId, projectKey });
  calls.push(page.call);
  const context = contextOf(projectId, projectKey, issueKey, zone, page.data);
  for (const key of readResolvers()) {
    if (key === 'getProjectPage' || skip(key, withLlm)) continue;
    const payload = RESOLVER_PAYLOADS[key]?.(context) ?? {};
    const played = await callResolver(key, payload);
    calls.push(played.call);
    if (key === 'getRepaymentReport') context.repaymentKey = firstBulletinKey(played.data);
  }
  for (const key of readTools()) {
    if (skip(key, withLlm)) continue;
    calls.push(await callTool(key, toolPayload(key, context)));
  }
  return { projectKey, calls, skipped: skippedSurfaces(withLlm), allOk: calls.every((call) => call.ok) };
}

/** Clés de résolveur en lecture, dérivées du registre : aucune dérive possible. */
export function readResolvers(): string[] {
  return Object.keys(RESOLVERS).filter((key) => !WRITE_RESOLVERS.includes(key));
}

/** Outils MCP en lecture (verbe GET), dérivés du registre. */
export function readTools(): string[] {
  return Object.values(ACTIONS).filter((spec) => spec.verb === 'GET').map((spec) => spec.key);
}

/** Une surface est-elle écartée de ce passage ? */
function skip(key: string, withLlm: boolean): boolean {
  return !withLlm && LLM_SURFACES.includes(key);
}

/** Ce que la sonde ne joue pas, et pourquoi. */
function skippedSurfaces(withLlm: boolean): string[] {
  const writes = [...WRITE_RESOLVERS, 'confirm-evidence'].map((key) => `${key} (écriture)`);
  return withLlm ? writes : [...writes, ...LLM_SURFACES.map((key) => `${key} (modèle, llm=1)`)]
    .filter((value, index, all) => all.indexOf(value) === index);
}

/** Un appel de résolveur : jamais d'exception remontée, toujours une ligne. */
async function callResolver(
  key: string,
  payload: Record<string, unknown>,
): Promise<{ call: SurfaceCall; data: unknown }> {
  const handler = RESOLVERS[key];
  if (typeof handler !== 'function') {
    return { call: { kind: 'écran', key, ok: false, summary: 'résolveur absent' }, data: null };
  }
  try {
    const data = await handler(fakeRequest(payload));
    if (isFailure(data)) return { call: { kind: 'écran', key, ok: false, summary: data.error }, data: null };
    return { call: { kind: 'écran', key, ok: true, summary: summarize(data) }, data };
  } catch (error) {
    return { call: { kind: 'écran', key, ok: false, summary: text(error) }, data: null };
  }
}

/** Un appel d'outil MCP, résumé de la même façon. */
async function callTool(key: string, payload: Record<string, unknown>): Promise<SurfaceCall> {
  try {
    const result = (await invokeAction(key, payload)) as ActionEnvelope<unknown>;
    if (!result.ok) return { kind: 'outil', key, ok: false, summary: result.error };
    return { kind: 'outil', key, ok: true, summary: summarize(result.data) };
  } catch (error) {
    return { kind: 'outil', key, ok: false, summary: text(error) };
  }
}

/**
 * Payloads d'outils qui ne suivent pas les entrées génériques : le bulletin se
 * lit sur une dette close et remboursée, pas sur la tête du classement.
 */
const TOOL_PAYLOADS: Record<string, (context: ProbeContext) => Record<string, unknown>> = {
  'get-repayment-report': (c) => ({ issueKey: c.repaymentKey || c.issueKey }),
};

/** Payload d'un outil, construit depuis les entrées déclarées au registre. */
function toolPayload(key: string, context: ProbeContext): Record<string, unknown> {
  const override = TOOL_PAYLOADS[key];
  if (override) return override(context);
  const payload: Record<string, unknown> = {};
  for (const input of ACTIONS[key]?.inputs ?? []) {
    const provider = TOOL_VALUES[input];
    if (provider) payload[input] = provider(context);
  }
  return payload;
}

/** Identifiants lus sur la page projet : la sonde ne devine jamais une clé. */
function contextOf(
  projectId: string,
  projectKey: string,
  issueKey: string,
  zone: string,
  page: unknown,
): ProbeContext {
  const data = (page ?? {}) as {
    ranking?: Array<{ debtIssueId: string; key: string }>;
    zones?: Array<{ zone: string }>;
  };
  const ranking = data.ranking ?? [];
  return {
    projectId,
    projectKey,
    issueKey: issueKey || ranking[0]?.key || '',
    debtIssueId: ranking[0]?.debtIssueId ?? '',
    zone: zone || data.zones?.[0]?.zone || '',
    debtIssueIds: ranking.slice(0, 3).map((debt) => debt.debtIssueId).filter((id) => id.length > 0),
    repaymentKey: '',
  };
}

/** Clé de la première dette dont un bulletin est publié, sinon ''. */
function firstBulletinKey(data: unknown): string {
  if (!Array.isArray(data)) return '';
  const first = data[0] as { key?: unknown } | undefined;
  return typeof first?.key === 'string' ? first.key : '';
}

/** Requête Forge minimale : les résolveurs ne lisent que `payload`. */
function fakeRequest(payload: Record<string, unknown>): Request<unknown> {
  return { payload, context: {} } as unknown as Request<unknown>;
}

/** Une réponse de résolveur en échec (`{ ok: false, error }`). */
function isFailure(value: unknown): value is { ok: false; error: string } {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
}

/** Une ligne de résumé : assez pour prouver que la surface a travaillé. */
function summarize(data: unknown): string {
  if (data === null || data === undefined) return 'vide';
  if (Array.isArray(data)) return `${data.length} ligne(s)`;
  if (typeof data !== 'object') return String(data);
  const entries = Object.entries(data as Record<string, unknown>).slice(0, 3);
  const parts = entries.map(([key, value]) => `${key}=${short(value)}`);
  return parts.join(' ') || 'objet vide';
}

/** Valeur courte pour un résumé : une liste donne sa taille. */
function short(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} élément(s)`;
  if (typeof value === 'object' && value !== null) return '…';
  return String(value);
}

/** Texte d'une erreur, jamais `[object Object]`. */
function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
