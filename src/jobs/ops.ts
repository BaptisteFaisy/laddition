import { asApp, route } from '@forge/api';
import type { BootstrapProgress, ProjectSettings } from '../core/types';
import { makeSettings, mergeSettings } from '../core/settings';
import { startBootstrap } from './consumer';
import { projectIdByKey } from './projects';
import type { ProjectRecalc } from './recalc';
import { recalcProject } from './recalc';
import { nightlyRecalc, publishRepayments } from './scheduled';
import type { NightlyResult, RepaymentResult } from './scheduled';
import { saveProjectSettings } from './settings';
import { bootstrapProgress, findMissingColumns, getSettings, resetSchema } from '../platform/db/index';
import { jiraGetJson } from '../platform/jira';
import { ensureReady } from './schema';
import { messageOf, nowIso } from './support';

/** Projet Jira, réduit à ce que l'initialisation en lit. */
interface JiraProject {
  id?: string;
  key?: string;
  name?: string;
}

/**
 * Pilotage de l'app sans navigateur : initialisation, recalcul, état.
 *
 * Ces trois opérations sont celles qu'un administrateur lance depuis les
 * écrans (DT-12) ou que le `scheduledTrigger` joue chaque nuit (§15). Les
 * exposer ici permet de les déclencher et de les vérifier par HTTP, ce qui
 * sert autant au développement qu'à la recette des juges.
 */

/** Bilan d'une opération de pilotage : jamais d'exception, toujours un état. */
export type OpsReport<T> =
  | { ok: true; at: string; action: string; data: T }
  | { ok: false; at: string; action: string; error: string };

/** Résout l'identifiant interne d'un projet depuis sa clé (`PAY`). */
async function requireProjectId(projectKey: string): Promise<string> {
  const projectId = await projectIdByKey(projectKey);
  if (!projectId) {
    throw new Error(
      `projet « ${projectKey} » inconnu : initialiser d'abord ses réglages (action init)`,
    );
  }
  return projectId;
}

/**
 * Assistant d'installation (§22, étape « désigner la dette » et « mode de zone »),
 * sans écran : lit le projet chez Jira, pose les réglages par défaut, et les
 * enregistre. Idempotent — un projet déjà initialisé rend ses réglages actuels.
 */
export async function opsInit(
  projectKey: string,
  raw: Record<string, string> = {},
): Promise<OpsReport<ProjectSettings>> {
  return runOps('init', async () => {
    const patch = settingsPatch(raw);
    const stored = await projectIdByKey(projectKey);
    if (stored) {
      const existing = await getSettings(stored);
      if (existing) return saveProjectSettings(mergeSettings(existing, patch));
    }
    const project = await readJiraProject(projectKey);
    const settings = mergeSettings(makeSettings(project.id, project.key), patch);
    return saveProjectSettings(settings);
  });
}

/**
 * Réglages numériques acceptés en query string, avec leurs bornes (§11).
 *
 * Les bornes reprises ici sont celles de `mergeSettings` ; `dayRateEur` n'y est
 * pas borné, donc il l'est ici. Une valeur illisible est **ignorée**, jamais
 * devinée : on ne règle pas un projet sur un malentendu.
 */
const NUMBER_SETTINGS = {
  dayRateEur: { min: 0, max: 100000 },
  hoursPerDay: { min: 1, max: 24 },
  daysPerWeek: { min: 1, max: 7 },
  windowDays: { min: 7, max: 365 },
  deadDays: { min: 30, max: 730 },
  occupationCoefficient: { min: 0, max: 1 },
  phantomThresholdJp: { min: 0, max: 1000 },
  minBaselineSample: { min: 1, max: 100 },
} as const;

/** Nom d'un réglage numérique réglable par l'outillage. */
type NumberSetting = keyof typeof NUMBER_SETTINGS;

/**
 * Paramètres de réglage acceptés par `?action=init`, dans une seule liste :
 * le webtrigger les lit, `settingsPatch` les interprète. Ajouter un réglage
 * numérique à `NUMBER_SETTINGS` suffit — aucune liste à recopier ailleurs.
 */
export const SETTINGS_PARAMS: readonly string[] = [
  'debtRuleKind',
  'debtRuleValue',
  'zoneMode',
  'zoneLabelField',
  'storyPointField',
  ...Object.keys(NUMBER_SETTINGS),
];

/** Traduit les réglages passés en query string en correctif typé. */
export function settingsPatch(raw: Record<string, string>): Partial<ProjectSettings> {
  const patch: Partial<ProjectSettings> = { ...numberSettings(raw) };
  const kind = raw['debtRuleKind'];
  const value = raw['debtRuleValue'];
  if (kind && isDebtRuleKind(kind)) patch.debtRule = { kind, value: value ?? 'tech-debt' };
  else if (value) patch.debtRule = { kind: 'label', value };
  const mode = raw['zoneMode'];
  if (mode && isZoneMode(mode)) patch.zoneMode = mode;
  const label = raw['zoneLabelField'];
  if (label) patch.zoneLabelField = label;
  const points = raw['storyPointField'];
  if (points && points.trim().length > 0) patch.storyPointField = points.trim();
  return patch;
}

