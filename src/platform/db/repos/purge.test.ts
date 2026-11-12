/**
 * Purge bornée du stockage (item C37, §17 : 1 Gio par installation).
 *
 * On vérifie les deux garanties du produit : rien de plus récent que la
 * fenêtre de la dette morte (180 jours) n'est touché, et les bulletins — qui
 * sont autoportants — survivent à la purge des semaines. On vérifie aussi que
 * la purge est bornée (plusieurs petites requêtes), idempotente, et qu'elle
 * ne déborde pas sur un autre projet.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeSettings } from '../../../core/settings';
import { addDays, weekKey } from '../../../core/time';
import { toDbDate, toDbDateRequired, zeroFamilyNumbers } from '../rows';
import { runDdl, runStatement, selectRows } from '../query';
import { restoreSql, useFakeSql } from '../fakeSql';
import { ensureSchema } from '../index';

import { listEvidence, replaceAttributions, replaceEvidence } from './costs';
import { getIssueFact, replaceStatusSpans, upsertIssueFacts } from './issues';
import { listBills, upsertBills, upsertZoneWeek } from './bills';
import { listRepayments, saveSettings, upsertRepayments } from './project';
import { PURGE_DEAD_DAYS, purgeAllProjects, purgeCutoffs, purgeProject } from './purge';
import { listScores, saveScores } from './scores';
import { attribution, debtBill, evidence, issueFact, repayment, statusSpan } from '../testFixtures';

const NOW = '2026-11-11T00:00:00.000Z';
/** Bien avant la fenêtre de 180 jours. */
const OLD = '2026-01-10T00:00:00.000Z';
/** Dans la fenêtre d'analyse (90 jours). */
const RECENT = '2026-10-20T00:00:00.000Z';

/** Double installé, schéma créé. */
async function installed(t: { after(hook: () => void): void }) {
  const fake = useFakeSql();
  t.after(restoreSql);
  await ensureSchema();
  return fake;
}

/** Un projet avec du vieux et du récent dans toutes les tables purgeables. */
async function seed(projectId = 'p1'): Promise<void> {
  // Les clés primaires sont globales : chaque projet porte ses propres identifiants.
  const id = (base: string): string => `${projectId}-${base}`;
  await upsertIssueFacts([
    // Vieux et clos : hors de toute fenêtre, description et séjours purgeables.
    issueFact({
      issueId: id('old-closed'),
      key: `${projectId}-1`,
      projectId,
      createdAt: OLD,
      resolvedAt: OLD,
      closedAt: OLD,
      description: 'vieux corps',
    }),
    // Vieux mais résolu récemment : dans la fenêtre, ses séjours et son texte restent.
    issueFact({
      issueId: id('old-recent'),
      key: `${projectId}-2`,
      projectId,
      createdAt: OLD,
      resolvedAt: RECENT,
      description: 'corps récent',
    }),
    // Récent : rien ne bouge.
    issueFact({ issueId: id('recent'), key: `${projectId}-3`, projectId, createdAt: RECENT, description: 'corps' }),
  ]);
  await replaceStatusSpans(id('old-closed'), [statusSpan({ issueId: id('old-closed'), startedAt: OLD })]);
  await replaceStatusSpans(id('old-recent'), [statusSpan({ issueId: id('old-recent'), startedAt: OLD })]);
  await replaceStatusSpans(id('recent'), [statusSpan({ issueId: id('recent'), startedAt: RECENT })]);

  await replaceEvidence(projectId, [
    evidence({ id: id('e-old'), occurredAt: OLD, sourceIssueId: id('old-closed') }),
    evidence({ id: id('e-new'), occurredAt: RECENT, sourceIssueId: id('recent') }),
  ]);
  await replaceAttributions(projectId, [
    attribution({ evidenceId: id('e-old'), debtIssueId: id('d1') }),
    attribution({ evidenceId: id('e-new'), debtIssueId: id('d1') }),
  ]);
  await upsertBills(projectId, [debtBill({ debtIssueId: id('d1'), key: `${projectId}-9` })]);
  await upsertRepayments(projectId, [repayment({ debtIssueId: id('d1'), key: `${projectId}-9`, publishedAt: OLD })]);
  await upsertZoneWeek([
    { projectId, zone: 'api', week: weekKey(OLD), costJp: 5, byFamily: zeroFamilyNumbers() },
    { projectId, zone: 'api', week: weekKey(RECENT), costJp: 7, byFamily: zeroFamilyNumbers() },
  ]);
  await saveScores(projectId, [{ fingerprint: id('f-old'), relevance: 0.5, rationale: 'vieux' }], OLD);
  await saveScores(projectId, [{ fingerprint: id('f-new'), relevance: 0.6, rationale: 'récent' }], NOW);
}

