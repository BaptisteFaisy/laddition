/**
 * Tests des données rendues par les actions MCP (§13, items E67, E68, E71, E75).
 *
 * Le complément de `actions.test.ts` : ici chaque action est appelée sur un jeu
 * amorcé, et l'on vérifie ce qu'elle **rend** — les chiffres lus, jamais
 * recalculés — ainsi que les trois comportements ajoutés à l'audit :
 * le repli sur le seul projet initialisé, la page d'argumentaire, et les preuves
 * d'une zone avec leur formule.
 */

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { TestContext } from 'node:test';
import { sql } from '@forge/sql';

import { makeSettings } from '../core/settings';
import { saveSettings } from '../platform/db/index';
import type { FakeSqlClient } from '../platform/db/fakeSql';
import type { ConfirmEvidenceData, DebtBillData, DebtRankingData, DraftTicketData, PhantomDebtData, DeadDebtData, RepaymentData, ZoneCostData } from './actions';
import {
  MCP_ACTOR,
  confirmEvidence,
  draftDebtTicket,
  getDebtBill,
  getDebtRanking,
  getRepaymentReport,
  getZoneCosts,
  listDeadDebt,
  listPhantomDebt,
} from './actions';
import type { DebtCaseData } from './debtCase';
import { METHOD_LIMITS, getDebtCase } from './debtCase';
import type { ZoneEvidenceData } from './zoneEvidence';
import { listZoneEvidence } from './zoneEvidence';
import type { ListProjectsData } from './projectList';
import { listProjects } from './projectList';
import { MASKED_FORMULA } from './masking';
import { seedPayProject, startFakeDb } from './testing/seed';
import { dataOf, errorOf } from './testing/envelopes';

/** Un second projet initialisé, pour exercer l'ambiguïté de `projectKey`. */
async function seedSecondProject(): Promise<void> {
  await saveSettings(makeSettings('p2', 'OPS'));
}

/**
 * `jobs/confirmations.ts` crée sa table via `sql.executeDDL`, qui contourne
 * l'exécuteur injectable : on pont ce DDL vers le double le temps du test.
 *
 * Le module met sa promesse de table en cache, donc le DDL n'est joué qu'une
 * fois par processus : il est capturé au premier appel, puis rejoué dans chaque
 * nouveau double (aucune recopie du DDL ici).
 */
let confirmationDdl: string | null = null;

async function bridgeConfirmationDdl(fake: FakeSqlClient, context: TestContext): Promise<void> {
  if (confirmationDdl) await fake.executeDDL(confirmationDdl);
  const client = sql as unknown as { executeDDL: (statement: string) => Promise<unknown> };
  mock.method(client, 'executeDDL', async (statement: string) => {
    confirmationDdl = statement;
    return fake.executeDDL(statement);
  });
  context.after(() => mock.restoreAll());
}

describe('get-debt-ranking — classement et repli de projet (item E75)', () => {
  it('classe les dettes et rend la fenêtre du projet', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<DebtRankingData>(await getDebtRanking({ projectKey: 'PAY' }));
    assert.equal(data.projectKey, 'PAY');
    assert.equal(data.windowDays, 90);
    assert.equal(data.total >= 2, true, 'au moins deux dettes classées');
    assert.equal(data.debts[0]?.key, 'PAY-77', 'la dette la plus chère d’abord');
    assert.equal(data.debts[0]?.lowJp, 6);
    assert.equal(data.debts[0]?.highJp, 9);
  });

  it('projectKey facultatif : repli sur le seul projet initialisé', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<DebtRankingData>(await getDebtRanking({}));
    assert.equal(data.projectKey, 'PAY');
  });

  it('deux projets initialisés : refus qui liste les clés', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    await seedSecondProject();
    const error = errorOf(await getDebtRanking({}));
    assert.match(error, /plusieurs projets initialisés/);
    assert.match(error, /PAY/);
    assert.match(error, /OPS/);
  });
});

describe('list-projects — découvrir les projets (item E75)', () => {
  it('un seul projet : la clé peut être omise', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<ListProjectsData>(await listProjects({}));
    assert.equal(data.total, 1);
    assert.equal(data.single, true);
    assert.equal(data.projects[0]?.projectKey, 'PAY');
    assert.equal(data.projects[0]?.windowDays, 90);
    assert.match(data.hint, /peut être omis/);
  });

  it('plusieurs projets : l’invite nomme les clés', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    await seedSecondProject();
    const data = dataOf<ListProjectsData>(await listProjects({}));
    assert.equal(data.total, 2);
    assert.equal(data.single, false);
    assert.match(data.hint, /OPS, PAY/, 'les clés sont listées dans l’ordre alphabétique');
  });
});

