/**
 * Tests du parseur de tableaux (`src/ui/table-parse.ts`).
 *
 * Régression du 12/11 : sur le site réel, le classement n'affichait que ses
 * en-têtes — les lignes venaient d'un composant de ligne personnalisé, invisible
 * du parseur qui lit l'arbre JSX avant le rendu. Ces tests fixent le contrat :
 * une ligne peut être un `<Row>` direct, dans un `Fragment`, ou un composant
 * **marqué** ; un composant non marqué n'est pas une ligne.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';

import { createTableParser, markTableRow } from './table-parse';

const { createElement: h, Fragment } = React;

/** Faux `Head` et `Row` : le parseur ne connaît que leur identité. */
const Head = (props: { children?: React.ReactNode }) => props.children;
const Row = (props: { children?: React.ReactNode }) => props.children;
const Cell = (props: { children?: React.ReactNode }) => props.children;

const { parseTable } = createTableParser({ Head, Row });

describe('parseTable — les lignes sont lues, quel que soit leur forme', () => {
  it('lit des lignes `<Row>` directes', () => {
    const parsed = parseTable([
      h(Head, { key: 'h' }, h(Cell, { key: 'c' }, 'Dette')),
      h(Row, { key: 'r1' }, h(Cell, { key: 'c' }, 'PAY-77')),
      h(Row, { key: 'r2' }, h(Cell, { key: 'c' }, 'PAY-41')),
    ]);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.head?.cells.length, 1);
  });

  it('lit des lignes enveloppées dans un Fragment', () => {
    const parsed = parseTable([
      h(Head, { key: 'h' }, h(Cell, { key: 'c' }, 'Dette')),
      h(Fragment, { key: 'f' }, [h(Row, { key: 'r1' }, h(Cell, { key: 'c' }, 'PAY-77'))]),
    ]);
    assert.equal(parsed.rows.length, 1);
  });

  it('résout un composant de ligne marqué (le correctif du 12/11)', () => {
    const CustomRow = markTableRow((props: { label: string }) =>
      h(Row, { key: 'r1' }, h(Cell, { key: 'c' }, props.label)),
    );
    const parsed = parseTable([h(CustomRow, { key: 'r1', label: 'PAY-77' })]);
    assert.equal(parsed.rows.length, 1, 'la ligne du composant marqué est lue');
    assert.equal(parsed.rows[0]?.cells.length, 1);
  });

  it('ignore un composant qui n’est pas marqué comme ligne', () => {
    const NotARow = (props: { label: string }) => h(Row, { key: 'r1' }, h(Cell, { key: 'c' }, props.label));
    const parsed = parseTable([h(NotARow, { key: 'r1', label: 'PAY-77' })]);
    assert.equal(parsed.rows.length, 0, 'un composant non marqué n’est pas une ligne');
  });

  it('refuse de marquer un composant qui utilise un hook', () => {
    const WithHook = () => {
      const [value] = React.useState(0);
      return h(Row, { key: 'r' }, h(Cell, { key: 'c' }, String(value)));
    };
    assert.throws(() => markTableRow(WithHook), /ne doit pas utiliser de hook/);
  });
});
