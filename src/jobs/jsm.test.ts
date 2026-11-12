import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSM_FIELDS, jsmJql, MAX_JSM_INCIDENTS, MAX_JSM_PAGES } from './jsm';
import { makeSettings } from './testFixtures';

/**
 * A9 — les incidents des projets JSM entrent dans C1.
 *
 * `settings.jsmProjectKeys` n'était jamais consommé : les incidents d'un projet
 * JSM dédié n'entraient dans aucune preuve, et l'addition du héros du §7.1
 * (« 4 incidents, 11 j-p ») tombait à zéro.
 */

test('aucun projet JSM réglé : aucune requête', () => {
  assert.equal(jsmJql(makeSettings('p1', 'PAY')), '');
  assert.equal(jsmJql(makeSettings('p1', 'PAY', { jsmProjectKeys: ['  ', ''] })), '');
});

test('la requête vise les projets JSM, les incidents, et la fenêtre du projet', () => {
  const jql = jsmJql(makeSettings('p1', 'PAY', { jsmProjectKeys: ['PAYSUP', 'OPS'], windowDays: 90 }));
  assert.match(jql, /project in \("PAYSUP", "OPS"\)/);
  assert.match(jql, /issuetype ~ "incident"/);
  assert.match(jql, /created >= -90d/);
  assert.match(jql, /ORDER BY created ASC/);
});

test('la fenêtre suit le réglage du projet', () => {
  const jql = jsmJql(makeSettings('p1', 'PAY', { jsmProjectKeys: ['OPS'], windowDays: 30 }));
  assert.match(jql, /created >= -30d/);
});

test('les clés vides sont écartées, les espaces rognés', () => {
  const jql = jsmJql(makeSettings('p1', 'PAY', { jsmProjectKeys: [' OPS ', '', 'PAY'] }));
  assert.match(jql, /project in \("OPS", "PAY"\)/);
});

test('la collecte est bornée : ni boucle infinie, ni nuit entière en appels', () => {
  assert.ok(MAX_JSM_PAGES * 100 >= MAX_JSM_INCIDENTS, 'assez de pages pour le plafond');
  assert.ok(MAX_JSM_INCIDENTS <= 500);
  assert.ok(JSM_FIELDS.includes('issuelinks'), 'les liens servent au post-mortem (C1)');
  assert.ok(JSM_FIELDS.includes('components'), 'les composants servent aux zones (§8)');
});
