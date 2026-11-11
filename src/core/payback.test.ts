import test from 'node:test';
import assert from 'node:assert/strict';

import type { ProjectSettings } from './types';
import { makeSettings } from './settings';
import { payback } from './payback';

/** Réglages de référence : 0,7 de persistance, fenêtre de 90 jours (§9, §11). */
const SETTINGS: ProjectSettings = makeSettings('p1', 'PROJ');

test('coût évitable, retours et délai de retour sur une addition chiffrée', () => {
  const result = payback(10, 14, 20, SETTINGS);

  assert.equal(result.avoidableJp, 14); // 10 × 2 trimestres × 0,7
  assert.equal(result.roiLow, 0.7); // 14 / 20
  assert.equal(result.roiHigh, 0.98); // (14 × 2 × 0,7) / 20
  assert.equal(result.paybackDays, 180); // 20 / (10 × 7 / 90) × 7
});

test('sans remboursement chiffré, le coût évitable est calculé quand même', () => {
  const result = payback(10, 14, null, SETTINGS);

  assert.equal(result.avoidableJp, 14);
  assert.equal(result.roiLow, null);
  assert.equal(result.roiHigh, null);
  assert.equal(result.paybackDays, null);
});

test('sans addition basse, aucun coût évitable ni délai de retour', () => {
  const result = payback(0, 14, 20, SETTINGS);

  assert.equal(result.avoidableJp, null);
  assert.equal(result.roiLow, null);
  assert.equal(result.paybackDays, null);
  // La borne haute ne dépend que de l'addition haute : elle reste calculable.
  assert.equal(result.roiHigh, 0.98);
});

test('un remboursement nul ne provoque jamais de division par zéro', () => {
  const result = payback(10, 14, 0, SETTINGS);

  assert.equal(result.avoidableJp, 14);
  assert.equal(result.roiLow, null);
  assert.equal(result.roiHigh, null);
  assert.equal(result.paybackDays, null);
});

test('le délai de retour suit la fenêtre d’analyse du projet', () => {
  const shortWindow: ProjectSettings = makeSettings('p1', 'PROJ', { windowDays: 30 });
  const result = payback(3, 5, 7, shortWindow);

  // Coût hebdomadaire moyen = 3 / (30 / 7) = 0,7 j-p ; 7 / 0,7 × 7 = 70 jours.
  assert.equal(result.paybackDays, 70);
});

test('tous les résultats sont arrondis au centième', () => {
  const result = payback(1.13, 2.06, 3, SETTINGS);

  assert.equal(result.avoidableJp, 1.58); // 1,13 × 2 × 0,7 = 1,582
  assert.equal(result.roiLow, 0.53); // 1,58 / 3 = 0,5266…
  assert.equal(result.roiHigh, 0.96); // 2,884 / 3 = 0,9613…
  assert.equal(result.paybackDays, 238.94); // 3 / (1,13 × 7 / 90) × 7 = 238,938…
});

test('un facteur de persistance absurde ne casse pas le calcul', () => {
  const broken: ProjectSettings = makeSettings('p1', 'PROJ', { persistenceFactor: 0 });
  const result = payback(10, 14, 20, broken);

  assert.equal(result.avoidableJp, 0);
  assert.equal(result.roiLow, 0);
  assert.equal(result.roiHigh, 0);
  assert.equal(result.paybackDays, 180);
});

test('aucune valeur rendue n’est NaN ni infinie', () => {
  const result = payback(Number.NaN, Number.POSITIVE_INFINITY, Number.NaN, SETTINGS);

  assert.equal(result.avoidableJp, null);
  assert.equal(result.roiLow, null);
  assert.equal(result.roiHigh, null);
  assert.equal(result.paybackDays, null);
});