/** Réglages numériques présents et bornés ; les illisibles sont ignorés. */
function numberSettings(raw: Record<string, string>): Partial<Record<NumberSetting, number>> {
  const out: Partial<Record<NumberSetting, number>> = {};
  const entries = Object.entries(NUMBER_SETTINGS) as Array<[NumberSetting, { min: number; max: number }]>;
  for (const [name, bounds] of entries) {
    const parsed = parseNumberParam(raw[name] ?? '');
    if (!Number.isFinite(parsed)) continue;
    out[name] = Math.min(bounds.max, Math.max(bounds.min, parsed));
  }
  return out;
}

/**
 * Un nombre saisi, virgule décimale comprise (un réglage tapé « 650,5 » vaut
 * 650.5). Un point l'emporte : « 1,234.5 » reste mille deux cent trente-quatre.
 */
function parseNumberParam(raw: string): number {
  const text = raw.trim();
  return Number.parseFloat(text.includes('.') ? text : text.replace(',', '.'));
}

/** Garde-fou de type : une valeur inconnue est ignorée, jamais devinée. */
function isDebtRuleKind(value: string): value is ProjectSettings['debtRule']['kind'] {
  return value === 'issueType' || value === 'label' || value === 'jql';
}

/** Garde-fou de type pour le mode de zone (§8). */
function isZoneMode(value: string): value is ProjectSettings['zoneMode'] {
  return value === 'component' || value === 'compass' || value === 'service' || value === 'label';
}

/** Identifiant et clé d'un projet Jira, lus au nom de l'app. */
async function readJiraProject(projectKey: string): Promise<{ id: string; key: string }> {
  const found = await jiraGetJson<JiraProject>(
    route`/rest/api/3/project/${encodeURIComponent(projectKey)}`,
    'readJiraProject',
  );
  if (!found || typeof found.id !== 'string' || typeof found.key !== 'string') {
    throw new Error(`projet « ${projectKey} » illisible chez Jira`);
  }
  return { id: found.id, key: found.key };
}

/** Exécute une opération et l'emballe dans un bilan uniforme. */
async function runOps<T>(action: string, body: () => Promise<T>): Promise<OpsReport<T>> {
  const at = nowIso();
  try {
    await ensureReady();
    return { ok: true, at, action, data: await body() };
  } catch (error) {
    return { ok: false, at, action, error: messageOf(error) };
  }
}

/**
 * Santé du schéma : liste les colonnes attendues absentes de l'installation.
 *
 * Forge SQL refuse `ALTER TABLE` (mesuré le 11/11) : une installation créée
 * avant l'ajout d'une colonne ne peut pas être migrée. Cette action le détecte
 * au lieu de laisser chaque requête échouer sur une erreur générique.
 */
export async function opsSchemaHealth(): Promise<OpsReport<{ missing: unknown[] }>> {
  return runOps('schema-health', async () => ({ missing: await findMissingColumns() }));
}

/**
 * Recrée le schéma de zéro — **destructif**, réservé aux sites de démo
 * (Forge SQL n'accepte pas ALTER TABLE). Les données se réinjectent ensuite :
 * initialisation + recalcul, ou jeu d'exemple.
 */
export async function opsResetSchema(): Promise<OpsReport<{ dropped: string[]; missing: unknown[] }>> {
  return runOps('reset-schema', async () => {
    const result = await resetSchema();
    return { dropped: result.dropped, missing: result.missingAfterReset };
  });
}

/**
 * DT-12 : initialise 180 jours d'historique pour un projet, par lots de 50
 * poussés dans la file (`consumer`). Rend l'état de progression initial.
 */
export async function opsBootstrap(projectKey: string): Promise<OpsReport<BootstrapProgress>> {
  return runOps('bootstrap', async () => startBootstrap(await requireProjectId(projectKey)));
}

/** État de l'initialisation en cours, pour la barre de progression. */
export async function opsProgress(projectKey: string): Promise<OpsReport<BootstrapProgress | null>> {
  return runOps('progress', async () => bootstrapProgress(await requireProjectId(projectKey)));
}

/** Recalcul complet d'un projet, sans passer par la file : preuves, attributions, additions, champ. */
export async function opsRecalc(projectKey: string): Promise<OpsReport<NightlyResult>> {
  return runOps('recalc', async () => {
    const projectId = await requireProjectId(projectKey);
    const startedAt = nowIso();
    const outcome: ProjectRecalc = await recalcProject(projectId, startedAt);
    return toNightly([outcome], startedAt);
  });
}

/** Tous les projets connus : un message de file chacun, le consommateur suit (C34). */
export async function opsRecalcAll(): Promise<OpsReport<NightlyResult>> {
  return runOps('recalc-all', nightlyRecalc);
}

/** Bilan de recalculs sous la forme du bilan nocturne. */
function toNightly(projects: ProjectRecalc[], startedAt: string): NightlyResult {
  return {
    ok: projects.every((item) => !item.error),
    projects,
    startedAt,
    finishedAt: nowIso(),
    queued: projects.filter((item) => item.queued).length,
  };
}

/** Bulletins de remboursement des dettes closes (§11). */
export async function opsRepayments(): Promise<OpsReport<RepaymentResult>> {
  return runOps('repayments', publishRepayments);
}
