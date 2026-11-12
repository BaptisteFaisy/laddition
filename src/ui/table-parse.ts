import { Children, isValidElement } from 'react';
import type React from 'react';
import type { ReactElement } from 'react';

/**
 * Lecture de l'arbre JSX d'un tableau, avant le rendu.
 *
 * La façade `kit.tsx` construit ses tableaux à partir de `<Head>`, `<Row>` et
 * `<Cell>`. Cette lecture se fait **avant** le rendu : un composant de ligne
 * personnalisé (`RankingRow`…) y était donc invisible, et ses lignes
 * disparaissaient — constaté le 12/11 sur le site réel, où le classement
 * n'affichait que ses en-têtes.
 *
 * Le module est **pur** (aucun import de `@forge/react`, aucun JSX) pour être
 * testable hors du runtime Forge : la façade lui passe ses composants `Head` et
 * `Row`.
 */

/** Les deux composants que le parseur doit reconnaître. */
export interface TableParts {
  Head: unknown;
  Row: unknown;
}

/** Un composant qui rend une ligne de tableau. */
export type TableRowComponent<P> = ((props: P) => ReactElement | null) & { isTableRow?: true };

/**
 * Déclare un composant comme ligne de tableau.
 *
 * Le composant est ensuite **appelé** par le parseur (il est sans hook : un
 * hook appelé hors du rendu de React échouerait) pour obtenir son `<Row>`,
 * dont les cellules sont alors lues. D'où l'interdiction des hooks, vérifiée
 * ici pour qu'un futur composant ne casse pas les tableaux en silence.
 */
export function markTableRow<P>(component: (props: P) => ReactElement | null): (props: P) => ReactElement | null {
  const source = component.toString();
  if (/\buse(State|Effect|Memo|Ref|Callback|Reducer|Context)\b/.test(source)) {
    throw new Error(
      'markTableRow : le composant de ligne ne doit pas utiliser de hook (il est appelé hors du rendu de React).',
    );
  }
  (component as TableRowComponent<P>).isTableRow = true;
  return component;
}

/** Une cellule lue. */
export interface ParsedCell {
  content: React.ReactNode;
  key: string;
}

/** Un tableau lu. */
export interface ParsedTable {
  head: { cells: ParsedCell[] } | undefined;
  rows: Array<{ key: string; cells: ParsedCell[] }>;
}

/** Construit le parseur d'un tableau pour les composants donnés. */
export function createTableParser(parts: TableParts): { parseTable: (children: React.ReactNode) => ParsedTable } {
  const cellsOf = (node: React.ReactNode): ParsedCell[] => {
    const cells: ParsedCell[] = [];
    Children.forEach(node, (child, index) => {
      if (!isValidElement(child)) return;
      const content = (child.props as { children?: React.ReactNode }).children ?? null;
      cells.push({ key: `c-${index}`, content });
    });
    return cells;
  };

  const parseTable = (children: React.ReactNode): ParsedTable => {
    let head: ParsedTable['head'];
    const rows: ParsedTable['rows'] = [];
    const push = (node: React.ReactNode) => {
      if (!isValidElement(node)) return;
      const props = node.props as { children?: React.ReactNode };
      if (node.type === parts.Head) head = { cells: cellsOf(props.children) };
      else if (node.type === parts.Row) rows.push({ key: `r-${rows.length}`, cells: cellsOf(props.children) });
      else if (typeof node.type === 'symbol') Children.forEach(props.children, push);
      else {
        const resolved = resolveRowComponent(node);
        if (resolved !== null) Children.forEach(resolved, push);
      }
    };
    Children.forEach(children, push);
    return { head, rows };
  };

  return { parseTable };
}

/**
 * Rend un composant de ligne marqué, pour que ses cellules soient lues.
 * Renvoie `null` pour tout autre élément : il n'est pas une ligne.
 */
function resolveRowComponent(node: React.ReactElement): React.ReactNode | null {
  const type = node.type as TableRowComponent<unknown>;
  if (typeof type !== 'function' || type.isTableRow !== true) return null;
  const props = node.props as Record<string, unknown>;
  return (type as (props: unknown) => React.ReactNode)(props);
}
