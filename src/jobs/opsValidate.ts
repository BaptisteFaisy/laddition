import { fetchChangelog, fetchIssue, searchIssues } from '../platform/jira';
import type { Attribution, Baseline, DebtBill, Evidence } from '../core/types';
import {
  getSettings,
  listAttributions,
  replaceAttributions,
  replaceBaselines,
  replaceEvidence,
  upsertBill,
  upsertZoneWeek,
  listBaselines,
  listBills,
  listDebtIssues,
  listEvidence,
  listIssuesInWindow,
  listStatusSpans,
  listZoneWeeks,
} from '../platform/db/index';
import { projectIdByKey } from './projects';
import { clearInvalidBefore } from './invalidation';
import { runSchemaMigrations } from '../platform/db/index';
import { listScores, saveScores } from '../platform/db/repos/scores';
import { purgeProject } from '../platform/db/repos/purge';
import { runStatement } from '../platform/db/query';
import { purgeDisappearedZones } from './zoneLifecycle';
import { ensureDebtCostField, writeDebtCost } from '../platform/field';
import { fetchIncidentServices, fetchTeamByComponent, fetchZoneLinks } from '../platform/graph';
import { BOOTSTRAP_FIELDS } from './consumer';
import { requireSettings } from './projects';
import type { ProjectSettings } from '../core/types';

/**
 * Validations du §17 : ce que le cahier des charges demande de vérifier par un
 * prototype avant de construire. Chaque sonde rend un verdict mesuré, jamais une
 * supposition — c'est ce qui alimente `docs/VALIDATIONS.md`.
 */

/** Résultat d'une sonde : ce qui a été mesuré, et ce qu'on en conclut. */
export interface Probe {
  name: string;
  ok: boolean;
  /** Mesures brutes, lisibles telles quelles. */
  measures: Record<string, number | string | boolean>;
  /** Conclusion pour le §17 : on garde, ou on prend le repli. */
  verdict: string;
}

/** Taille de l'échantillon par défaut des sondes. */
const DEFAULT_SAMPLE = 20;

/** Budget du recalcul nocturne (§18) : 15 minutes pour 5 000 tickets. */
const NIGHTLY_BUDGET_MS = 15 * 60 * 1000;
const NIGHTLY_TARGET_ISSUES = 5000;

/** Lance la sonde demandée ; une sonde inconnue rend la liste des connues. */
export async function runProbe(probe: string, projectKey: string, sample: number): Promise<Probe> {
  switch (probe) {
    case 'throughput':
      return probeThroughput(projectKey, sample);
    case 'field':
      return probeFieldWrite(projectKey, sample);
    case 'graph':
      return probeTeamworkGraph(projectKey);
    case 'migrations':
      return probeMigrations();
    case 'recalc-path':
      return probeRecalcPath(projectKey);
    case 'write-path':
      return probeWritePath(projectKey);
    case 'sql-forms':
      return probeSqlForms(projectKey);
    default:
      return {
        name: probe,
        ok: false,
        measures: {},
        verdict: 'sonde inconnue ; disponibles : throughput, field, graph',
      };
  }
}

/**
 * §17 « Volume et débit de lecture des historiques ».
 * Lit un échantillon de tickets avec leur historique et extrapole au budget de
 * 15 minutes pour 5 000 tickets (§18).
 */
export async function probeThroughput(projectKey: string, sample: number): Promise<Probe> {
  const settings = await projectSettingsOf(projectKey);
  const size = Math.max(1, Math.min(sample || DEFAULT_SAMPLE, 50));
  // Sondage hors fenêtre de 180 jours : le site de démo a un historique ancien,
  // et ce qu'on mesure ici est le débit de lecture, pas la fraîcheur.
  const page = await searchIssues(
    `project = ${quoteProjectKey(settings.projectKey)} ORDER BY updated DESC`,
    BOOTSTRAP_FIELDS,
    size,
  );
  const issues = page?.issues ?? [];
  const started = Date.now();
  let histories = 0;
  let entries = 0;
  let failed = 0;
  for (const issue of issues) {
    const log = await fetchChangelog(issue.key);
    if (log === null) failed += 1;
    else {
      histories += 1;
      entries += log.length;
    }
  }
  const elapsed = Date.now() - started;
  return throughputVerdict(issues.length, histories, entries, failed, elapsed);
}

