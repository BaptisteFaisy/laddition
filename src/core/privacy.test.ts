import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertNoPersonRanking, maskHidden, redactName } from './privacy.ts';

test('masquage : éléments visibles séparés, le reste compté', () => {
  const items = [
    { id: 'a', visible: true },
    { id: 'b', visible: false },
    { id: 'c', visible: true },
  ];

  const masked = maskHidden(items);

  assert.deepEqual(
    masked.visible.map((item) => item.id),
    ['a', 'c'],
  );
  assert.equal(masked.hiddenCount, 1);
});

test('masquage : rien à cacher, rien de perdu', () => {
  const items = [{ id: 'a', visible: true }];

  const masked = maskHidden(items);

  assert.equal(masked.visible.length, 1);
  assert.equal(masked.hiddenCount, 0);
});

test('classement par zone ou par ticket accepté', () => {
  const rows: Array<Record<string, unknown>> = [
    { key: 'PA-1', zone: 'api', lowJp: 4, highJp: 6 },
    { zone: 'front', totalJp: 12, evidenceIds: ['e1'] },
  ];

  assert.doesNotThrow(() => assertNoPersonRanking(rows));
});

test('classement par personne refusé', () => {
  assert.throws(() => assertNoPersonRanking([{ assignee: 'a.martin' }]), /personne/);
  assert.throws(() => assertNoPersonRanking([{ author: 'a.martin' }]), /personne/);
  assert.throws(() => assertNoPersonRanking([{ user: 'a.martin' }]), /personne/);
});

test('classement par personne refusé même en camelCase ou snake_case', () => {
  assert.throws(() => assertNoPersonRanking([{ assigneeCount: 3 }]), /personne/);
  assert.throws(() => assertNoPersonRanking([{ user_name: 'x' }]), /personne/);
  assert.throws(() => assertNoPersonRanking([{ topAuthors: [] }]), /personne/);
});

test('redaction : initiale conservée', () => {
  assert.equal(redactName('Alice Martin'), 'A.');
  assert.equal(redactName('émile'), 'É.');
  assert.equal(redactName('  bob  '), 'B.');
});

test('redaction : rien à désigner, null', () => {
  assert.equal(redactName(null), null);
  assert.equal(redactName(''), null);
  assert.equal(redactName('   '), null);
});
