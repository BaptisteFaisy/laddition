import type { SampleData } from './load';
import type { IssueFact } from '../core/types';

/**
 * Alignement des identifiants du jeu d'exemple sur les vrais tickets du site.
 *
 * Le jeu d'exemple est **pur** : ses identifiants internes sont dérivés des clés
 * (`pay-77`), parce qu'il doit se construire hors ligne. Sur un site réel, les
 * écrans reçoivent l'identifiant **Jira** du ticket ouvert (le panneau du
 * ticket, l'encart sur un bug) : sans alignement, ouvrir PAY-77 rend
 * « ticket 66499 inconnu » alors que le classement affiche bien PAY-77 —
 * constaté le 12/11 sur le site de démo.
 *
 * L'alignement est donc fait à l'injection, côté résolveur (là où l'I/O est
 * permise), et il est **tolérant** : une clé absente du site garde son
 * identifiant fictif, le jeu reste cohérent.
 */

/** Résout l'identifiant Jira réel d'une clé ; `null` si le ticket n'existe pas. */
export type IssueIdResolver = (key: string) => Promise<string | null>;

/** Carte « identifiant fictif → identifiant réel », pour les clés trouvées. */
export async function realIdMap(
  facts: readonly IssueFact[],
  resolve: IssueIdResolver,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const fact of facts) {
    if (map.has(fact.issueId)) continue;
    const real = await resolve(fact.key);
    if (real && real !== fact.issueId) map.set(fact.issueId, real);
  }
  return map;
}

/** Réécrit le jeu d'exemple avec les identifiants réels, table par table. */
export async function alignIssueIds(data: SampleData, resolve: IssueIdResolver): Promise<SampleData> {
  const map = await realIdMap(data.facts, resolve);
  if (map.size === 0) return data;
  const id = (value: string): string => map.get(value) ?? value;
  return {
    facts: data.facts.map((fact) => ({ ...fact, issueId: id(fact.issueId) })),
    spans: data.spans.map((span) => ({ ...span, issueId: id(span.issueId) })),
    links: data.links.map((link) => ({ ...link, fromIssueId: id(link.fromIssueId), toIssueId: id(link.toIssueId) })),
    evidence: data.evidence.map((item) => ({ ...item, sourceIssueId: id(item.sourceIssueId) })),
    attributions: data.attributions.map((item) => ({ ...item, debtIssueId: id(item.debtIssueId) })),
    zones: data.zones,
    repayment: data.repayment.map((item) => ({ ...item, debtIssueId: id(item.debtIssueId) })),
  };
}