test('C37 — la purge rend le vieux et garde la fenêtre de 180 jours', async (t) => {
  await installed(t);
  await seed();
  const report = await purgeProject('p1', { now: NOW });

  assert.equal(report.deleted['evidence'], 1, 'la vieille preuve est rendue');
  assert.equal(report.deleted['attribution'], 1, 'ses attributions suivent');
  assert.equal(report.deleted['zone_week'], 1, 'la vieille semaine est rendue');
  assert.equal(report.deleted['score_cache'], 1, 'le vieux score est rendu');
  assert.equal(report.trimmedDescriptions, 1, 'seul le ticket sorti de toute fenêtre est vidé');

  assert.deepEqual((await listEvidence('p1')).map((item) => item.id), ['p1-e-new']);
  assert.equal((await listScores('p1')).size, 1);
  assert.equal((await listScores('p1')).has('p1-f-new'), true);
});

test('C37 — seul le texte des tickets sortis de toute fenêtre est vidé', async (t) => {
  await installed(t);
  await seed();
  await purgeProject('p1', { now: NOW });
  assert.equal((await getIssueFact('p1-recent'))?.description, 'corps');
  assert.equal(
    (await getIssueFact('p1-old-recent'))?.description,
    'corps récent',
    'résolu récemment : encore dans la fenêtre, son texte sert au score (§18)',
  );
  assert.equal((await getIssueFact('p1-old-closed'))?.description, undefined, 'le MEDIUMTEXT est rendu');
  assert.equal((await getIssueFact('p1-old-closed'))?.summary, 'un ticket', 'le fait lui-même reste');
});

test('C37 — les séjours d’un ticket encore dans la fenêtre survivent', async (t) => {
  const fake = await installed(t);
  await seed();
  await purgeProject('p1', { now: NOW });
  const spans = fake.store.require('status_span').rows;
  const kept = spans.map((row) => row.issue_id).sort();
  assert.deepEqual(kept, ['p1-old-recent', 'p1-recent'], 'le vieux clos perd ses séjours, pas les autres');
});

test('C37 — les bulletins et les additions ne sont pas effacés', async (t) => {
  await installed(t);
  await seed();
  const report = await purgeProject('p1', { now: NOW });
  assert.equal(report.deleted['repayment'], undefined, 'les bulletins sont autoportants : conservés');
  assert.equal((await listRepayments('p1')).length, 1);
  assert.equal((await listBills('p1')).length, 1);
});

test('C37 — la purge est bornée : plusieurs petites requêtes', async (t) => {
  const fake = await installed(t);
  await seed();
  fake.log.length = 0;
  await purgeProject('p1', { now: NOW, batchSize: 1 });
  const deletes = fake.log.filter((call) => call.kind === 'delete');
  assert.ok(deletes.length >= 2, `effacements bornés (${deletes.length} requêtes)`);
  // LIMIT inline (entier borné) : Forge SQL refuse un paramètre lié dans LIMIT.
  for (const call of deletes) assert.match(call.query, /LIMIT \d+$/);
});

test('C37 — la purge est idempotente', async (t) => {
  await installed(t);
  await seed();
  await purgeProject('p1', { now: NOW });
  const second = await purgeProject('p1', { now: NOW });
  assert.deepEqual(second.deleted, {
    attribution: 0,
    status_span: 0,
    evidence: 0,
    zone_week: 0,
    score_cache: 0,
    rejection: 0,
  });
  assert.equal(second.trimmedDescriptions, 0);
});

test('C37 — la purge ne déborde pas sur un autre projet', async (t) => {
  await installed(t);
  await seed('p1');
  await seed('p2');
  await purgeProject('p1', { now: NOW });
  assert.equal((await listEvidence('p2')).length, 2);
  assert.equal((await listScores('p2')).size, 2);
});

