/**
 * Résolution du projet pour les actions Rovo / MCP (item E75).
 *
 * Un agent qui répond à « quelle dette nous coûte le plus ? » ne connaît pas la
 * clé du projet : rien ne la lui fournit. Trois cas, et jamais de devinette :
 *
 * - la clé est donnée → ce projet, ou une erreur qui dit quoi faire ;
 * - un seul projet est initialisé → celui-là, et la réponse le nomme ;
 * - plusieurs projets sont initialisés → une erreur qui **liste les clés** :
 *   l'appelant relance avec la bonne au lieu de tourner en rond.
 */

import type { ProjectSettings } from '../core/types';
import { makeSettings } from '../core/settings';
import { getSettings } from '../platform/db/index';
import { listProjectIds, projectIdByKey } from '../jobs/projects';

/** Projet résolu : identifiant, clé et réglages en vigueur. */
export interface ProjectContext {
  projectId: string;
  projectKey: string;
  settings: ProjectSettings;
}

/** Un projet initialisé, tel que `list-projects` le rend. */
export interface ProjectSummary {
  projectId: string;
  projectKey: string;
  /** Fenêtre d'analyse en jours : c'est elle qui borne tous les coûts. */
  windowDays: number;
  /** Vrai quand le projet porte le jeu d'exemple (§22). */
  demoData: boolean;
}

/** Projets initialisés (une ligne de réglages chacun), triés par clé. */
export async function listInitializedProjects(): Promise<ProjectSummary[]> {
  const ids = await listProjectIds();
  const found: ProjectSummary[] = [];
  for (const projectId of ids) {
    const settings = await getSettings(projectId);
    if (!settings) continue;
    found.push({
      projectId,
      projectKey: settings.projectKey,
      windowDays: settings.windowDays,
      demoData: settings.demoData === true,
    });
  }
  return found.sort((a, b) => a.projectKey.localeCompare(b.projectKey));
}

/** Résout un projet par sa clé ; jette un motif actionnable s'il est inconnu. */
export async function projectOf(projectKey: string): Promise<ProjectContext> {
  const projectId = await projectIdByKey(projectKey);
  if (!projectId) {
    const known = await listInitializedProjects();
    const hint = known.length > 0 ? `projets initialisés : ${known.map((item) => item.projectKey).join(', ')}` : 'aucun projet initialisé';
    throw new Error(`projet « ${projectKey} » inconnu (${hint}) : ouvrir l'écran Réglages de L'addition`);
  }
  return contextOf(projectId, projectKey);
}

/**
 * Résout le projet visé par une action (item E75).
 *
 * `projectKey` facultatif : absent, on prend le seul projet initialisé ; à
 * plusieurs, on refuse en listant les clés plutôt que d'en choisir un au hasard.
 */
export async function resolveProject(projectKey: string | null): Promise<ProjectContext> {
  if (projectKey) return projectOf(projectKey);
  const projects = await listInitializedProjects();
  if (projects.length === 0) {
    throw new Error("aucun projet initialisé : ouvrir l'écran Réglages de L'addition, puis lancer l'initialisation");
  }
  const first = projects[0];
  if (!first || projects.length > 1) {
    throw new Error(
      `plusieurs projets initialisés : préciser « projectKey » (${projects.map((item) => item.projectKey).join(', ')})`,
    );
  }
  return contextOf(first.projectId, first.projectKey);
}

/** Contexte d'un projet : ses réglages, ou les défauts avant la première visite. */
async function contextOf(projectId: string, projectKey: string): Promise<ProjectContext> {
  const settings = (await getSettings(projectId)) ?? makeSettings(projectId, projectKey);
  return { projectId, projectKey, settings };
}

/**
 * Préfixe d'une clé de ticket (`PAY-77` → `PAY`).
 *
 * Une clé sans tiret n'est pas une clé de ticket : le message le dit, au lieu
 * de partir chercher un projet au nom improbable (item D45).
 */
export function projectKeyOf(issueKey: string): string {
  const dash = issueKey.indexOf('-');
  const prefix = dash > 0 ? issueKey.slice(0, dash) : '';
  if (prefix.length === 0) {
    throw new Error(
      `clé de ticket illisible : « ${issueKey} » — format attendu PROJET-NUMÉRO (ex. PAY-77)`,
    );
  }
  return prefix;
}