/** Extrapolation et verdict de la sonde de débit. */
function throughputVerdict(
  read: number,
  histories: number,
  entries: number,
  failed: number,
  elapsed: number,
): Probe {
  const perIssue = read > 0 ? Math.round(elapsed / read) : 0;
  const projected = perIssue * NIGHTLY_TARGET_ISSUES;
  const fits = projected <= NIGHTLY_BUDGET_MS;
  return {
    name: 'throughput',
    ok: read > 0 && failed === 0,
    measures: {
      ticketsLus: read,
      historiquesOk: histories,
      historiquesEchoues: failed,
      entreesDHistorique: entries,
      msTotal: elapsed,
      msParTicket: perIssue,
      projetePour5000Tickets: `${Math.round(projected / 60000)} min`,
    },
    verdict: fits
      ? `le budget de 15 min tient pour ${NIGHTLY_TARGET_ISSUES} tickets (${Math.round(projected / 60000)} min projetées) : lots de 50 conservés`
      : `le budget de 15 min est dépassé (${Math.round(projected / 60000)} min projetées) : appliquer le repli du §17 (fenêtre réduite à 90 jours, lots plus petits)`,
  };
}

/**
 * §17 « Écriture en masse d'un champ d'app en lecture seule ».
 * Crée le champ s'il manque, écrit sur un échantillon de tickets, et dit si le
 * repli (propriété de ticket indexée) est nécessaire.
 */
export async function probeFieldWrite(projectKey: string, sample: number): Promise<Probe> {
  const settings = await projectSettingsOf(projectKey);
  const setup = await ensureDebtCostField(settings.projectKey);
  if (!setup.ok || !setup.fieldId) {
    return {
      name: 'field',
      ok: false,
      measures: { raison: setup.reason ?? 'champ non créé' },
      verdict: 'repli à appliquer : propriété de ticket indexée pour JQL (§17)',
    };
  }
  const page = await searchIssues(
    `project = ${quoteProjectKey(settings.projectKey)} ORDER BY created DESC`,
    ['summary'],
    Math.min(sample || DEFAULT_SAMPLE, 50),
  );
  const keys = (page?.issues ?? []).map((issue) => issue.key);
  const values = new Map(keys.map((key, index) => [key, index % 5]));
  const outcome = keys.length > 0 ? await writeDebtCost(keys, values, setup.fieldId) : null;
  return fieldVerdict(setup.fieldId, keys.length, outcome?.updated.length ?? 0, outcome?.failed.length ?? 0, outcome?.reason ?? null);
}

/** Verdict de la sonde d'écriture du champ. */
function fieldVerdict(
  fieldId: string,
  attempted: number,
  updated: number,
  failed: number,
  reason: string | null,
): Probe {
  const ok = attempted > 0 && updated === attempted;
  return {
    name: 'field',
    ok,
    measures: { champId: fieldId, tentes: attempted, ecrits: updated, echoues: failed, raison: reason ?? 'aucune' },
    verdict: ok
      ? `le champ d'app en lecture seule est écrit en masse (${updated}/${attempted}) : il reste triable et filtrable en JQL, aucun repli nécessaire`
      : `écriture partielle ou refusée (${updated}/${attempted}, ${reason ?? 'sans motif'}) : basculer sur la propriété de ticket indexée (§17)`,
  };
}

/**
 * §17 « Compass accessible », « services affectés », « PR dans le graphe ».
 * Le graphe ne s'appelle qu'au nom d'un utilisateur (§15) : hors écran, l'appel
 * échoue et c'est une réponse utile — elle dit si le repli est obligatoire.
 */
