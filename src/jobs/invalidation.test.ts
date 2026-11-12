import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Invalidation } from './invalidation';
import { marksAfter } from './invalidation';

/**
 * B20 — l'invalidation est consommée, pas effacée.
 *
 * `clearInvalid` vidait toute la table à la fin du recalcul : une modification
 * survenue **pendant** le calcul perdait sa marque et n'était jamais reprise.
 * Le nettoyage est désormais borné dans le temps (`clearInvalidBefore`) ;
 * `marksAfter` dit ce qui reste en attente.
 */

const START = '2026-04-20T02:00:00.000Z';

function mark(target: string, at: string, kind: Invalidation['kind'] = 'zone'): Invalidation {
  return { kind, target, at };
}

test('les marques antérieures au recalcul sont traitées', () => {
  const marks = [mark('facturation', '2026-04-19T22:00:00.000Z'), mark('taxes', START)];
  assert.deepEqual(marksAfter(marks, START), []);
});

test('une marque née pendant le recalcul reste en attente', () => {
  const during = mark('notifications', '2026-04-20T02:05:00.000Z');
  const marks = [mark('facturation', '2026-04-19T22:00:00.000Z'), during];
  assert.deepEqual(marksAfter(marks, START), [during]);
});

test('les deux sortes de marques sont conservées', () => {
  const marks = [
    mark('i1', '2026-04-20T03:00:00.000Z', 'attribution'),
    mark('facturation', '2026-04-20T03:00:00.000Z'),
  ];
  assert.equal(marksAfter(marks, START).length, 2);
});

test('une marque sans horodatage n’est pas devinée', () => {
  assert.deepEqual(marksAfter([mark('facturation', '')], START), []);
});
