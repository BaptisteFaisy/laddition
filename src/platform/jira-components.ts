import type { JiraFields } from './jira-types';

/**
 * Composants d'un ticket : nom affiché et identifiant Jira, dans le même ordre.
 *
 * L'identifiant est ce qui permet de reconnaître un composant **renommé**
 * (item B24) : le nom change, l'identifiant reste. Sans lui, un renommage
 * scinde l'historique d'une zone en deux.
 */
export function componentsOf(fields: JiraFields): { components: string[]; componentIds: string[] } {
  const list = (fields.components ?? []).filter((component) => (component.name ?? '').length > 0);
  return {
    components: list.map((component) => component.name ?? ''),
    componentIds: list.map((component) => component.id ?? ''),
  };
}
