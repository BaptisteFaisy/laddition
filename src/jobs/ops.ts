import { asApp, route } from '@forge/api';
import type { BootstrapProgress, ProjectSettings } from '../core/types';
import { makeSettings, mergeSettings } from '../core/settings';
import { startBootstrap } from './consumer';
import { projectIdByKey } from './projects';
import { nightlyRecalc, publishRepayments } from './scheduled';
import { bootstrapProgress, getSettings, saveSettings } from '../platform/db/index';
import { jiraGetJson } from '../platform/jira';
import type { NightlyResult, RepaymentResult } from './scheduled';
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
      if (existing) {
        const merged = mergeSettings(existing, patch);
        await saveSettings(merged);
        return merged;
      }
    }
    const project = await readJiraProject(projectKey);
    const settings = mergeSettings(makeSettings(project.id, project.key), patch);
    await saveSettings(settings);
    return settings;
  });
}

/** Traduit les réglages passés en query string en correctif typé. */
function settingsPatch(raw: Record<string, string>): Partial<ProjectSettings> {
  const patch: Partial<ProjectSettings> = {};
  const kind = raw['debtRuleKind'];
  const value = raw['debtRuleValue'];
  if (kind && isDebtRuleKind(kind)) patch.debtRule = { kind, value: value ?? 'tech-debt' };
  else if (value) patch.debtRule = { kind: 'label', value };
  const mode = raw['zoneMode'];
  if (mode && isZoneMode(mode)) patch.zoneMode = mode;
  const label = raw['zoneLabelField'];
  if (label) patch.zoneLabelField = label;
  return patch;
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

/** Recalcul complet d'un projet : preuves, attributions, additions, champ. */
export async function opsRecalc(projectKey: string): Promise<OpsReport<NightlyResult>> {
  return runOps('recalc', async () => {
    const projectId = await requireProjectId(projectKey);
    const result = await nightlyRecalc();
    return { ...result, projects: result.projects.filter((item) => item.projectId === projectId) };
  });
}

/** Recalcul de tous les projets connus, sans filtre. */
export async function opsRecalcAll(): Promise<OpsReport<NightlyResult>> {
  return runOps('recalc-all', nightlyRecalc);
}

/** Bulletins de remboursement des dettes closes (§11). */
export async function opsRepayments(): Promise<OpsReport<RepaymentResult>> {
  return runOps('repayments', publishRepayments);
}
