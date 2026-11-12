/**
 * Tests de la sonde MCP : elle ne doit laisser aucune trace.
 *
 * La sonde confirme un rapprochement pour mesurer le gain réel (recette §20
 * n° 3), puis l'annule. Sans cette annulation, le site de démo gardait une
 * décision humaine que personne n'avait prise — constaté le 12/11 : PAY-41
 * restait à 2–2 j-p et la recette n'était plus jouable.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stubForgeRuntime } from './testForge';

stubForgeRuntime();

const { restoreInferred } = await import('./opsMcp');
const { addConfirmation, listConfirmations } = await import('./confirmations');
const { PROJECT_ID, PROJECT_KEY, seedPayProject, startFakeDb } = await import('../mcp/testing/seed');

describe('restoreInferred — la sonde rend l’état du projet', () => {
  it('retire la confirmation posée et rejoue le recalcul', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    await addConfirmation(PROJECT_ID, {
      evidenceId: 'ev3',
      debtIssueId: 'd41',
      by: 'sonde',
      at: '2026-11-12T10:00:00.000Z',
    });
    assert.equal((await listConfirmations(PROJECT_ID)).length, 1, 'la confirmation est posée');

    let recalculated = 0;
    await restoreInferred(PROJECT_ID, { evidenceId: 'ev3', key: 'PAY-41' }, async () => {
      recalculated += 1;
    });

    assert.deepEqual(await listConfirmations(PROJECT_ID), [], 'plus aucune décision humaine');
    assert.equal(recalculated, 1, 'le recalcul est rejoué une fois');
    assert.equal(PROJECT_KEY, 'PAY');
  });
});
