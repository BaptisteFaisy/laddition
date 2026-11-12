/**
 * Le double en mémoire de Forge SQL (item F78).
 *
 * Ces tests valident le double lui-même : écriture, relecture, upsert,
 * effacement, jointures, pagination, sous-requête — sans réseau ni Forge.
 * C'est ce double qui rend la couche testable pour les autres lots.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeSql, restoreSql, useFakeSql } from './fakeSql';
import { ensureSchema, isSchemaReady } from './index';
import type { SqlExecutor } from './query';
import { runStatement, selectAllBatched, selectRows, setSqlExecutor } from './query';
import { TABLE_NAMES } from './schema';

const DDL =
  'CREATE TABLE IF NOT EXISTS demo (' +
  'id VARCHAR(16) NOT NULL, project_id VARCHAR(16) NOT NULL, label VARCHAR(32) NULL, ' +
  'score DOUBLE NULL, PRIMARY KEY (id), KEY idx_demo_project (project_id)' +
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';

const OTHER_DDL =
  'CREATE TABLE IF NOT EXISTS autre (' +
  'id VARCHAR(16) NOT NULL, note VARCHAR(32) NULL, PRIMARY KEY (id)' +
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';

/** Un double avec deux tables et trois lignes. */
function seeded() {
  const fake = createFakeSql();
  return fake.executeDDL(DDL).then(() => fake.executeDDL(OTHER_DDL)).then(() => fake);
}

test('insertion puis relecture', async () => {
  const fake = await seeded();
  await fake.execute('INSERT INTO demo (id, project_id, label, score) VALUES (?, ?, ?, ?)', [
    'a1',
    'p1',
    'alpha',
    1.5,
  ]);
  const rows = await fake.select<{ id: string; label: string; score: number }>(
    'SELECT id, label, score FROM demo WHERE project_id = ? ORDER BY id',
    ['p1'],
  );
  assert.deepEqual(rows, [{ id: 'a1', label: 'alpha', score: 1.5 }]);
});

test('upsert : la même clé met à jour au lieu de dupliquer', async () => {
  const fake = await seeded();
  const insert = 'INSERT INTO demo (id, project_id, label, score) VALUES (?, ?, ?, ?) ' +
    'ON DUPLICATE KEY UPDATE project_id = VALUES(project_id), label = VALUES(label), score = VALUES(score)';
  await fake.execute(insert, ['a1', 'p1', 'alpha', 1]);
  await fake.execute(insert, ['a1', 'p1', 'beta', 2]);
  const rows = await fake.select<{ id: string; label: string; score: number }>(
    'SELECT id, label, score FROM demo ORDER BY id',
  );
  assert.deepEqual(rows, [{ id: 'a1', label: 'beta', score: 2 }]);
});

test('insertion groupée : plusieurs n-uplets, une instruction', async () => {
  const fake = await seeded();
  await fake.execute(
    'INSERT INTO demo (id, project_id, label, score) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)',
    ['a1', 'p1', 'un', 1, 'a2', 'p1', 'deux', 2, 'a3', 'p2', 'trois', 3],
  );
  const rows = await fake.select<{ id: string }>('SELECT id FROM demo WHERE project_id = ? ORDER BY id', ['p1']);
  assert.deepEqual(rows.map((row) => row.id), ['a1', 'a2']);
});

test('delete : seul le périmètre demandé disparaît', async () => {
  const fake = await seeded();
  for (const [id, project] of [['a1', 'p1'], ['a2', 'p1'], ['a3', 'p2']] as const) {
    await fake.execute('INSERT INTO demo (id, project_id, label, score) VALUES (?, ?, ?, ?)', [id, project, id, 0]);
  }
  const result = await fake.execute('DELETE FROM demo WHERE project_id = ?', ['p1']);
  assert.equal(result.affectedRows, 2);
  const rows = await fake.select<{ id: string }>('SELECT id FROM demo ORDER BY id');
  assert.deepEqual(rows.map((row) => row.id), ['a3']);
});

test('delete borné : le LIMIT arrête l\'effacement', async () => {
  const fake = await seeded();
  for (const id of ['a1', 'a2', 'a3']) {
    await fake.execute('INSERT INTO demo (id, project_id, label, score) VALUES (?, ?, ?, ?)', [id, 'p1', id, 0]);
  }
  const result = await fake.execute('DELETE FROM demo WHERE project_id = ? LIMIT ?', ['p1', 2]);
  assert.equal(result.affectedRows, 2);
  const rows = await fake.select<{ id: string }>('SELECT id FROM demo ORDER BY id');
  assert.equal(rows.length, 1);
});

test('update : les colonnes ciblées changent, les autres non', async () => {
  const fake = await seeded();
  await fake.execute('INSERT INTO demo (id, project_id, label, score) VALUES (?, ?, ?, ?)', ['a1', 'p1', 'alpha', 1]);
  const result = await fake.execute('UPDATE demo SET label = NULL WHERE project_id = ? AND score < ?', ['p1', 5]);
  assert.equal(result.affectedRows, 1);
  const rows = await fake.select<{ label: unknown; score: number }>('SELECT label, score FROM demo');
  assert.deepEqual(rows, [{ label: null, score: 1 }]);
});

