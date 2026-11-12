/**
 * Plafond du passage de score (item C44, §18) : `MAX_SCORED_PAIRS` tronque en
 * ordre de tri, et la troncature doit remonter comme drapeau — des durées
 * calculées sur des pertinences partielles ne doivent jamais être écrites
 * sans signal.
 *
 * Le cache est pré-rempli avec les empreintes exactes des couples : chaque
 * score est resservi sans jamais appeler le modèle (C30), le test reste pur.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Evidence, IssueFact } from '../core/types';
import type { ScoreCache } from '../platform/llm';
import { fingerprintOf } from '../platform/llm';
import { evidence, issueFact } from '../platform/db/testFixtures';
import { MAX_SCORED_PAIRS, debtText, evidenceText, scoreCandidates } from './relevance';

/** Cache pré-rempli : tous les couples sont resservis, aucun appel au modèle. */
function cachedScores(items: Evidence[], debts: IssueFact[]): ScoreCache {
  const cache: ScoreCache = new Map();
  for (const item of items) {
    for (const debt of debts) {
      cache.set(fingerprintOf(evidenceText(item), debtText(debt)), {
        relevance: 0.5,
        rationale: 'reservi par le cache',
      });
    }
  }
  return cache;
}

/** `count` preuves facturées de la zone par défaut, toutes comparables. */
function evidenceBatch(count: number): Evidence[] {
  return Array.from({ length: count }, (_, i) =>
    evidence({ id: `e${i}`, sourceIssueId: `s${i}`, sourceKey: `PROJ-E${i}` }),
  );
}

/** `count` dettes de la même zone, par clé croissante. */
function debtBatch(count: number): IssueFact[] {
  return Array.from({ length: count }, (_, i) =>
    issueFact({ issueId: `d${i}`, key: `PROJ-D${i}`, summary: `dette ${i}` }),
  );
}

test('C44 — sous le plafond, tout est noté et rien n’est signalé tronqué', async () => {
  const items = evidenceBatch(2);
  const debts = debtBatch(5);
  const scored = await scoreCandidates(items, debts, cachedScores(items, debts));
  assert.equal(scored.truncated, false);
  assert.equal(scored.scores.length, 10);
});

test('C44 — le plafond de couples tronque en ordre de tri et lève le drapeau', async () => {
  // 5 dettes par preuve (MAX_DEBTS_PER_EVIDENCE) : il faut 61 preuves pour dépasser le plafond.
  const items = evidenceBatch(Math.ceil((MAX_SCORED_PAIRS + 1) / 5));
  const debts = debtBatch(5);
  const scored = await scoreCandidates(items, debts, cachedScores(items, debts));
  assert.equal(scored.truncated, true, 'les couples manquants n’ont pas de score : il faut le dire');
  assert.equal(scored.scores.length, MAX_SCORED_PAIRS);
  assert.equal(scored.scores[0]?.evidenceId, 'e0', 'la troncature suit l’ordre de tri, pas l’importance');
});
