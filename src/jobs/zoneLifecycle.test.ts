import assert from 'node:assert/strict';
import { test } from 'node:test';
import { disappearedZones, zonesInUse, zonesToPurge } from './zoneLifecycle';
import { makeFact } from './testFixtures';

/**
 * B24 — une zone renommée ou fusionnée ne reste pas en base pour toujours.
 *
 * L'ancienne zone doit être marquée « à recalculer » (c'est le trigger qui le
 * fait), puis purgée de `zone_week` dès que plus aucun ticket ne la porte.
 */

test('une zone retirée du ticket a disparu', () => {
  const previous = makeFact({ zones: ['ancienne', 'facturation'] });
  const next = makeFact({ zones: ['facturation'] });
  assert.deepEqual(disappearedZones(previous, next), ['ancienne']);
});

test('un ticket jamais vu n’a aucune zone disparue', () => {
  assert.deepEqual(disappearedZones(null, makeFact({ zones: ['facturation'] })), []);
});

test('un ticket qui gagne une zone n’en perd aucune', () => {
  const previous = makeFact({ zones: ['facturation'] });
  const next = makeFact({ zones: ['facturation', 'notifications'] });
  assert.deepEqual(disappearedZones(previous, next), []);
});

test('les zones en usage sont celles portées par les tickets, sans doublon', () => {
  const facts = [
    makeFact({ issueId: 'i1', zones: ['facturation'] }),
    makeFact({ issueId: 'i2', zones: ['facturation', 'notifications'] }),
    makeFact({ issueId: 'i3', zones: [] }),
  ];
  assert.deepEqual([...zonesInUse(facts)].sort(), ['facturation', 'notifications']);
});

test('seules les zones que plus aucun ticket ne porte sont à purger', () => {
  const inUse = zonesInUse([makeFact({ zones: ['facturation'] })]);
  assert.deepEqual(zonesToPurge(['facturation', 'ancienne', 'ancienne', ''], inUse), ['ancienne']);
  assert.deepEqual(zonesToPurge(['facturation'], inUse), []);
});