test('C37 — purgeAllProjects couvre les projets réglés', async (t) => {
  await installed(t);
  await seed('p1');
  await seed('p2');
  await saveSettings(makeSettings('p1', 'PROJ'));
  await saveSettings(makeSettings('p2', 'PROJ'));
  const reports = await purgeAllProjects({ now: NOW });
  assert.deepEqual(reports.map((report) => report.projectId), ['p1', 'p2']);
  assert.equal((await listEvidence('p1')).length, 1);
  assert.equal((await listEvidence('p2')).length, 1);
});

test('C37 — les seuils respectent la dette morte et les bulletins', () => {
  const defaults = purgeCutoffs({ now: NOW });
  assert.equal(PURGE_DEAD_DAYS, 180);
  assert.equal(defaults.old, toDbDate(addDays(NOW, -180)));
  assert.equal(defaults.oldWeek, weekKey(addDays(NOW, -180)));

  // Des bulletins plus longs que la dette morte : c'est le plus long qui gagne.
  const longBulletins = purgeCutoffs({ now: NOW, deadDays: 30, bulletinWeeks: 20 });
  assert.equal(longBulletins.old, toDbDate(addDays(NOW, -30)));
  assert.equal(longBulletins.oldWeek, weekKey(addDays(NOW, -140)));
});

/**
 * DDL de `confirmation` : la table vit hors du schéma §16 (il appartient à
 * `jobs/confirmations.ts`, qui contourne l'exécuteur) ; le double la recrée
 * ici telle quelle pour couvrir le DELETE de la purge.
 */
const CONFIRMATION_DDL =
  'CREATE TABLE IF NOT EXISTS confirmation (' +
  'evidence_id VARCHAR(255) NOT NULL, debt_issue_id VARCHAR(64) NOT NULL, ' +
  'project_id VARCHAR(64) NOT NULL, confirmed_by VARCHAR(128) NOT NULL, ' +
  'confirmed_at DATETIME(3) NOT NULL, PRIMARY KEY (evidence_id, debt_issue_id)' +
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';

const INSERT_REJECTION =
  'INSERT INTO rejection (evidence_id, debt_issue_id, project_id, rejected_by, rejected_at) VALUES (?, ?, ?, ?, ?)';
const INSERT_CONFIRMATION =
  'INSERT INTO confirmation (evidence_id, debt_issue_id, project_id, confirmed_by, confirmed_at) VALUES (?, ?, ?, ?, ?)';

test('C37 — vieux rejets rendus, confirmations orphelines suivies (reliquat item 22)', async (t) => {
  await installed(t);
  await seed();
  await runDdl(CONFIRMATION_DDL);
  // Rejets : un hors de la fenêtre de 180 jours, un récent qui reste.
  await runStatement(INSERT_REJECTION, ['p1-e-old', 'p1-d1', 'p1', 'u', toDbDateRequired(OLD)]);
  await runStatement(INSERT_REJECTION, ['p1-e-new', 'p1-d1', 'p1', 'u', toDbDateRequired(RECENT)]);
  // Confirmations : une sur une preuve vivante, une déjà orpheline (preuve inconnue).
  await runStatement(INSERT_CONFIRMATION, ['p1-e-new', 'p1-d1', 'p1', 'u', toDbDateRequired(RECENT)]);
  await runStatement(INSERT_CONFIRMATION, ['p1-e-gone', 'p1-d1', 'p1', 'u', toDbDateRequired(RECENT)]);

  const report = await purgeProject('p1', { now: NOW });

  assert.equal(report.deleted['rejection'], 1, 'seul le rejet sorti de la fenêtre est rendu');
  assert.equal(report.deleted['confirmation'], 1, 'la confirmation orpheline suit sa preuve');
  const rejections = await selectRows<{ evidence_id: string }>(
    'SELECT evidence_id FROM rejection WHERE project_id = ?',
    ['p1'],
  );
  assert.deepEqual(rejections.map((row) => row.evidence_id), ['p1-e-new']);
  const confirmations = await selectRows<{ evidence_id: string }>(
    'SELECT evidence_id FROM confirmation WHERE project_id = ?',
    ['p1'],
  );
  assert.deepEqual(confirmations.map((row) => row.evidence_id), ['p1-e-new']);
});

test('C37 — sans table `confirmation` (installation neuve), la purge ne jette pas', async (t) => {
  await installed(t);
  await seed();
  const report = await purgeProject('p1', { now: NOW });
  assert.equal(report.deleted['confirmation'], undefined, 'table absente : rien à purger, pas d’erreur');
});