export async function probeTeamworkGraph(projectKey: string): Promise<Probe> {
  const settings = await projectSettingsOf(projectKey);
  const page = await searchIssues(
    `project = ${quoteProjectKey(settings.projectKey)} ORDER BY created DESC`,
    ['summary', 'components'],
    5,
  );
  const keys = (page?.issues ?? []).map((issue) => issue.key);
  const zones = await fetchZoneLinks(keys);
  const services = await fetchIncidentServices(keys);
  const componentIds = (page?.issues ?? []).flatMap((issue) => (issue.fields?.components ?? []).map((c) => String(c.id ?? '')));
  const teams = await fetchTeamByComponent(componentIds.filter((id) => id.length > 0));
  return graphVerdict(keys.length, countNonEmpty(zones), countNonEmpty(services), teams.size);
}

/** Verdict de la sonde Teamwork Graph. */
function graphVerdict(keys: number, withZone: number, withServices: number, teams: number): Probe {
  const reached = withZone > 0 || withServices > 0 || teams > 0;
  return {
    name: 'graph',
    ok: true,
    measures: { ticketsInterroges: keys, avecComposantCompass: withZone, avecServiceAffecte: withServices, equipesTrouvees: teams },
    verdict: reached
      ? 'le graphe répond : zones Compass et services exploitables, à lire au nom de l\'utilisateur et à mettre en cache (§15)'
      : 'le graphe ne rend rien (scope manquant ou appel hors contexte utilisateur) : le repli du §17 s\'applique — composants Jira pour les zones, temps en statut de revue pour les PR',
  };
}

/** Clé de projet citée pour un JQL : guillemets échappés, jamais interpolés nus. */
function quoteProjectKey(projectKey: string): string {
  return `"${projectKey.replace(/"/g, '')}"`;
}

/**
 * Rapport des migrations de schéma : Forge SQL ne dit pas pourquoi un `ALTER`
 * échoue, et un échec silencieux se paie plus tard en « Unknown SQL execution
 * error » sur la première requête qui lit la colonne manquante.
 */
export async function probeMigrations(): Promise<Probe> {
  const reports = await runSchemaMigrations();
  const failed = reports.filter((report) => !report.ok);
  return {
    name: 'migrations',
    ok: failed.length === 0,
    measures: {
      appliquees: reports.length - failed.length,
      echouees: failed.length,
      detail: failed.map((f) => `${f.statement.slice(0, 70)} → ${f.error}`).join(' | ') || 'aucune',
    },
    verdict: failed.length === 0
      ? 'toutes les colonnes et index attendus sont en place'
      : `${failed.length} ALTER refusé(s) : les requêtes qui lisent ces colonnes échoueront`,
  };
}

