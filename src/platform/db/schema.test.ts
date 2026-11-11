/**
 * Vérifications du DDL (§16, §17) — sans base de données, sans réseau.
 *
 * Ces tests protègent trois propriétés que Forge SQL impose :
 * les onze tables existent, aucune clé étrangère n'est déclarée, et chaque
 * entrée de `SCHEMA_STATEMENTS` ne contient qu'une seule instruction.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCHEMA_STATEMENTS, TABLE_NAMES } from './schema.ts';

test('le schéma déclare les onze tables du §16', () => {
  assert.equal(TABLE_NAMES.length, 11);
  const ddl = SCHEMA_STATEMENTS.join('\n');
  for (const table of TABLE_NAMES) {
    assert.match(ddl, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`), `table ${table} absente du DDL`);
  }
  assert.equal(SCHEMA_STATEMENTS.length, TABLE_NAMES.length);
});

test('aucune instruction ne déclare de clé étrangère', () => {
  for (const statement of SCHEMA_STATEMENTS) {
    assert.ok(!/FOREIGN\s+KEY/i.test(statement), 'Forge SQL ne supporte pas les clés étrangères (§17)');
  }
});

test('chaque entrée ne contient qu’une seule instruction', () => {
  for (const statement of SCHEMA_STATEMENTS) {
    const instructions = statement.split(';').filter((part) => part.trim().length > 0);
    assert.equal(instructions.length, 1, `instruction multiple : ${statement.slice(0, 60)}…`);
  }
});

test('les colonnes de filtre sont indexées', () => {
  const ddl = SCHEMA_STATEMENTS.join('\n');
  assert.match(ddl, /KEY idx_issue_fact_project \(project_id, is_debt\)/);
  assert.match(ddl, /KEY idx_evidence_project_zone \(project_id, zone\)/);
  assert.match(ddl, /KEY idx_attribution_debt \(debt_issue_id\)/);
  assert.match(ddl, /KEY idx_zone_week_project_week \(project_id, week\)/);
});
