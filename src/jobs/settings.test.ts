import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProjectSettings } from '../core/types';
import { PROJECT_SCOPE, recalcFingerprint, saveProjectSettings, settingsAffectRecalc } from './settings';
import { makeSettings } from './testFixtures';

/**
 * B27 — changer une règle change les chiffres.
 *
 * `saveSettings` écrivait les réglages sans rien invalider : après un changement
 * de règle de dette ou de mode de zone, les écrans continuaient d'afficher des
 * additions calculées avec les anciennes règles, sans rien dire, jusqu'à la nuit
 * suivante.
 */

const BASE: ProjectSettings = makeSettings('p1', 'PAY');

test('un premier enregistrement marque le projet à recalculer', () => {
  assert.equal(settingsAffectRecalc(null, BASE), true);
});

test('des réglages inchangés ne marquent rien', () => {
  assert.equal(settingsAffectRecalc(BASE, { ...BASE }), false);
  assert.equal(recalcFingerprint(BASE), recalcFingerprint({ ...BASE }));
});

test('la règle de dette et le mode de zone marquent le projet', () => {
  assert.equal(settingsAffectRecalc(BASE, { ...BASE, debtRule: { kind: 'label', value: 'dette' } }), true);
  assert.equal(settingsAffectRecalc(BASE, { ...BASE, zoneMode: 'label' }), true);
  assert.equal(settingsAffectRecalc(BASE, { ...BASE, zoneLabelField: 'zone' }), true);
});

test('les paramètres de calcul marquent le projet', () => {
  assert.equal(settingsAffectRecalc(BASE, { ...BASE, windowDays: 30 }), true);
  assert.equal(settingsAffectRecalc(BASE, { ...BASE, hoursPerDay: 8 }), true);
  assert.equal(settingsAffectRecalc(BASE, { ...BASE, relevanceFloor: 0.5 }), true);
  assert.equal(settingsAffectRecalc(BASE, { ...BASE, maxIncidentPeople: 3 }), true);
});

test('les projets JSM et les équipes marquent le projet', () => {
  assert.equal(settingsAffectRecalc(BASE, { ...BASE, jsmProjectKeys: ['PAYSUP'] }), true);
  assert.equal(settingsAffectRecalc(BASE, { ...BASE, teamByZone: { facturation: 'équipe A' } }), true);
});

test('l’ordre des listes ne change rien', () => {
  const one = { ...BASE, jsmProjectKeys: ['A', 'B'], teamByZone: { x: '1', y: '2' } };
  const other = { ...BASE, jsmProjectKeys: ['B', 'A'], teamByZone: { y: '2', x: '1' } };
  assert.equal(settingsAffectRecalc(one, other), false);
});

test('ce qui ne change aucun chiffre ne marque rien', () => {
  assert.equal(settingsAffectRecalc(BASE, { ...BASE, dayRateEur: 900 }), false);
  assert.equal(settingsAffectRecalc(BASE, { ...BASE, demoData: true }), false);
});

test('saveProjectSettings marque le projet quand le calcul change', async () => {
  const marks: Array<{ projectId: string; at: string }> = [];
  const written: ProjectSettings[] = [];
  await saveProjectSettings({ ...BASE, zoneMode: 'label' }, {
    read: async () => BASE,
    write: async (settings) => {
      written.push(settings);
    },
    mark: async (projectId, at) => {
      marks.push({ projectId, at });
    },
  });
  assert.equal(written.length, 1, 'les réglages sont écrits dans tous les cas');
  assert.equal(marks.length, 1);
  assert.equal(marks[0]?.projectId, 'p1');
});

test('saveProjectSettings ne marque rien quand seul l’affichage change', async () => {
  const marks: string[] = [];
  await saveProjectSettings({ ...BASE, dayRateEur: 900 }, {
    read: async () => BASE,
    write: async () => undefined,
    mark: async (projectId) => {
      marks.push(projectId);
    },
  });
  assert.deepEqual(marks, []);
});

test('la marque couvre tout le projet, pas une seule zone', () => {
  assert.equal(PROJECT_SCOPE, '*');
});
