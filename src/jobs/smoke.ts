import { asApp, requestJira, route } from '@forge/api';
import { pushQueueMessage } from './recalcQueue';
import { ensureSchema, isSchemaReady } from '../platform/db/index';
import { getSettings } from '../platform/db/repos/project';
import { makeSettings } from '../core/settings';
import { buildBill } from '../core/bill';
import { rankDebts } from '../core/ranking';
import { attributeEvidence } from '../core/attribution';
import { collectEvidence } from '../core/families/index';
import type { CostContext, IssueFact, IssueLink } from '../core/types';
import { toIssueFact, isDebtIssue, searchIssues } from '../platform/jira';

/**
 * Diagnostic de bout en bout, exposé par un `webtrigger` (`index.smokeTest`).
 *
 * Objectif : prouver que l'app s'exécute réellement sur le runtime Forge,
 * sans navigateur. Chaque étape rend son verdict et sa durée, et aucune
 * exception ne sort : un échec est une donnée du rapport, pas un 500.
 */
export type StepResult = { step: string; ok: boolean; ms: number; detail: string };

export type SmokeReport = {
  app: string;
  generatedAt: string;
  steps: StepResult[];
  ok: boolean;
};

const APP_NAME = "L'addition";

/** Enchaîne les étapes du diagnostic, chacune isolée et chronométrée. */
export async function smokeTest(projectKey: string): Promise<SmokeReport> {
  const steps: StepResult[] = [];
  await step(steps, 'schema-sql', ensureSchemaStep);
  await step(steps, 'file-events', queueStep);
  await step(steps, 'lecture-jira', () => jiraStep(projectKey));
  await step(steps, 'calcul-domaine', () => domainStep(projectKey));
  return {
    app: APP_NAME,
    generatedAt: new Date().toISOString(),
    steps,
    ok: steps.every((item) => item.ok),
  };
}

/** Une étape : jamais d'exception remontée, toujours une durée et un détail. */
async function step(
  steps: StepResult[],
  name: string,
  body: () => Promise<string>,
): Promise<void> {
  const started = Date.now();
  try {
    const detail = await body();
    steps.push({ step: name, ok: true, ms: Date.now() - started, detail });
  } catch (error) {
    steps.push({
      step: name,
      ok: false,
      ms: Date.now() - started,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Forge SQL : création des tables si besoin, puis relecture. */
async function ensureSchemaStep(): Promise<string> {
  await ensureSchema();
  const ready = await isSchemaReady();
  if (!ready) throw new Error('tables introuvables après ensureSchema()');
  return 'tables prêtes';
}

/**
 * File Forge Events : pousser un message d'initialisation doit fonctionner,
 * sinon la barre de progression (DT-12) ne démarre jamais. L'erreur complète
 * est remontée : un simple « 400 » ne dit pas laquelle des causes c'est.
 */
async function queueStep(): Promise<string> {
  try {
    await pushQueueMessage({ projectId: 'smoke', nextPageToken: '' });
    return 'message poussé';
  } catch (error) {
    throw new Error(describeError(error));
  }
}

/** Détail maximal d'une erreur Forge : nom, message, et corps de la réponse. */
function describeError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const record = error as Record<string, unknown>;
  const parts = [
    typeof record['name'] === 'string' ? record['name'] : '',
    typeof record['message'] === 'string' ? record['message'] : '',
    record['details'] !== undefined ? `details=${JSON.stringify(record['details'])}` : '',
    record['code'] !== undefined ? `code=${String(record['code'])}` : '',
  ].filter((part) => part.length > 0);
  return parts.join(' | ') || JSON.stringify(record).slice(0, 400);
}

/** REST Jira en tant qu'app : le projet existe-t-il, combien de tickets ? */
async function jiraStep(projectKey: string): Promise<string> {
  const asAppClient = asApp();
  const response = await asAppClient.requestJira(
    route`/rest/api/3/project/${encodeURIComponent(projectKey)}`,
  );
  if (!response.ok) throw new Error(`projet ${projectKey} : HTTP ${response.status}`);
  const project = (await response.json()) as { key?: string; name?: string };
  const found = await searchIssues(
    `project = ${projectKey} ORDER BY created DESC`,
    ['summary', 'issuetype', 'labels', 'components', 'created', 'resolutiondate'],
    20,
  );
  const count = found?.issues.length ?? 0;
  return `projet ${project.key ?? projectKey} (${project.name ?? '?'}) : ${count} ticket(s) lu(s)`;
}

/** Le domaine tourne sur des données réelles : preuves, attributions, additions. */
async function domainStep(projectKey: string): Promise<string> {
  const settings = makeSettings('smoke', projectKey);
  const found = await searchIssues(
    `project = ${projectKey} ORDER BY created DESC`,
    ['summary', 'issuetype', 'labels', 'components', 'created', 'resolutiondate', 'aggregatetimespent'],
    20,
  );
  const issues = found?.issues ?? [];
  const facts: IssueFact[] = issues
    .map((issue) => toIssueFact(issue, settings))
    .filter((fact): fact is IssueFact => fact !== null);
  const debts = facts.filter((fact) => isDebtIssue({ id: fact.issueId, key: fact.key, fields: { issuetype: { id: '', name: fact.type }, labels: fact.labels } }, settings));
  const ctx: CostContext = {
    settings,
    now: new Date().toISOString(),
    baselines: new Map(),
    spansByIssue: new Map(),
  };
  const evidence = collectEvidence(facts, ctx, [] as IssueLink[]);
  const attributions = attributeEvidence(evidence, debts, [], [], settings, []);
  const bills = debts.map((debt) => buildBill(debt, evidence, attributions, ctx));
  const ranking = rankDebts(bills, debts);
  const savedSettings = await getSettings('smoke');
  return [
    `${facts.length} ticket(s) analysé(s)`,
    `${debts.length} dette(s)`,
    `${evidence.length} preuve(s)`,
    `${attributions.length} attribution(s)`,
    `${ranking.length} ligne(s) de classement`,
    savedSettings ? 'réglages lus en base' : 'aucun réglage en base (normal au premier passage)',
  ].join(' · ');
}
