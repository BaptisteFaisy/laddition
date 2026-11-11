import type { StatusSpan } from '../core/types.ts';

/**
 * Séjours de statut regroupés par ticket.
 *
 * Le domaine (`core/duration.ts`) travaille ticket par ticket, les dépôts
 * rendent une liste plate : ce repli est le seul endroit où la liste redevient
 * une table indexée, partagé par le calcul nocturne et les décisions humaines.
 */
export function groupSpans(spans: StatusSpan[]): Map<string, StatusSpan[]> {
  const byIssue = new Map<string, StatusSpan[]>();
  for (const span of spans) {
    const list = byIssue.get(span.issueId);
    if (list) list.push(span);
    else byIssue.set(span.issueId, [span]);
  }
  return byIssue;
}
