import type { WebTriggerRequest, WebTriggerResponse } from './smokeTrigger';
import {
  opsBootstrap,
  opsInit,
  opsProgress,
  opsRecalc,
  opsRecalcAll,
  opsRepayments,
} from './ops';
import { compareBill, injectSample, readReport, removeSample } from './opsReport';
import { exerciseMcp } from './opsMcp';
import type { OpsReport } from './ops';
import { ensureReady } from './schema';
import { messageOf, nowIso } from './support';

/**
 * Webtrigger d'exploitation : pilote l'app sans navigateur.
 *
 * `?project=PAY&action=init|bootstrap|progress|recalc|repayments|sample|report|clear-sample`
 * `?action=recalc-all` (tous les projets)
 *
 * Un paramètre absent ou inconnu rend la liste des actions disponibles, jamais
 * un 500 : ce point d'entrée sert aussi à diagnostiquer.
 */

const DEFAULT_PROJECT_KEY = 'PAY';

const ACTIONS = [
  'init',
  'bootstrap',
  'progress',
  'recalc',
  'recalc-all',
  'repayments',
  'sample',
  'clear-sample',
  'report',
  'bill',
  'mcp',
] as const;

type Action = (typeof ACTIONS)[number];

/** Aiguille la requête vers l'opération demandée. */
export async function opsTriggerHandler(request: WebTriggerRequest): Promise<WebTriggerResponse> {
  const projectKey = firstParam(request, 'project') ?? DEFAULT_PROJECT_KEY;
  const action = (firstParam(request, 'action') ?? 'report') as Action;
  const report = await dispatch(action, projectKey, request);
  return json(report);
}

/** Exécute l'opération, ou rend l'aide si l'action est inconnue. */
async function dispatch(
  action: Action,
  projectKey: string,
  request: WebTriggerRequest,
): Promise<OpsReport<unknown> | { ok: false; action: string; error: string; at: string }> {
  switch (action) {
    case 'init':
      return opsInit(projectKey, initPatch(request));
    case 'bootstrap':
      return opsBootstrap(projectKey);
    case 'progress':
      return opsProgress(projectKey);
    case 'recalc':
      return opsRecalc(projectKey);
    case 'recalc-all':
      return opsRecalcAll();
    case 'repayments':
      return opsRepayments();
    case 'sample':
      return runAction('sample', () => injectSample(projectKey));
    case 'clear-sample':
      return runAction('clear-sample', () => removeSample(projectKey));
    case 'report':
      return runAction('report', () => readReport(projectKey));
    case 'bill':
      return runAction('bill', () => compareBill(firstParam(request, 'key') ?? 'PAY-77'));
    case 'mcp':
      return runAction('mcp', () =>
        exerciseMcp(
          projectKey,
          firstParam(request, 'key') ?? 'PAY-77',
          firstParam(request, 'zone') ?? 'facturation',
        ));
    default:
      return {
        ok: false,
        action,
        at: new Date().toISOString(),
        error: `action inconnue. Actions disponibles : ${ACTIONS.join(', ')}`,
      };
  }
}

/** Même enveloppe que `ops.runOps`, pour les actions qui vivent ailleurs. */
async function runAction<T>(action: string, body: () => Promise<T>): Promise<OpsReport<T>> {
  const at = nowIso();
  try {
    await ensureReady();
    return { ok: true, at, action, data: await body() };
  } catch (error) {
    return { ok: false, at, action, error: messageOf(error) };
  }
}

/**
 * Réglages passés en query string lors de l'initialisation, par exemple
 * `?action=init&debtRuleKind=label&debtRuleValue=tech-debt&zoneMode=component`.
 */
function initPatch(request: WebTriggerRequest): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const key of ['debtRuleKind', 'debtRuleValue', 'zoneMode', 'zoneLabelField']) {
    const value = firstParam(request, key);
    if (value) patch[key] = value;
  }
  return patch;
}

/** Première valeur d'un paramètre de query string, ou `null`. */
function firstParam(request: WebTriggerRequest, name: string): string | null {
  const values = (request.queryParameters ?? {})[name];
  const first = Array.isArray(values) ? values[0] : values;
  return typeof first === 'string' && first.trim().length > 0 ? first.trim() : null;
}

/** Réponse JSON uniforme, 200 quand l'opération a réussi. */
function json(report: { ok: boolean }): WebTriggerResponse {
  return {
    statusCode: report.ok ? 200 : 500,
    headers: { 'Content-Type': ['application/json; charset=utf-8'] },
    body: JSON.stringify(report, null, 2),
  };
}