test('jointure interne et jointure gauche', async () => {
  const fake = await seeded();
  await fake.execute('INSERT INTO demo (id, project_id, label, score) VALUES (?, ?, ?, ?)', ['a1', 'p1', 'x', 1]);
  await fake.execute('INSERT INTO autre (id, note) VALUES (?, ?)', ['a1', 'vue']);
  const inner = await fake.select<{ id: string; note: string }>(
    'SELECT d.id, a.note FROM demo d JOIN autre a ON a.id = d.id WHERE d.project_id = ? ORDER BY d.id',
    ['p1'],
  );
  assert.deepEqual(inner, [{ id: 'a1', note: 'vue' }]);
  await fake.execute('INSERT INTO demo (id, project_id, label, score) VALUES (?, ?, ?, ?)', ['a2', 'p1', 'y', 2]);
  const left = await fake.select<{ id: string; note: unknown }>(
    'SELECT d.id, a.note FROM demo d LEFT JOIN autre a ON a.id = d.id WHERE d.project_id = ? ORDER BY d.id',
    ['p1'],
  );
  assert.deepEqual(left, [
    { id: 'a1', note: 'vue' },
    { id: 'a2', note: null },
  ]);
});

test('sous-requête dans un IN (effacement en cascade)', async () => {
  const fake = await seeded();
  await fake.execute('INSERT INTO demo (id, project_id, label, score) VALUES (?, ?, ?, ?)', ['a1', 'p1', 'x', 1]);
  await fake.execute('INSERT INTO autre (id, note) VALUES (?, ?)', ['a1', 'garde']);
  await fake.execute('INSERT INTO autre (id, note) VALUES (?, ?)', ['a9', 'orpheline']);
  await fake.execute('DELETE FROM autre WHERE id IN (SELECT id FROM demo WHERE project_id = ?)', ['p1']);
  const rows = await fake.select<{ id: string }>('SELECT id FROM autre ORDER BY id');
  assert.deepEqual(rows.map((row) => row.id), ['a9']);
});

test('COALESCE, IS NULL et comparaisons de dates', async () => {
  const fake = await seeded();
  await fake.execute('INSERT INTO demo (id, project_id, label, score) VALUES (?, ?, ?, ?)', ['a1', 'p1', null, 3]);
  const nulls = await fake.select<{ id: string }>('SELECT id FROM demo WHERE label IS NULL');
  assert.equal(nulls.length, 1);
  const coalesced = await fake.select<{ id: string }>(
    "SELECT id FROM demo WHERE COALESCE(label, 'x') = ?",
    ['x'],
  );
  assert.equal(coalesced.length, 1);
  const compared = await fake.select<{ id: string }>('SELECT id FROM demo WHERE score >= ? AND score < ?', [3, 4]);
  assert.equal(compared.length, 1);
});

test('pagination : LIMIT et OFFSET, et lecture par lots', async (t) => {
  const fake = useFakeSql();
  t.after(restoreSql);
  await fake.executeDDL(DDL);
  for (let index = 0; index < 5; index += 1) {
    await fake.execute('INSERT INTO demo (id, project_id, label, score) VALUES (?, ?, ?, ?)', [
      `a${index}`,
      'p1',
      `l${index}`,
      index,
    ]);
  }
  const page = await fake.select<{ id: string }>('SELECT id FROM demo ORDER BY id LIMIT ? OFFSET ?', [2, 2]);
  assert.deepEqual(page.map((row) => row.id), ['a2', 'a3']);
  const all = await selectAllBatched<{ id: string }>('SELECT id FROM demo ORDER BY id', [], { batchSize: 2 });
  assert.equal(all.length, 5);
});

test('COUNT(*) et information_schema.tables', async () => {
  const fake = await seeded();
  await fake.execute('INSERT INTO demo (id, project_id, label, score) VALUES (?, ?, ?, ?)', ['a1', 'p1', 'x', 1]);
  const counted = await fake.select<{ total: unknown }>('SELECT COUNT(*) AS total FROM demo WHERE project_id = ?', [
    'p1',
  ]);
  assert.equal(Number(counted[0]?.total), 1);
  const tables = await fake.select<{ name: string }>(
    'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?, ?)',
    ['demo', 'autre'],
  );
  assert.equal(tables.length, 2);
});

test('le double refuse une instruction qu\'il ne connaît pas', async () => {
  const fake = await seeded();
  await assert.rejects(() => fake.execute('TRUNCATE TABLE demo'), /instruction non supportée/);
});

test('le double journalise le SQL et ses paramètres liés', async () => {
  const fake = await seeded();
  await fake.execute('INSERT INTO demo (id, project_id, label, score) VALUES (?, ?, ?, ?)', ['a1', 'p1', 'x', 1]);
  const last = fake.log[fake.log.length - 1];
  assert.equal(last?.kind, 'insert');
  assert.match(last?.query ?? '', /VALUES \(\?, \?, \?, \?\)/);
  assert.deepEqual(last?.params, ['a1', 'p1', 'x', 1]);
});

test('useFakeSql installe le double pour toute la couche, restoreSql le rend', async (t) => {
  const fake = useFakeSql();
  t.after(restoreSql);
  await ensureSchema();
  assert.equal(await isSchemaReady(), true);
  const tables = fake.store.tables;
  for (const name of TABLE_NAMES) assert.ok(tables.has(name), `table ${name} absente du double`);
  // Aucune requête réelle n'est partie : le journal ne contient que le double.
  assert.ok(fake.log.length >= TABLE_NAMES.length);
});

test('setSqlExecutor branche n\'importe quel exécuteur et rend le précédent', async (t) => {
  const calls: string[] = [];
  const recording: SqlExecutor = {
    select: async () => {
      calls.push('select');
      return [];
    },
    execute: async () => {
      calls.push('execute');
      return { affectedRows: 0, fieldCount: 0, info: '', insertId: 0, serverStatus: 0, warningStatus: 0 };
    },
    ddl: async () => {
      calls.push('ddl');
    },
  };
  const previous = setSqlExecutor(recording);
  t.after(() => setSqlExecutor(previous));
  await selectRows('SELECT project_id FROM settings ORDER BY project_id');
  await runStatement('DELETE FROM settings WHERE project_id = ?', ['p1']);
  assert.deepEqual(calls, ['select', 'execute']);
});
