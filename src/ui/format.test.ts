import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRangeEur } from './format';

test('la fourchette s’affiche en euros au taux journalier du projet (item 65)', () => {
  assert.equal(formatRangeEur('en', 2, 3, 500), '€1000–€1500');
  assert.equal(formatRangeEur('fr', 2, 2, 500), '1000 €');
});

test('sans taux renseigné, aucun prix n’est inventé (item 65)', () => {
  assert.equal(formatRangeEur('fr', 2, 3, undefined), '—');
  assert.equal(formatRangeEur('fr', 2, 3, 0), '—');
});
