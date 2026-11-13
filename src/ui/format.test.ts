import assert from 'node:assert/strict';
import test from 'node:test';
import { formatJpUnit, formatPercent, formatPercentValue, formatRangeEur } from './format';

/**
 * Un coût lu hors d'un en-tête unité doit porter son unité : « 62 » ne dit rien
 * (§18). Régression constatée à l'ouverture du gadget — « Cost by team : 62 ».
 */
test('formatJpUnit accole l’unité au coût', () => {
  assert.equal(formatJpUnit('en', 62), '62 p-d');
  assert.equal(formatJpUnit('fr', 62), '62 j-p');
  assert.equal(formatJpUnit('en', 58.5), '58.5 p-d');
  assert.equal(formatJpUnit('fr', 58.5), '58,5 j-p');
});

test('formatJpUnit n’accole pas d’unité à une valeur absente', () => {
  assert.equal(formatJpUnit('en', null), '—');
  assert.equal(formatJpUnit('fr', undefined), '—');
  assert.equal(formatJpUnit('en', Number.NaN), '—');
});

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