describe('get-debt-bill — addition, preuves et masquage (§18)', () => {
  it('rend les chiffres enregistrés et masque ce qui est hors droits', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<DebtBillData>(await getDebtBill({ issueKey: 'PAY-77' }));
    assert.equal(data.debt.key, 'PAY-77');
    assert.equal(data.debt.zone, 'taxes');
    assert.equal(data.bill.lowJp, 6);
    assert.equal(data.bill.highJp, 9);
    assert.equal(data.evidence.length, 4, 'les preuves masquées restent comptées');
    assert.equal(data.hiddenCount, 1);
    const visible = data.evidence.find((item) => item.id === 'ev1');
    assert.equal(visible?.sourceKey, 'PAY-101');
    assert.equal(visible?.detail.formula, '2 intervenants × 3 j');
    const hidden = data.evidence.find((item) => item.id === 'ev2');
    assert.equal(hidden?.visible, false);
    assert.equal(hidden?.sourceKey, '', 'la clé source d’une preuve masquée ne sort pas');
    assert.equal(hidden?.detail.formula, MASKED_FORMULA);
    assert.equal(hidden?.costJp, 3, 'le coût masqué reste compté');
  });
});

describe('get-debt-case — la page d’argumentaire (item E68, §7.6)', () => {
  it('coût en fourchette, remboursement, retour et méthode', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<DebtCaseData>(await getDebtCase({ issueKey: 'PAY-77' }));
    assert.equal(data.issueKey, 'PAY-77');
    assert.equal(data.summary, 'Double calcul des taxes');
    assert.equal(data.zone, 'taxes');
    assert.equal(data.lowJp, 6);
    assert.equal(data.highJp, 9);
    assert.equal(data.repaymentJp, 2);
    assert.equal(data.avoidableJp, 8.4);
    assert.equal(data.roiLow, 4.2);
    assert.equal(data.roiHigh, 4.5);
    assert.equal(data.paybackDays, 30);
    assert.equal(data.hiddenCount, 1);
    assert.equal(data.method.windowDays, 90);
    assert.equal(data.method.billedFamilies.includes('C5'), false, 'C5 est un délai, pas un coût');
    assert.equal(data.method.limits, METHOD_LIMITS);
  });

  it('cite les preuves principales avec leur part et leur formule (§10)', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<DebtCaseData>(await getDebtCase({ issueKey: 'PAY-77' }));
    const first = data.evidence[0];
    assert.equal(first?.id, 'ev1', 'la preuve la plus coûteuse d’abord');
    assert.equal(first?.share, 1);
    assert.equal(first?.basis, 'link');
    assert.equal(first?.formula, '2 intervenants × 3 j');
    const hidden = data.evidence.find((item) => item.id === 'ev2');
    assert.equal(hidden?.visible, false);
    assert.equal(hidden?.sourceKey, '');
    assert.equal(hidden?.share, 0.5, 'une preuve masquée garde sa part');
  });

  it('rappelle les limites de la méthode, sans exception', async () => {
    const text = METHOD_LIMITS.join(' ');
    assert.equal(METHOD_LIMITS.length >= 6, true, 'une page d’argumentaire sans limites est un piège');
    assert.match(text, /causalité/);
    assert.match(text, /C5/);
    assert.match(text, /100 %/);
    assert.match(text, /masquées/);
    assert.match(text, /personne/);
  });
});

describe('get-zone-costs et list-zone-evidence (item E67)', () => {
  it('coût de zone, tendance et couverture par une dette', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<ZoneCostData>(await getZoneCosts({ projectKey: 'PAY', zone: 'taxes' }));
    assert.equal(data.zone.zone, 'taxes');
    assert.equal(data.zone.totalJp, 9);
    assert.equal(data.windowDays, 90);
    assert.equal(['up', 'down', 'flat'].includes(data.trend.direction), true);
    assert.equal(data.coveredByDebt, true);
  });

  it('une zone sans dette est signalée comme dette fantôme', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<ZoneCostData>(await getZoneCosts({ projectKey: 'PAY', zone: 'legacy' }));
    assert.equal(data.coveredByDebt, false);
  });

  it('les preuves de la zone : source, famille, coût et formule', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<ZoneEvidenceData>(await listZoneEvidence({ projectKey: 'PAY', zone: 'taxes' }));
    assert.equal(data.zone, 'taxes');
    assert.deepEqual(data.availableZones, ['api', 'archive', 'legacy', 'notifications', 'taxes']);
    const first = data.evidence[0];
    assert.equal(first?.sourceKey, 'PAY-101');
    assert.equal(first?.family, 'C1');
    assert.equal(first?.costJp, 6);
    assert.equal(first?.formula, '2 intervenants × 3 j');
    assert.equal(first?.isDelay, false);
    assert.equal(data.totalJp, 12, '6 + 3 + 1 + 2 sur les preuves de la zone');
    assert.equal(data.hiddenCount, 1);
    const hidden = data.evidence.find((item) => item.id === 'ev2');
    assert.equal(hidden?.sourceKey, '');
    assert.equal(hidden?.formula, MASKED_FORMULA);
  });

  it('le retard induit est rendu à part, jamais additionné', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<ZoneEvidenceData>(await listZoneEvidence({ zone: 'notifications' }));
    assert.equal(data.delayDays, 12);
    assert.equal(data.totalJp, 4, 'seule la famille C3 est un coût');
    const delay = data.evidence.find((item) => item.family === 'C5');
    assert.equal(delay?.isDelay, true);
  });
});

