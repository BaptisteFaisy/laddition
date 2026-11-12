import assert from 'node:assert/strict';
import test from 'node:test';
import { debtRuleKindOf, fieldLabel, validatePatch, zoneModeOf } from './settings-form-values';

test('une saisie vide ne déclenche aucun refus (rien à vérifier)', () => {
  assert.deepEqual(validatePatch({}), []);
});

test('une valeur de règle vide est refusée (item D59)', () => {
  const problems = validatePatch({ debtRuleValue: '   ' });
  assert.deepEqual(problems, [{ field: 'debtRuleValue', kind: 'required' }]);
});

test('un nombre illisible est refusé, pas ignoré en silence', () => {
  const problems = validatePatch({ windowDays: 'beaucoup' });
  assert.deepEqual(problems, [{ field: 'windowDays', kind: 'number' }]);
});

test('un nombre hors bornes est refusé avec ses bornes', () => {
  const problems = validatePatch({ windowDays: 5, relevanceFloor: 3 });
  assert.deepEqual(problems, [
    { field: 'windowDays', kind: 'range', min: 7, max: 365 },
    { field: 'relevanceFloor', kind: 'range', min: 0, max: 1 },
  ]);
});

test('la virgule française est acceptée comme séparateur décimal', () => {
  assert.deepEqual(validatePatch({ occupationCoefficient: '0,5' }), []);
});

test('les valeurs inconnues retombent sur le défaut du domaine', () => {
  assert.equal(debtRuleKindOf('nimp'), 'label');
  assert.equal(debtRuleKindOf('jql'), 'jql');
  assert.equal(zoneModeOf('nimp'), 'component');
  assert.equal(zoneModeOf('service'), 'service');
});

test('chaque champ refusé a un libellé traduisible', () => {
  assert.equal(fieldLabel('windowDays'), 'settings.windowDays');
  assert.equal(fieldLabel('debtRuleValue'), 'settings.debtRuleValue');
  assert.equal(fieldLabel('inconnu'), 'settings.debtRule');
});
