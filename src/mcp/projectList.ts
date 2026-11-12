/**
 * GET `list-projects` — les projets initialisés (item E75).
 *
 * Sans cet outil, les amorces « quelle dette nous coûte le plus ? » et « y a-t-il
 * de la dette sans ticket ? » étaient injouables : elles exigent une clé de
 * projet que personne ne fournit à l'agent. Deux réponses complémentaires :
 *
 * - cet outil **liste** les projets réglés, avec leur fenêtre d'analyse ;
 * - les actions qui prennent `projectKey` l'acceptent désormais **facultatif**
 *   et se replient sur le seul projet initialisé (`resolveProject`, `project.ts`).
 *   À plusieurs projets, elles refusent en listant les clés : jamais de choix
 *   arbitraire.
 */

import { listInitializedProjects } from './project';
import type { ProjectSummary } from './project';
import type { ActionEnvelope, JsonPayload } from './result';
import { run } from './result';

/** Projets initialisés, et ce que l'appelant doit en faire. */
export interface ListProjectsData {
  projects: ProjectSummary[];
  total: number;
  /** Vrai quand un seul projet est initialisé : `projectKey` peut être omis. */
  single: boolean;
  /** Phrase lisible : comment viser un projet dans les autres actions. */
  hint: string;
}

/** GET `list-projects` : quels projets mesurent leur dette. */
export async function listProjects(payload: JsonPayload): Promise<ActionEnvelope<ListProjectsData>> {
  return run(async () => {
    const projects = await listInitializedProjects();
    return {
      projects,
      total: projects.length,
      single: projects.length === 1,
      hint: hintOf(projects),
    };
  });
}

/** Ce que l'appelant doit savoir pour enchaîner sur une autre action. */
function hintOf(projects: readonly ProjectSummary[]): string {
  if (projects.length === 0) {
    return "aucun projet initialisé : ouvrir l'écran Réglages de L'addition, puis lancer l'initialisation";
  }
  if (projects.length === 1) {
    return `un seul projet initialisé (${projects[0]?.projectKey ?? ''}) : « projectKey » peut être omis`;
  }
  return `préciser « projectKey » parmi : ${projects.map((item) => item.projectKey).join(', ')}`;
}
