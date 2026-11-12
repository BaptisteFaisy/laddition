/**
 * Droits du lecteur sur les preuves (item 4, §18).
 *
 * Propriété vérifiée : `withReaderRights` marque `visible: false` les preuves
 * dont le ticket source est hors des droits du lecteur courant, et une lecture
 * en échec ne masque rien — elle le dit (`checked: false`), jamais de trou
 * silencieux. La lecture réseau (`visibleKeysForUser`) est injectée : seules
 * les parties pures sont testées ici, comme dans `jobs/issueSync.test.ts`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { evidence } from '../platform/db/testFixtures';
import { withReaderRights } from './state';

test('item 4 — une preuve hors des droits du lecteur est marquée invisible', async () => {
  const items = [
    evidence({ id: 'ev1', sourceKey: 'PAY-1' }),
    evidence({ id: 'ev2', sourceKey: 'PAY-2' }),
  ];
  const rights = await withReaderRights(items, async () => new Set(['PAY-1']));
  assert.equal(rights.checked, true);
  assert.deepEqual(rights.evidence.map((item) => [item.id, item.visible]), [
    ['ev1', true],
    ['ev2', false],
  ]);
  assert.equal(rights.evidence[0], items[0], 'une preuve visible n’est pas recopiée');
});

test('item 4 — une preuve déjà masquée le reste : le marquage ne démasque jamais', async () => {
  const items = [evidence({ id: 'ev2', sourceKey: 'PAY-2', visible: false })];
  const rights = await withReaderRights(items, async () => new Set(['PAY-2']));
  assert.equal(rights.evidence[0]?.visible, false);
});

test('item 4 — le lecteur reçoit les clés distinctes, sans clé vide', async () => {
  const items = [
    evidence({ id: 'a', sourceKey: 'PAY-1' }),
    evidence({ id: 'b', sourceKey: 'PAY-1' }),
    evidence({ id: 'c', sourceKey: '' }),
  ];
  let received: readonly string[] = [];
  await withReaderRights(items, async (keys) => {
    received = keys;
    return new Set(['PAY-1']);
  });
  assert.deepEqual([...received], ['PAY-1']);
});

test('item 4 — une lecture en échec ne masque rien et le signale', async () => {
  const items = [evidence({ id: 'ev1', sourceKey: 'PAY-9' })];
  const rights = await withReaderRights(items, async () => null);
  assert.equal(rights.checked, false);
  assert.deepEqual(rights.evidence, items);
});

test('item 4 — sans preuve, la lecture par défaut aboutit sans Jira', async () => {
  const rights = await withReaderRights([]);
  assert.equal(rights.checked, true);
  assert.deepEqual(rights.evidence, []);
});
