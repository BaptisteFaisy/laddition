import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffMs, historyItemsOf, retryDelayMs } from './jira';
import type { ChangelogPage } from './jira-types';

/**
 * Le changelog a deux formes selon l'appel :
 *   - `GET /issue/{key}/changelog` (paginé)  → `values` + `nextPage` + `isLast`
 *   - `GET /issue/{key}?expand=changelog`    → `changelog.histories`
 *
 * Ne lire que `histories` faisait des historiques vides sur un vrai site :
 * c'est ce qui a été mesuré le 11/11 sur one-atlas-cndz (ITO-9641, `total: 11`,
 * `histories` absent, 11 entrées sous `values`). Ces tests verrouillent les
 * deux formes pour que la régression ne repasse pas.
 */

const ENTRY = { id: '242868', created: '2026-05-04T09:12:00.000+0000', items: [{ field: 'status', to: '3', toString: 'In Progress' }] };

test('changelog paginé : les entrées sont sous `values`', () => {
  const page: ChangelogPage = { values: [ENTRY], total: 11, isLast: false, startAt: 0, maxResults: 3 };
  assert.equal(historyItemsOf(page).length, 1);
  assert.equal(historyItemsOf(page)[0]?.id, '242868');
});

test('changelog embarqué : les entrées sont sous `histories`', () => {
  const page: ChangelogPage = { histories: [ENTRY, ENTRY], total: 2 };
  assert.equal(historyItemsOf(page).length, 2);
});

test('les deux formes presentes : values l emporte (jamais de doublon)', () => {
  const page: ChangelogPage = { values: [ENTRY], histories: [ENTRY, ENTRY] };
  assert.equal(historyItemsOf(page).length, 1);
});

test('page vide ou illisible : liste vide, jamais d exception', () => {
  assert.deepEqual(historyItemsOf({}), []);
  assert.deepEqual(historyItemsOf({ total: 11, isLast: true }), []);
  assert.deepEqual(historyItemsOf({ values: [] }), []);
});

/**
 * Reprises bornées sur 429/503 (C32) : `Retry-After` prime, sinon repli
 * exponentiel plafonné. Trois tentatives au plus, jamais de boucle infinie.
 */

test('429 avec Retry-After : on attend ce que Jira demande', () => {
  assert.equal(retryDelayMs('2', 1), 2000);
  assert.equal(retryDelayMs('0', 1), 0);
  assert.equal(retryDelayMs('1.5', 2), 1500);
});

test('Retry-After démesuré ou illisible : repli exponentiel, plafonné à 8 s', () => {
  assert.equal(retryDelayMs('999', 1), 8000);
  assert.equal(retryDelayMs('bientôt', 1), 500);
  assert.equal(retryDelayMs(null, 1), 500);
  assert.equal(retryDelayMs(null, 2), 1000);
});

test('repli exponentiel borné : 500 ms, 1 s, 2 s, puis plafond', () => {
  assert.deepEqual([1, 2, 3, 4, 9].map(backoffMs), [500, 1000, 2000, 4000, 8000]);
  assert.equal(backoffMs(0), 500);
});
