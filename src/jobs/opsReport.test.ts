/**
 * `compareBill` rejoué hors ligne (item 80, recettes §20 n° 6 et n° 9).
 *
 * Jusqu'ici, la comparaison panneau ↔ MCP n'était branchée que sur la sonde
 * d'exploitation (`?action=bill`) et n'était jamais jouée sans le site réel.
 * Ce test la rejoue sur le double SQL en mémoire (`mcp/testing/seed`) :
 * - n° 9 : `get-debt-bill` (MCP) et le panneau du ticket rendent les mêmes
 *   chiffres, sur chaque dette du jeu amorcé ;
 * - n° 6 : ce que le bulletin annonce correspond aux additions et aux
 *   remboursements stockés — chiffres annoncés égaux aux lignes `debt_bill`,
 *   bulletins égaux aux lignes `repayment`, et chaque ligne de l'addition
 *   renvoie bien aux tickets sources qui la composent.
 *
 * Aucune base réelle, aucun appel Jira : le double en mémoire suffit.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DebtBill, Repayment } from '../core/types';
import { seedPayProject, startFakeDb, PROJECT_ID, PROJECT_KEY } from '../mcp/testing/seed';
import { getBill, getIssueFact, listBills, listRepayments } from '../platform/db/index';
import { compareBill, readReport } from './opsReport';
import type { BillComparison } from './opsReport';

/** Dettes du jeu amorcé qui portent une addition enregistrée. */
const BILLED_KEYS = ['PAY-77', 'PAY-41'];

/** Chiffres annoncés par la comparaison, à côté de l'addition stockée. */
interface Compared {
  comparison: BillComparison;
  stored: DebtBill;
}

/** Rejoue `compareBill` sur une dette et rapporte l'addition stockée en regard. */
async function comparedBill(key: string): Promise<Compared> {
  const comparison = await compareBill(key);
  const bills = await listBills(PROJECT_ID);
  const stored = bills.find((bill) => bill.key === key);
  assert.ok(stored, `addition stockée attendue pour ${key}`);
  return { comparison, stored };
}

/** Recette §20 n° 6 : les chiffres annoncés sont ceux de l'addition stockée. */
function assertMatchesStoredBill(comparison: BillComparison, stored: DebtBill): void {
  for (const surface of [comparison.mcp, comparison.panel]) {
    assert.equal(surface.lowJp, stored.lowJp, 'fourchette basse annoncée');
    assert.equal(surface.highJp, stored.highJp, 'fourchette haute annoncée');
    assert.equal(surface.evidence, stored.evidenceIds.length, 'nombre de lignes de l\'addition');
  }
}

/** La zone annoncée est celle du ticket de dette stocké. */
async function assertStoredZone(comparison: BillComparison, stored: DebtBill): Promise<void> {
  const fact = await getIssueFact(stored.debtIssueId);
  assert.ok(fact, `ticket stocké attendu pour ${stored.key}`);
  assert.equal(comparison.mcp.zone, fact.zones[0], 'zone annoncée par l\'outil MCP');
  assert.equal(comparison.panel.zone, fact.zones[0], 'zone annoncée par le panneau');
}

describe('compareBill — rejoué hors ligne (item 80)', () => {
  it('rend les mêmes chiffres sur le panneau et via MCP (recette §20 n° 9)', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    for (const key of BILLED_KEYS) {
      const { comparison } = await comparedBill(key);
      assert.equal(comparison.identical, true, `panneau ↔ MCP identiques pour ${key}`);
      assert.deepEqual(comparison.mcp, comparison.panel, `chiffres égaux champ à champ pour ${key}`);
    }
  });

  it('annonce les chiffres des additions stockées (recette §20 n° 6)', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const { comparison, stored } = await comparedBill('PAY-77');
    assertMatchesStoredBill(comparison, stored);
    await assertStoredZone(comparison, stored);
    assert.deepEqual(comparison.mcp, { lowJp: 6, highJp: 9, evidence: 4, zone: 'taxes' });
  });

  it('ouvre chaque ligne de l\'addition sur le ticket qui la compose (§20 n° 6)', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const { stored } = await comparedBill('PAY-77');
    assert.deepEqual(stored.evidenceIds, ['ev1', 'ev2', 'ev5', 'ev6']);
    assert.equal(stored.evidenceIds.length, 4, 'les quatre preuves composent l\'addition annoncée');
  });

  it('bulletins annoncés = remboursements stockés, sur des additions cohérentes (§20 n° 6)', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const report = await readReport(PROJECT_KEY);
    const storedRepayments: Repayment[] = await listRepayments(PROJECT_ID);
    assert.ok(storedRepayments.length > 0, 'le jeu amorcé contient un remboursement');
    assert.deepEqual(report.repayments, storedRepayments, 'le bulletin annonce les remboursements stockés');
    for (const bulletin of report.repayments) {
      const { comparison, stored } = await comparedBill(bulletin.key);
      assert.equal(comparison.identical, true, `panneau ↔ MCP pour la dette remboursée ${bulletin.key}`);
      assertMatchesStoredBill(comparison, stored);
      const bill = await getBill(bulletin.debtIssueId);
      assert.ok(bill, `addition stockée attendue pour la dette remboursée ${bulletin.key}`);
      assert.equal(bill.lowJp, stored.lowJp, 'l\'addition derrière le bulletin est celle en base');
    }
  });

  it('refuse hors ligne une dette sans addition, avec un motif actionnable', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    await assert.rejects(() => compareBill('PAY-90'), /PAY-90|addition/i);
  });
});
