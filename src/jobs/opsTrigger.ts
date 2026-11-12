import type { WebTriggerRequest, WebTriggerResponse } from './smokeTrigger';
import {
  SETTINGS_PARAMS,
  opsBootstrap,
  opsInit,
  opsResetSchema,
  opsSchemaHealth,
  opsProgress,
  opsRecalc,
  opsRecalcAll,
  opsRepayments,
} from './ops';
import { compareBill, injectSample, readReport, removeSample } from './opsReport';
import { exerciseMcp } from './opsMcp';
import { exerciseScreens } from './opsScreens';
import { runProbe } from './opsValidate';
import { OpsAuthError, requireOpsToken, safeProjectKey } from './opsAuth';
import type { OpsReport } from './ops';
import { ensureReady } from './schema';
import { messageOf, nowIso } from './support';

/**
 * Webtrigger d'exploitation : pilote l'app sans navigateur.
 *
 * `?project=PAY&action=init|bootstrap|progress|recalc|repayments|sample|report|clear-sample`
 * `?action=recalc-all` (tous les projets)
 * `?action=screens` (toutes les surfaces de lecture ; `&llm=1` pour le modèle)
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
  'probe',
  'migrations',
  'schema-health',
  'reset-schema',
  'recalc-path',
  'write-path',
  'sql-forms',
  'screens',
] as const;

type Action = (typeof ACTIONS)[number];

/** Aiguille la requête vers l'opération demandée. */
export async function opsTriggerHandler(request: WebTriggerRequest): Promise<WebTriggerResponse> {
  try {
    requireOpsToken(request);
    const projectKey = safeProjectKey(firstParam(request, 'project'), DEFAULT_PROJECT_KEY);
    const action = (firstParam(request, 'action') ?? 'report') as Action;
    return json(await dispatch(action, projectKey, request));
  } catch (error) {
    // Une garde refusée rend 403, pas 500 : ce n'est pas une panne de l'app.
    const status = error instanceof OpsAuthError ? 403 : 500;
    return {
      statusCode: status,
      headers: { 'Content-Type': ['application/json; charset=utf-8'] },
      body: JSON.stringify(
        { ok: false, at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) },
        null,
        2,
      ),
    };
  }
}

/** Bilan d'échec, pour les actions inconnues. */
type FailureReport = { ok: false; action: string; error: string; at: string };

type Handler = (projectKey: string, request: WebTriggerRequest) => Promise<OpsReport<unknown> | FailureReport>;

/**
 * Une entrée par action : le dispatch reste une table, donc ajouter une action
 * ne fait grandir aucune fonction (règle des 50 lignes).
 */
const HANDLERS: Record<Action, Handler> = {
  init: (key, request) => opsInit(key, initPatch(request)),
  bootstrap: (key) => opsBootstrap(key),
  progress: (key) => opsProgress(key),
  recalc: (key) => opsRecalc(key),
  'recalc-all': () => opsRecalcAll(),
  repayments: () => opsRepayments(),
  sample: (key) => runAction('sample', () => injectSample(key)),
  'clear-sample': (key) => runAction('clear-sample', () => removeSample(key)),
  report: (key) => runAction('report', () => readReport(key)),
  bill: (key, request) => runAction('bill', () => compareBill(firstParam(request, 'key') ?? 'PAY-77')),
  mcp: (key, request) =>
    runAction('mcp', () =>
      exerciseMcp(
        key,
        firstParam(request, 'key') ?? 'PAY-77',
        firstParam(request, 'zone') ?? 'facturation',
      )),
  migrations: () => runAction('migrations', () => runProbe('migrations', '', 0)),
  'recalc-path': (key) => runAction('recalc-path', () => runProbe('recalc-path', key, 0)),
  'write-path': (key) => runAction('write-path', () => runProbe('write-path', key, 0)),
  'sql-forms': (key) => runAction('sql-forms', () => runProbe('sql-forms', key, 0)),
  'schema-health': () => opsSchemaHealth(),
  'reset-schema': () => opsResetSchema(),
  screens: (key, request) =>
    runAction('screens', () =>
      exerciseScreens(
        key,
        firstParam(request, 'key') ?? '',
        firstParam(request, 'zone') ?? '',
        firstParam(request, 'llm') === '1',
      ),
    ),
  probe: (key, request) =>
    runAction('probe', () =>
      runProbe(
        firstParam(request, 'probe') ?? 'throughput',
        key,
        Number(firstParam(request, 'sample') ?? '20'),
      )),
};

/** Exécute l'opération, ou rend l'aide si l'action est inconnue. */
async function dispatch(
  action: Action,
  projectKey: string,
  request: WebTriggerRequest,
): Promise<OpsReport<unknown> | FailureReport> {
  const handler = HANDLERS[action];
  if (!handler) {
    return {
      ok: false,
      action,
      at: new Date().toISOString(),
      error: `action inconnue. Actions disponibles : ${ACTIONS.join(', ')}`,
    };
  }
  return handler(projectKey, request);
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
export function initPatch(request: WebTriggerRequest): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const key of SETTINGS_PARAMS) {
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