/** Sonde du chemin de recalcul, étape par étape : localise le SQL fautif. */
export async function probeRecalcPath(projectKey: string): Promise<Probe> {
  const projectId = await projectIdByKey(projectKey);
  if (!projectId) throw new Error(`projet « ${projectKey} » non initialisé`);
  const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
  const run = async (step: string, body: () => Promise<number>): Promise<void> => {
    try {
      steps.push({ step, ok: true, detail: `ok (${await body()})` });
    } catch (error) {
      steps.push({ step, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };
  await run('settings', async () => ((await getSettings(projectId)) ? 1 : 0));
  await run('listIssuesInWindow', async () => (await listIssuesInWindow(projectId, '2026-01-01T00:00:00.000Z')).length);
  await run('listDebtIssues', async () => (await listDebtIssues(projectId)).length);
  await run('listStatusSpans', async () => (await listStatusSpans(projectId)).length);
  await run('listEvidence', async () => (await listEvidence(projectId)).length);
  await run('listAttributions', async () => (await listAttributions(projectId)).length);
  await run('listBills', async () => (await listBills(projectId)).length);
  await run('listBaselines', async () => (await listBaselines(projectId)).length);
  await run('listZoneWeeks', async () => (await listZoneWeeks(projectId, [])).length);
  const failed = steps.filter((item) => !item.ok);
  return {
    name: 'recalc-path',
    ok: failed.length === 0,
    measures: Object.fromEntries(steps.map((item) => [item.step, item.detail])),
    verdict: failed.length === 0 ? 'toutes les lectures du chemin passent' : `${failed.map((f) => f.step).join(', ')} échoue`,
  };
}

/** Sonde du chemin d'écriture : localise le SQL fautif côté persistance. */
export async function probeWritePath(projectKey: string): Promise<Probe> {
  const projectId = await projectIdByKey(projectKey);
  if (!projectId) throw new Error(`projet « ${projectKey} » non initialisé`);
  const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
  const run = async (step: string, body: () => Promise<void>): Promise<void> => {
    try {
      await body();
      steps.push({ step, ok: true, detail: 'ok' });
    } catch (error) {
      steps.push({ step, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };
  await run('replaceEvidence(vide)', () => replaceEvidence(projectId, []));
  await run('replaceAttributions(vide)', () => replaceAttributions(projectId, []));
  await run('replaceBaselines(vide)', () => replaceBaselines(projectId, []));
  await run('upsertZoneWeek(vide)', () => upsertZoneWeek([]));
  await run('clearInvalidBefore', () => clearInvalidBefore(projectId, new Date().toISOString()));
  // Écritures avec de VRAIES lignes : c'est là que le SQL se révèle.
  await run('replaceEvidence(1 ligne)', () => replaceEvidence(projectId, [probeEvidence()]));
  await run('replaceAttributions(1 ligne)', () => replaceAttributions(projectId, [probeAttribution()]));
  await run('replaceBaselines(1 ligne)', () => replaceBaselines(projectId, [probeBaseline()]));
  await run('upsertZoneWeek(1 ligne)', () => upsertZoneWeek([{ projectId, zone: 'sonde', week: '2026-11-09', costJp: 1, byFamily: { C1: 1, C2: 0, C3: 0, C4: 0, C5: 0 } }]));
  // `upsertBill` exige un projet connu : la sonde passe l'identifiant réel.
  await run('upsertBill(1 ligne)', () => upsertBill(probeBill(), projectId));
  await run('saveScores(1 ligne)', () => saveScores(projectId, [{ fingerprint: 'sonde', relevance: 0.5, rationale: 'sonde' }]));
  await run('listScores', async () => { await listScores(projectId); });
  const settings = await getSettings(projectId);
  await run('purgeDisappearedZones', async () => {
    if (settings) await purgeDisappearedZones(projectId, settings, new Date().toISOString());
  });
  await run('purgeProject', async () => {
    await purgeProject(projectId, { now: new Date().toISOString(), deadDays: 180 });
  });
  await run('nettoyage sonde', () => replaceEvidence(projectId, []));
  const failed = steps.filter((item) => !item.ok);
  return {
    name: 'write-path',
    ok: failed.length === 0,
    measures: Object.fromEntries(steps.map((item) => [item.step, item.detail])),
    verdict: failed.length === 0 ? 'écritures du chemin OK' : `échec : ${failed.map((f) => f.step).join(', ')}`,
  };
}

/**
 * Matrice de capacités SQL de Forge : quelles formes d'écriture passent.
 *
 * Mesuré le 11/11 : `ALTER TABLE` est refusé, et `DELETE ... LIMIT` avec une
 * sous-requête aussi. Cette sonde existe pour ne plus deviner : chaque forme
 * est essayée sur des lignes de sonde, et le verdict est binaire.
 */
export async function probeSqlForms(projectKey: string): Promise<Probe> {
  const projectId = await projectIdByKey(projectKey);
  if (!projectId) throw new Error(`projet « ${projectKey} » non initialisé`);
  const forms: Array<[string, string, unknown[]]> = [
    ['DELETE simple', 'DELETE FROM score_cache WHERE project_id = ?', [projectId]],
    ['DELETE + LIMIT', 'DELETE FROM score_cache WHERE project_id = ? LIMIT 5', [projectId]],
    [
      'DELETE + sous-requête',
      'DELETE FROM attribution WHERE project_id = ? AND evidence_id IN (SELECT evidence_id FROM evidence WHERE project_id = ?)',
      [projectId, projectId],
    ],
    ['UPDATE + LIMIT', 'UPDATE issue_fact SET description = description WHERE project_id = ? LIMIT 5', [projectId]],
    ['UPDATE simple', 'UPDATE issue_fact SET description = description WHERE project_id = ?', [projectId]],
    ['SELECT + sous-requête', 'SELECT evidence_id FROM attribution WHERE evidence_id IN (SELECT evidence_id FROM evidence WHERE project_id = ?)', [projectId]],
  ];
  const measures: Record<string, string | number | boolean> = {};
  let failed = 0;
  for (const [name, statement, params] of forms) {
    try {
      await runStatement(statement, params);
      measures[name] = 'accepté';
    } catch (error) {
      failed += 1;
      measures[name] = `refusé : ${(error instanceof Error ? error.message : String(error)).slice(0, 60)}`;
    }
  }
  return {
    name: 'sql-forms',
    ok: failed === 0,
    measures,
    verdict: failed === 0 ? 'toutes les formes testées passent' : `${failed} forme(s) refusée(s) par Forge SQL`,
  };
}

/* ------------------------------------------- jeux minimaux pour la sonde */

const PROBE_AT = '2026-11-09T12:00:00.000Z';

function probeEvidence(): Evidence {
  return {
    id: 'sonde-e1', zone: 'sonde', family: 'C1', sourceIssueId: 'sonde-1', sourceKey: 'SONDE-1',
    occurredAt: PROBE_AT, costJp: 1, method: 'computed', visible: true,
    detail: { durationDays: 1, method: 'computed', formula: 'sonde', inputs: {}, familyLabel: 'Incidents' },
  };
}

function probeAttribution(): Attribution {
  return { evidenceId: 'sonde-e1', debtIssueId: 'sonde-d1', share: 1, basis: 'link', relevance: 1, rationale: 'sonde' };
}

function probeBaseline(): Baseline {
  return { issueType: 'Sonde', sizeClass: 'm', medianDays: 1, sampleSize: 5, computedAt: PROBE_AT };
}

function probeBill(): DebtBill {
  const zero = { lowJp: 0, highJp: 0, evidenceCount: 0, insufficient: false };
  return {
    debtIssueId: 'sonde-d1', key: 'SONDE-1', computedAt: PROBE_AT, lowJp: 1, highJp: 1,
    byFamily: { C1: zero, C2: zero, C3: zero, C4: zero, C5: zero },
    evidenceIds: ['sonde-e1'], hiddenCount: 0, repaymentJp: null, avoidableJp: null,
    roiLow: null, roiHigh: null, paybackDays: null,
  };
}

/** Compte les entrées non vides d'une carte. */
function countNonEmpty(map: Map<string, string[]>): number {
  let count = 0;
  for (const value of map.values()) if (value.length > 0) count += 1;
  return count;
}

/** Réglages d'un projet, avec un motif clair s'il n'est pas initialisé. */
async function projectSettingsOf(projectKey: string): Promise<ProjectSettings> {
  const { projectIdByKey } = await import('./projects');
  const projectId = await projectIdByKey(projectKey);
  if (!projectId) throw new Error(`projet « ${projectKey} » non initialisé : action=init d'abord`);
  return requireSettings(projectId);
}

/** Un ticket, relu pour vérification ; `null` s'il est illisible. */
export async function probeIssue(key: string): Promise<unknown> {
  return fetchIssue(key);
}
