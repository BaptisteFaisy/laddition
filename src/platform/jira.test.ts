import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyItemsOf } from './jira';
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
