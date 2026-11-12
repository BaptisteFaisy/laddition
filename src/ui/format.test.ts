import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPercent, formatPercentValue, formatRangeEur } from './format';

test('la fourchette s’affiche en euros au taux journalier du projet (item 65)', () => {
  assert.equal(formatRangeEur('en', 2, 3, 500), '€1000–€1500');
  assert.equal(formatRangeEur('fr', 2, 2, 500), '1000 €');
});

test('sans taux renseigné, aucun prix n’est inventé (item 65)', () => {
  assert.equal(formatRangeEur('fr', 2, 3, undefined), '—');
  assert.equal(formatRangeEur('fr', 2, 3, 0), '—');
});

/**
 * Les parts de `DataQuality` sont des **pourcentages** (0-100), pas des ratios :
 * les passer à `formatPercent` (qui attend 0-1) affichait « 147 % » pour 1,47 %.
 */
test('formatPercentValue affiche un pourcentage déjà calculé', () => {
  assert.equal(formatPercentValue('en', 1.47), '1.5%');
  assert.equal(formatPercentValue('fr', 1.47), '1,5 %');
  assert.equal(formatPercentValue('en', 0), '0%');
});

test('formatPercentValue rend la valeur absente plutôt qu’un pourcentage faux', () => {
  assert.equal(formatPercentValue('en', null), '—');
  assert.equal(formatPercentValue('en', undefined), '—');
  assert.equal(formatPercentValue('en', Number.NaN), '—');
});

test('formatPercentValue ne multiplie pas par cent, contrairement à formatPercent', () => {
  assert.equal(formatPercent('en', 1.47), '147%');
  assert.equal(formatPercentValue('en', 1.47), '1.5%');
});