describe('list-phantom-debt et list-dead-debt (§7.2, §7.3)', () => {
  it('la zone coûteuse sans ticket est fantôme, pas la zone sous le seuil', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<PhantomDebtData>(await listPhantomDebt({ projectKey: 'PAY' }));
    assert.equal(data.thresholdJp, 10);
    assert.deepEqual(data.zones.map((item) => item.zone), ['legacy']);
    assert.equal(data.zones[0]?.totalJp, 12);
    assert.equal(data.zones[0]?.topEvidenceIds.includes('ev7'), true);
  });

  it('la dette sans preuve depuis trop longtemps est morte', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<DeadDebtData>(await listDeadDebt({ projectKey: 'PAY' }));
    assert.equal(data.deadDays, 180);
    const dead = data.debts.find((item) => item.key === 'PAY-50');
    assert.ok(dead, 'PAY-50 doit être signalée');
    assert.equal(dead.daysWithoutEvidence > 180, true);
    assert.equal(data.debts.some((item) => item.key === 'PAY-77'), false, 'une dette alimentée n’est pas morte');
  });
});

describe('get-repayment-report (§11)', () => {
  it('le bulletin vient avec ses limites', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<RepaymentData>(await getRepaymentReport({ issueKey: 'PAY-41' }));
    assert.equal(data.repayment.key, 'PAY-41');
    assert.equal(data.repayment.beforeRate, 2.6);
    assert.equal(data.repayment.afterRate, 0.7);
    assert.equal(data.repayment.caveats.length, 2);
    assert.match(data.causalWarning, /causalité/);
  });
});

describe('draft-debt-ticket (§7.2)', () => {
  it('le brouillon cite la zone, son coût et ses preuves', async (t) => {
    await startFakeDb(t);
    await seedPayProject();
    const data = dataOf<DraftTicketData>(await draftDebtTicket({ projectKey: 'PAY', zone: 'legacy' }));
    assert.equal(data.zone, 'legacy');
    assert.equal(data.totalJp, 12);
    assert.deepEqual(data.evidenceIds, ['ev7']);
    assert.match(data.summary, /legacy/);
    assert.match(data.description, /PAY-120/, 'la preuve source doit être citée');
    assert.match(data.description, /à relire/, 'le brouillon n’est jamais un ticket créé');
  });
});

describe('confirm-evidence — décision tracée, non usurpable (items E70, E71)', () => {
  it('un « by » fourni par l’appelant est ignoré au profit de l’outil', async (t) => {
    const fake = await startFakeDb(t);
    await seedPayProject();
    await bridgeConfirmationDdl(fake, t);
    const data = dataOf<ConfirmEvidenceData>(
      await confirmEvidence({ evidenceKey: 'ev3', debtKey: 'PAY-41', confirmed: true, by: 'un-tiers' }),
    );
    assert.equal(data.confirmed, true);
    assert.equal(data.basis, 'confirmed');
    assert.equal(data.decidedBy, MCP_ACTOR);
    assert.equal(data.updated >= 1, true, 'les additions sont rebâties par le module partagé');
    const rows = await fake.select<{ confirmed_by: string }>(
      'SELECT confirmed_by FROM confirmation ORDER BY confirmed_at',
      [],
    );
    assert.equal(rows[0]?.confirmed_by, MCP_ACTOR, 'la décision enregistrée porte l’identité de l’outil');
    assert.equal(rows.some((row) => row.confirmed_by === 'un-tiers'), false);
  });

  it('un rejet est enregistré comme tel', async (t) => {
    const fake = await startFakeDb(t);
    await seedPayProject();
    await bridgeConfirmationDdl(fake, t);
    const data = dataOf<ConfirmEvidenceData>(
      await confirmEvidence({ evidenceKey: 'ev3', debtKey: 'PAY-41', confirmed: false }),
    );
    assert.equal(data.confirmed, false);
    assert.equal(data.basis, 'rejected');
    assert.equal(data.decidedBy, MCP_ACTOR);
  });

  it('une preuve visée par son identifiant exact passe, même homonyme', async (t) => {
    const fake = await startFakeDb(t);
    await seedPayProject();
    await bridgeConfirmationDdl(fake, t);
    const data = dataOf<ConfirmEvidenceData>(
      await confirmEvidence({ evidenceKey: 'ev6', debtKey: 'PAY-77', confirmed: true }),
    );
    assert.equal(data.evidenceId, 'ev6', 'l’identifiant lève l’ambiguïté du sourceKey DUP-1');
  });
});
