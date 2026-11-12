/**
 * Conversion d'un corps ADF (le format de description de Jira Cloud) en texte.
 *
 * Isolé dans son module pour que `jira-types.ts` reste lisible : la conversion
 * est pure, elle n'a rien à faire du reste de la fiche.
 */

/** Blocs Atlassian Document Format qui doivent produire un saut de ligne. */
const ADF_BLOCKS: ReadonlySet<string> = new Set([
  'paragraph', 'heading', 'listItem', 'bulletList', 'orderedList',
  'blockquote', 'codeBlock', 'tableRow', 'panel', 'rule',
]);

/** Texte d'un corps ADF, paragraphes séparés par un saut de ligne. */
export function adfToText(node: unknown, depth = 0): string {
  if (depth > 12 || node === null || typeof node !== 'object') return '';
  const record = node as { type?: string; text?: string; content?: unknown[] };
  if (record.type === 'text') return record.text ?? '';
  if (record.type === 'hardBreak') return '\n';
  const children = Array.isArray(record.content) ? record.content : [];
  const inner = children.map((child) => adfToText(child, depth + 1)).join('');
  return ADF_BLOCKS.has(record.type ?? '') ? `${inner}\n` : inner;
}
