import type { ProjectSettings } from '../core/types';
import { getSettings } from '../platform/db/index';
import { createDeadline, DEFAULT_BUDGET_MS } from './deadline';
import { listProjectIds } from './projects';
import type { ProjectRecalc } from './recalc';
import { skipReason } from './recalc';
import { enqueueRecalc } from './recalcQueue';
import type { RepaymentOutcome } from './repayments';
import { publishProjectRepayments } from './repayments';
import { ensureReady } from './schema';
import { messageOf, nowIso } from './support';

/**
 * `scheduledTrigger` (§15) : la nuit, et les bulletins de remboursement.
 *
 * Le déclencheur planifié ne calcule plus rien lui-même (C34) : il met **un
 * message de file par projet**, et le consommateur existant les traite un par
 * un, chacun avec sa propre limite de 900 s. Un projet lent ne bloque plus les
 * autres ; un échec ne rejoue que le projet concerné.
 *
 * Les projets marqués `demoData` ne sont ni mis en file ni recalculés (B16) :
 * la nuit ne rescore pas le jeu d'exemple et n'écrit jamais de coût fictif sur
 * un vrai ticket.
 */

export type { ProjectRecalc } from './recalc';

/** Bilan du recalcul nocturne, rendu au manifeste et aux journaux. */
export interface NightlyResult {
  ok: boolean;
  projects: ProjectRecalc[];
  startedAt: string;
  finishedAt: string;
  /** Projets mis en file pour recalcul (C34). */
  queued: number;
}

/** Bilan des bulletins d'un projet (§11). */
export interface RepaymentProjectResult {
  projectId: string;
  published: number;
  /** Bulletins retirés : dettes rouvertes (§19 cas 8). */
  removed?: number;
  /** Groupes zone × mois traités (§19 cas 9). */
  groups?: number;
  /** Motif d'un projet écarté (jeu d'exemple, temps écoulé). */
  skipped?: string;
  error?: string;
}

/** Bilan des bulletins de remboursement (§11). */
export interface RepaymentResult {
  ok: boolean;
  projects: RepaymentProjectResult[];
  at: string;
}

/** Ce que la nuit touche : le schéma, la liste des projets, leurs réglages, la file. */
export interface NightlyPorts {
  ensureReady(): Promise<void>;
  listProjects(): Promise<string[]>;
  settingsOf(projectId: string): Promise<ProjectSettings | null>;
  enqueue(projectId: string): Promise<void>;
}

/** Le câblage réel : la base des réglages et la file de l'app. */
export const defaultNightlyPorts: NightlyPorts = {
  ensureReady: () => ensureReady(),
  listProjects: () => listProjectIds(),
  settingsOf: (projectId) => getSettings(projectId),
  enqueue: (projectId) => enqueueRecalc(projectId),
};

/**
 * Met en file le recalcul de chaque projet réglé.
 *
 * C'est le `scheduledTrigger` quotidien : il revient en quelques secondes, le
 * travail lourd est dans le consommateur (`runRecalcMessage`).
 */
export async function nightlyRecalc(ports: NightlyPorts = defaultNightlyPorts): Promise<NightlyResult> {
  await ports.ensureReady();
  const startedAt = nowIso();
  const projects: ProjectRecalc[] = [];
  for (const projectId of await ports.listProjects()) {
    projects.push(await queueProject(projectId, ports));
  }
  return {
    ok: projects.every((item) => !item.error),
    projects,
    startedAt,
    finishedAt: nowIso(),
    queued: projects.filter((item) => item.queued).length,
  };
}

/** Un projet mis en file : son échec est un bilan, jamais une exception. */
async function queueProject(projectId: string, ports: NightlyPorts): Promise<ProjectRecalc> {
  const empty = { projectId, evidence: 0, bills: 0, fieldUpdated: 0 };
  try {
    const settings = await ports.settingsOf(projectId);
    if (!settings) return { ...empty, error: 'projet sans réglages' };
    const skipped = skipReason(settings);
    if (skipped) return { ...empty, skipped };
    await ports.enqueue(projectId);
    return { ...empty, queued: true };
  } catch (error) {
    return { ...empty, error: messageOf(error) };
  }
}

/** Ce que la publication des bulletins touche. */
export interface RepaymentRunPorts {
  ensureReady(): Promise<void>;
  listProjects(): Promise<string[]>;
  settingsOf(projectId: string): Promise<ProjectSettings | null>;
  publish(projectId: string, at: string): Promise<RepaymentOutcome>;
}

/** Le câblage réel des bulletins. */
export const defaultRepaymentPorts: RepaymentRunPorts = {
  ensureReady: () => ensureReady(),
  listProjects: () => listProjectIds(),
  settingsOf: (projectId) => getSettings(projectId),
  publish: (projectId, at) => publishProjectRepayments(projectId, at),
};

/**
 * Publie les bulletins des dettes closes (§11), retire ceux des dettes
 * rouvertes (§19 cas 8) et fusionne ceux d'une même zone sur un même mois
 * (§19 cas 9). Une garde de durée rend la main proprement (C34).
 */
export async function publishRepayments(
  ports: RepaymentRunPorts = defaultRepaymentPorts,
): Promise<RepaymentResult> {
  await ports.ensureReady();
  const at = nowIso();
  const deadline = createDeadline(DEFAULT_BUDGET_MS);
  const projects: RepaymentProjectResult[] = [];
  for (const projectId of await ports.listProjects()) {
    if (deadline.expired()) {
      projects.push({ projectId, published: 0, skipped: 'temps écoulé' });
      continue;
    }
    projects.push(await publishSafely(projectId, at, ports));
  }
  return { ok: projects.every((item) => !item.error), projects, at };
}

/** Bulletins d'un projet isolé : son échec est un bilan, jamais une exception. */
async function publishSafely(
  projectId: string,
  at: string,
  ports: RepaymentRunPorts,
): Promise<RepaymentProjectResult> {
  try {
    const settings = await ports.settingsOf(projectId);
    if (!settings) return { projectId, published: 0, error: 'projet sans réglages' };
    const skipped = skipReason(settings);
    if (skipped) return { projectId, published: 0, skipped };
    const outcome = await ports.publish(projectId, at);
    return {
      projectId,
      published: outcome.published,
      removed: outcome.removed,
      groups: outcome.groups,
    };
  } catch (error) {
    return { projectId, published: 0, error: messageOf(error) };
  }
}
