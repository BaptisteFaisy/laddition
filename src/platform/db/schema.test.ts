/**
 * Vérifications du DDL (§16, §17) — sans base de données, sans réseau.
 *
 * Ces tests protègent les propriétés que Forge SQL impose : les tables
 * existent, aucune clé étrangère n'est déclarée, chaque entrée ne contient
 * qu'une seule instruction — plus celles ajoutées par le lot C : un index par
 * colonne réellement filtrée (C33), une colonne de marquage pour l'écriture en
 * deux temps (C35), et des migrations qui n'ajoutent que ce qui manque.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCHEMA_MIGRATIONS, SCHEMA_STATEMENTS, TABLE_NAMES } from './schema';

/** Le DDL d'une table, pour les assertions ciblées. */
function ddlOf(table: string): string {
  const statement = SCHEMA_STATEMENTS.find((item) => item.includes(` ${table} (`));
  assert.ok(statement, `table ${table} absente du DDL`);
  return statement as string;
}

test('le schéma déclare les tables du §16 et le cache des scores', () => {
  assert.equal(TABLE_NAMES.length, 12);
  const ddl = SCHEMA_STATEMENTS.join('\n');
  for (const table of TABLE_NAMES) {
    assert.match(ddl, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`), `table ${table} absente du DDL`);
  }
  assert.equal(SCHEMA_STATEMENTS.length, TABLE_NAMES.length);
});

test('aucune instruction ne déclare de clé étrangère', () => {
  for (const statement of [...SCHEMA_STATEMENTS, ...SCHEMA_MIGRATIONS]) {
    assert.ok(!/FOREIGN\s+KEY/i.test(statement), 'Forge SQL ne supporte pas les clés étrangères (§17)');
  }
});

test('chaque entrée ne contient qu’une seule instruction', () => {
  for (const statement of [...SCHEMA_STATEMENTS, ...SCHEMA_MIGRATIONS]) {
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

test('C33 — chaque date de la fenêtre d’analyse porte son index', () => {
  const facts = ddlOf('issue_fact');
  assert.match(facts, /KEY idx_issue_fact_created \(project_id, created_at\)/);
  assert.match(facts, /KEY idx_issue_fact_resolved \(project_id, resolved_at\)/);
  assert.match(facts, /KEY idx_issue_fact_closed \(project_id, closed_at\)/);
  assert.match(facts, /KEY idx_issue_fact_key \(issue_key\)/);
});

test('C35 — les tables remplacées portent la colonne de marquage', () => {
  for (const table of ['status_span', 'evidence', 'attribution', 'baseline']) {
    assert.match(ddlOf(table), /batch_id VARCHAR\(64\) NULL/, `${table} sans batch_id`);
  }
});

test('C37 — la purge a un index sur chaque colonne d’ancienneté', () => {
  assert.match(ddlOf('zone_week'), /KEY idx_zone_week_project_week \(project_id, week\)/);
  assert.match(ddlOf('evidence'), /KEY idx_evidence_project_occurred \(project_id, occurred_at\)/);
  assert.match(ddlOf('score_cache'), /KEY idx_score_cache_computed \(project_id, computed_at\)/);
  assert.match(ddlOf('repayment'), /KEY idx_repayment_project_published \(project_id, published_at\)/);
});

test('B16 — le cache des scores est keyed par empreinte et projet', () => {
  const scores = ddlOf('score_cache');
  assert.match(scores, /fingerprint VARCHAR\(128\) NOT NULL/);
  assert.match(scores, /project_id VARCHAR\(64\) NOT NULL/);
  assert.match(scores, /relevance DOUBLE NOT NULL/);
  assert.match(scores, /rationale VARCHAR\(1024\) NOT NULL/);
  assert.match(scores, /PRIMARY KEY \(fingerprint, project_id\)/);
});

test('A4 — les colonnes du contrat sont stockées', () => {
  assert.match(ddlOf('issue_fact'), /story_points DOUBLE NULL/);
  assert.match(ddlOf('issue_fact'), /history_truncated TINYINT\(1\) NOT NULL/);
  assert.match(ddlOf('debt_bill'), /blocked_reason VARCHAR\(16\) NULL/);
  assert.match(ddlOf('settings'), /story_point_field VARCHAR\(128\) NULL/);
  assert.match(ddlOf('bootstrap_progress'), /error VARCHAR\(512\) NULL/);
  assert.match(ddlOf('bootstrap_progress'), /attempts INT NOT NULL/);
});

test('les migrations n’ajoutent que des colonnes et des index', () => {
  assert.ok(SCHEMA_MIGRATIONS.length > 0);
  for (const statement of SCHEMA_MIGRATIONS) {
    assert.match(statement, /^ALTER TABLE [a-z_]+ ADD (COLUMN |KEY )/i, `migration inattendue : ${statement}`);
    assert.ok(!/DROP|MODIFY|CHANGE|RENAME/i.test(statement), 'une migration ne détruit rien');
  }
});

test('les migrations couvrent tout ce que le DDL ajoute aux tables existantes', () => {
  const migrations = SCHEMA_MIGRATIONS.join('\n');
  // Colonnes ajoutées à des tables déjà installées.
  for (const added of [
    'story_points',
    'history_truncated',
    'batch_id',
    'blocked_reason',
    'story_point_field',
    'error',
    'attempts',
  ]) {
    assert.ok(migrations.includes(added), `colonne ${added} absente des migrations`);
  }
  // Index ajoutés à des tables déjà installées (`score_cache` est neuve : rien à migrer).
  for (const index of [
    'idx_issue_fact_resolved',
    'idx_issue_fact_closed',
    'idx_evidence_project_batch',
    'idx_attribution_project_batch',
    'idx_baseline_project_batch',
    'idx_debt_bill_computed',
    'idx_repayment_project_closed',
    'idx_repayment_project_published',
    'idx_rejection_rejected',
  ]) {
    assert.ok(migrations.includes(index), `index ${index} absent des migrations`);
  }
});
