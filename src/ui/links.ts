/**
 * Adresses des tickets et des projets, bâties depuis `context.siteUrl`.
 *
 * Chaque clé de ticket affichée doit être cliquable (§20 recette 6, principe 1) :
 * ces fonctions sont le seul endroit où une adresse Jira est composée. Module
 * pur, testable hors navigateur.
 */

/** Retire les barres obliques de fin pour qu'une adresse ne se duplique jamais. */
function base(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, '');
}

/** Adresse d'un ticket : `https://site.atlassian.net/browse/PAY-77`. */
export function issueUrl(siteUrl: string, key: string): string {
  return `${base(siteUrl)}/browse/${key}`;
}

/** Adresse d'un projet, pour le gadget qui n'a pas de contexte de projet. */
export function projectUrl(siteUrl: string, projectKey: string): string {
  return `${base(siteUrl)}/browse/${projectKey}`;
}

/** Vrai quand une adresse peut être bâtie (site connu et clé non vide). */
export function canLink(siteUrl: string, key: string): boolean {
  return siteUrl.trim() !== '' && key.trim() !== '';
}
