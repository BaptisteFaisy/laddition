/**
 * Vie privée (§18).
 *
 * Trois garde-fous, tous appliqués avant que quoi que ce soit n'atteigne
 * l'écran :
 * 1. `maskHidden` sépare ce que ce lecteur a le droit de voir du reste, et
 *    compte le reste — un total ne doit jamais trahir un ticket fermé à lui.
 *    Appliqué par `buildBill` (`hiddenCount`).
 * 2. `assertNoPersonRanking` refuse tout classement dont la clé est une
 *    personne : on classe des zones et des tickets, jamais des gens. Appliqué
 *    par `rankDebts` avant de rendre les lignes.
 * 3. `redactName` réduit un nom à son initiale quand il faut malgré tout
 *    désigner quelqu'un. Appliqué à la justification d'une confirmation
 *    humaine (`attribution.ts`).
 */

/**
 * Mots d'une clé qui désignent une personne, et donc un classement interdit.
 *
 * La liste couvre les mots que Jira et le graphe-teamwork utilisent vraiment :
 * `assignee`, `assigned`, `reporter`, `creator`, `owner`, `author`, `user`.
 */
const PERSON_TOKENS: readonly string[] = [
  'assignee',
  'assignees',
  'assigned',
  'author',
  'authors',
  'creator',
  'owner',
  'reporter',
  'user',
  'users',
];

/**
 * Clés autorisées dans une ligne de classement : tout ce qui décrit une zone,
 * un ticket, un coût ou une preuve. Aucune ne désigne une personne.
 */
export const ALLOWED_RANKING_KEYS: readonly string[] = [
  'id',
  'key',
  'zone',
  'team',
  'summary',
  'rank',
  'position',
  'debtIssueId',
  'evidenceId',
  'sourceKey',
  'sourceIssueId',
  'lowJp',
  'highJp',
  'totalJp',
  'costJp',
  'repaymentJp',
  'avoidableJp',
  'roiLow',
  'roiHigh',
  'paybackDays',
  'daysWithoutEvidence',
  'family',
  'byFamily',
  'method',
  'occurredAt',
  'evidenceIds',
  'hiddenCount',
  'insufficient',
  'unclassifiedShare',
  'visible',
];

/**
 * Sépare les éléments visibles des éléments masqués pour ce lecteur.
 * Seul un `visible: false` explicite masque : une donnée non renseignée
 * n'est pas une donnée interdite.
 */
export function maskHidden<T extends { visible: boolean }>(
  items: T[],
): { visible: T[]; hiddenCount: number } {
  const visible = items.filter((item) => item.visible !== false);
  return { visible, hiddenCount: items.length - visible.length };
}

/**
 * Jette si une ligne de classement est indexée par une personne.
 *
 * Une clé de la liste blanche passe toujours ; hors liste blanche, toute clé
 * dont un mot est `assignee`, `assigned`, `author`, `creator`, `owner`,
 * `reporter` ou `user` est refusée — y compris `assigneeCount`, `user_name` ou
 * `reporterName`, qui classent malgré tout par personne. C'est un défaut de
 * programmation, pas une donnée douteuse : on jette.
 */
export function assertNoPersonRanking(rows: ReadonlyArray<object>): void {
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (ALLOWED_RANKING_KEYS.includes(key)) continue;
      const offending = wordsOf(key).find((word) => PERSON_TOKENS.includes(word));
      if (offending) {
        throw new Error(
          `classement par personne interdit (§18) : clé « ${key} » (mot « ${offending} »)`,
        );
      }
    }
  }
}

/**
 * Réduit un nom à son initiale : « Alice Martin » → « A. ».
 * Rend `null` quand il n'y a rien à désigner.
 */
export function redactName(name: string | null): string | null {
  if (name === null) return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  const initial = Array.from(trimmed)[0] ?? '';
  return `${initial.toUpperCase()}.`;
}

/** Mots d'une clé, séparés sur les frontières camelCase et la ponctuation. */
function wordsOf(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}
