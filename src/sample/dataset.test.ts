/**
 * Cohérence du jeu d'exemple (DT-13, §22).
 *
 * Ces tests ne vérifient pas des constantes : ils passent les faits du jeu dans
 * le **domaine réel** (`buildBill`, `findPhantomDebt`, `findDeadDebt`) et
 * exigent que les chiffres du §7.1 en sortent. Si une preuve est mal datée ou
 * mal rattachée, l'addition ne tombe plus dans la fourchette attendue et le
 * test casse : c'est exactement le garde-fou voulu.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildBill } from '../core/bill';
import { findDeadDebt } from '../core/dead';
import { findPhantomDebt } from '../core/phantom';
import { rankDebts } from '../core/ranking';
import { addDays } from '../core/time';
import { BILLED_FAMILIES } from '../core/types';
import type { DebtBill, Evidence, IssueFact } from '../core/types';
import {
  DEAD_DEBT_KEYS,
  MAIN_DEBT_KEYS,
  SAMPLE_JSM_PROJECT_KEY,
  SAMPLE_NOW,
  SAMPLE_PROJECT_ID,
  SAMPLE_PROJECT_KEY,
  SAMPLE_ZONES,
} from './dataset';
import { buildSampleData, isSampleProject, sampleContext } from './load';

const data = buildSampleData(SAMPLE_NOW);
const ctx = sampleContext(SAMPLE_NOW);
const debts = data.facts.filter((fact) => fact.isDebt);

/** Addition d'une dette du jeu, par sa clé. */
function billOf(key: string): DebtBill {
  const debt = debts.find((item) => item.key === key);
  assert.ok(debt, `dette ${key} absente du jeu d'exemple`);
  return buildBill(debt, data.evidence, data.attributions, ctx);
}

/** Ticket du jeu, par sa clé. */
function factOf(key: string): IssueFact {
  const fact = data.facts.find((item) => item.key === key);
  assert.ok(fact, `ticket ${key} absent du jeu d'exemple`);
  return fact;
}

/** Preuves d'une zone, dans l'ordre du jeu. */
function evidenceOfZone(zone: string): Evidence[] {
  return data.evidence.filter((item) => item.zone === zone);
}

describe("jeu d'exemple — forme du jeu", () => {
  it('décrit un projet de six mois sur quatre zones', () => {
    assert.equal(SAMPLE_PROJECT_KEY, 'PAY');
    assert.equal(data.facts.length >= 60, true, 'le jeu doit couvrir six mois de tickets');
    assert.deepEqual([...SAMPLE_ZONES], ['facturation', 'notifications', 'paiements', 'reporting']);
    const zones = new Set(data.facts.flatMap((fact) => fact.zones));
    for (const zone of SAMPLE_ZONES) assert.equal(zones.has(zone), true, `zone ${zone} sans ticket`);
  });

  it('contient trois dettes mises en scène et sept dettes dormantes', () => {
    assert.equal(debts.length, MAIN_DEBT_KEYS.length + DEAD_DEBT_KEYS.length);
    for (const key of MAIN_DEBT_KEYS) {
      const debt = factOf(key);
      assert.equal(debt.isDebt, true, `${key} doit être un ticket de dette`);
    }
    for (const key of DEAD_DEBT_KEYS) assert.equal(factOf(key).isDebt, true, `${key} doit être un ticket de dette`);
  });

  it('répartit au moins soixante preuves sur les quatre familles facturées', () => {
    assert.equal(data.evidence.length >= 60, true, `${data.evidence.length} preuves seulement`);
    const families = new Set(data.evidence.map((item) => item.family));
    for (const family of BILLED_FAMILIES) assert.equal(families.has(family), true, `famille ${family} absente`);
  });

  it('rend un contexte de calcul rejouable et des séjours cohérents', () => {
    assert.equal(ctx.now, SAMPLE_NOW);
    assert.equal(ctx.spansByIssue.size > 0, true);
    for (const [issueId, spans] of ctx.spansByIssue) {
      for (const span of spans) {
        assert.equal(span.issueId, issueId, 'séjour rattaché au mauvais ticket');
        if (span.endedAt !== null) assert.equal(span.startedAt <= span.endedAt, true, `séjour inversé sur ${issueId}`);
      }
    }
  });

  it('est déterministe : deux constructions rendent les mêmes preuves', () => {
    const again = buildSampleData(SAMPLE_NOW);
    assert.deepEqual(
      again.evidence.map((item) => item.id),
      data.evidence.map((item) => item.id),
    );
    assert.deepEqual(again.attributions, data.attributions);
  });

  it('reconnaît le projet fictif et rien d’autre', () => {
    assert.equal(isSampleProject('PAY'), true);
    assert.equal(isSampleProject(' pay '), true);
    assert.equal(isSampleProject('OPS'), false);
  });

  it('range tous les faits dans la partition du projet d’exemple', () => {
    // Le recalcul nocturne lit une partition à la fois : un fait rangé ailleurs
    // disparaîtrait du jeu au premier passage. Les incidents gardent seulement
    // la clé de leur projet JSM.
    for (const fact of data.facts) assert.equal(fact.projectId, SAMPLE_PROJECT_ID, `${fact.key} hors partition`);
    const jsm = data.facts.filter((fact) => fact.isIncident);
    assert.equal(jsm.length > 0, true, 'le jeu doit contenir des incidents JSM');
    for (const fact of jsm) assert.equal(fact.projectKey, SAMPLE_JSM_PROJECT_KEY, `${fact.key} hors projet JSM`);
  });
});

describe("jeu d'exemple — l'addition de PAY-77 (§7.1)", () => {
  it('tombe entre 19 et 34 j-p, fourchette basse et haute', () => {
    const bill = billOf('PAY-77');
    assert.equal(bill.lowJp, 19, `addition basse ${bill.lowJp} au lieu de 19`);
    assert.equal(bill.highJp, 34, `addition haute ${bill.highJp} au lieu de 34`);
  });

  it('détaille 4 incidents, 9 bugs et la lenteur en fourchette haute', () => {
    const bill = billOf('PAY-77');
    assert.equal(bill.byFamily.C1.evidenceCount, 4, 'quatre incidents');
    assert.equal(bill.byFamily.C1.lowJp, 11, 'les incidents pèsent 11 j-p');
    assert.equal(bill.byFamily.C2.evidenceCount, 9, 'neuf bugs');
    assert.equal(bill.byFamily.C2.lowJp, 8, 'les bugs pèsent 8 j-p');
    assert.equal(bill.byFamily.C3.lowJp, 0, 'la lenteur n’entre pas dans la fourchette basse');
    assert.equal(bill.byFamily.C3.highJp > 0, true, 'la lenteur alimente la fourchette haute');
  });

  it('chiffre un remboursement et un retour plausibles', () => {
    const bill = billOf('PAY-77');
    assert.equal(bill.repaymentJp, 8, 'remboursement estimé à 8 j-p');
    assert.equal(bill.roiLow !== null && bill.roiLow > 1, true, 'retour supérieur à 1');
    assert.equal(bill.paybackDays !== null && bill.paybackDays > 0, true, 'délai de retour chiffré');
  });

  it('ne met pas la dette close en tête du classement', () => {
    const bills = MAIN_DEBT_KEYS.map((key) => billOf(key));
    const ranking = rankDebts(bills, debts);
    assert.equal(ranking[0]?.key, 'PAY-77', 'PAY-77 doit être en tête');
    assert.equal(ranking[ranking.length - 1]?.lowJp !== null, true);
  });

  it('laisse la dette remboursée et la dette récente à quelques jours', () => {
    const closed = billOf('PAY-41');
    const recent = billOf('PAY-90');
    assert.equal(closed.lowJp >= 1, true, 'PAY-41 coûte au moins 1 j-p');
    assert.equal(closed.highJp <= 2, true, `PAY-41 plafonne à 2 j-p, pas ${closed.highJp}`);
    assert.equal(recent.lowJp >= 1, true, 'PAY-90 coûte au moins 1 j-p');
    assert.equal(recent.highJp <= 2, true, `PAY-90 plafonne à 2 j-p, pas ${recent.highJp}`);
  });
});

describe("jeu d'exemple — dette fantôme (§7.2)", () => {
  it('signale la zone notifications au-dessus de 10 j-p sans ticket de dette', () => {
    const phantoms = findPhantomDebt(data.zones, debts, data.evidence, ctx.settings);
    const notifications = phantoms.find((item) => item.zone === 'notifications');
    assert.ok(notifications, 'notifications doit être une dette fantôme');
    assert.equal(notifications.totalJp > 10, true, `${notifications.totalJp} j-p, seuil de 10 non dépassé`);
    assert.equal(notifications.topEvidenceIds.length > 0, true, 'le brouillon doit citer des preuves');
  });

  it('ne signale aucune zone couverte par un ticket de dette', () => {
    const phantoms = findPhantomDebt(data.zones, debts, data.evidence, ctx.settings);
    const covered = new Set(debts.flatMap((debt) => debt.zones));
    for (const phantom of phantoms) assert.equal(covered.has(phantom.zone), false, `${phantom.zone} est couverte`);
    for (const zone of ['facturation', 'paiements', 'reporting']) {
      assert.equal(phantoms.some((item) => item.zone === zone), false, `${zone} ne doit pas être fantôme`);
    }
  });

  it('compte les preuves citées dans les preuves de la zone', () => {
    const phantoms = findPhantomDebt(data.zones, debts, data.evidence, ctx.settings);
    const notifications = phantoms.find((item) => item.zone === 'notifications');
    assert.ok(notifications);
    const known = new Set(evidenceOfZone('notifications').map((item) => item.id));
    for (const id of notifications.topEvidenceIds) assert.equal(known.has(id), true, `preuve ${id} hors zone`);
  });
});

describe("jeu d'exemple — dette morte (§7.3)", () => {
  it('liste sept tickets sans preuve depuis 180 jours', () => {
    const dead = findDeadDebt(debts, data.evidence, data.attributions, ctx.settings, SAMPLE_NOW);
    assert.equal(dead.length, 7, `${dead.length} dettes mortes au lieu de 7`);
    for (const item of dead) {
      assert.equal(item.daysWithoutEvidence > 180, true, `${item.key} : ${item.daysWithoutEvidence} jours`);
      assert.equal(item.lastEvidenceAt, null, `${item.key} a encore une preuve récente`);
    }
    assert.deepEqual(
      dead.map((item) => item.key).sort(),
      [...DEAD_DEBT_KEYS].sort(),
    );
  });

  it('ne déclare pas morte une dette encore alimentée', () => {
    const dead = findDeadDebt(debts, data.evidence, data.attributions, ctx.settings, SAMPLE_NOW);
    const deadKeys = new Set(dead.map((item) => item.key));
    for (const key of MAIN_DEBT_KEYS) assert.equal(deadKeys.has(key), false, `${key} ne doit pas être morte`);
  });

  it('compte les jours depuis la création pour une dette jamais alimentée', () => {
    const dead = findDeadDebt(debts, data.evidence, data.attributions, ctx.settings, SAMPLE_NOW);
    const first = dead[0];
    assert.ok(first);
    const created = factOf(first.key).createdAt;
    const expected = Math.round((Date.parse(SAMPLE_NOW) - Date.parse(created)) / 86_400_000);
    assert.equal(first.daysWithoutEvidence, expected);
  });
});

describe("jeu d'exemple — remboursement (§7.5)", () => {
  it('publie un seul bulletin, pour la dette close', () => {
    assert.equal(data.repayment.length, 1, 'un seul remboursement publié');
    const bulletin = data.repayment[0];
    assert.ok(bulletin);
    assert.equal(bulletin.key, 'PAY-41');
    assert.equal(bulletin.zone, 'paiements');
    assert.equal(bulletin.publishedAt !== null, true, 'le bulletin doit être publié');
  });

  it('compare un coût avant plus élevé qu’après', () => {
    const bulletin = data.repayment[0];
    assert.ok(bulletin);
    assert.equal(bulletin.beforeRate > bulletin.afterRate, true, 'avant doit coûter plus cher qu’après');
    assert.equal(bulletin.weeksBefore > 0 && bulletin.weeksAfter > 0, true, 'des semaines observées des deux côtés');
  });

  it('affiche les limites avec le bulletin', () => {
    const bulletin = data.repayment[0];
    assert.ok(bulletin);
    assert.equal(bulletin.caveats.some((caveat) => caveat.includes('causalité')), true, 'limite de causalité absente');
    assert.equal(bulletin.caveats.some((caveat) => caveat.includes('échantillon')), true, 'taille d’échantillon absente');
  });

  it('porte un bulletin antérieur à l’instant de référence', () => {
    const bulletin = data.repayment[0];
    assert.ok(bulletin?.publishedAt);
    assert.equal(bulletin.publishedAt <= SAMPLE_NOW, true, 'un bulletin ne se publie pas dans le futur');
  });
});

describe("jeu d'exemple — attributions (§10)", () => {
  it('n’impute jamais plus de 100 % d’une preuve', () => {
    const shares = new Map<string, number>();
    for (const attribution of data.attributions) {
      shares.set(attribution.evidenceId, (shares.get(attribution.evidenceId) ?? 0) + attribution.share);
    }
    for (const [evidenceId, total] of shares) {
      assert.equal(total <= 1.001, true, `preuve ${evidenceId} imputée à ${total}`);
    }
  });

  it('alimente la fourchette basse par les liens et les confirmations', () => {
    const strong = data.attributions.filter((item) => item.basis === 'link' || item.basis === 'confirmed');
    assert.equal(strong.length > 0, true, 'aucune attribution forte : la fourchette basse serait vide');
    assert.equal(strong.some((item) => item.basis === 'confirmed'), true, 'aucune confirmation humaine');
    assert.equal(strong.some((item) => item.basis === 'link'), true, 'aucun lien explicite');
  });

  it('ne propose plus un rapprochement rejeté', () => {
    const rejected = data.attributions.filter(
      (item) => item.evidenceId.includes('pay-402') && item.debtIssueId.includes('pay-90'),
    );
    assert.equal(rejected.length, 0, 'le rejet doit retirer le rapprochement');
  });
});

describe("jeu d'exemple — coûts de zone (§9)", () => {
  it('couvre les quatre zones et le non classé', () => {
    const zones = new Set(data.zones.map((item) => item.zone));
    for (const zone of SAMPLE_ZONES) assert.equal(zones.has(zone), true, `zone ${zone} absente des coûts`);
    assert.equal(zones.has('non classé'), true, 'le non classé est un indicateur affiché');
  });

  it('ventile chaque zone par famille sans double compte', () => {
    for (const cost of data.zones) {
      const sum = BILLED_FAMILIES.reduce((total, family) => total + cost.byFamily[family], 0);
      assert.equal(Math.abs(sum - cost.totalJp) < 0.02, true, `${cost.zone} : ${sum} ≠ ${cost.totalJp}`);
      assert.equal(cost.weeklyJp.length > 0, true, `${cost.zone} sans série hebdomadaire`);
    }
  });

  it('garde les séries hebdomadaires alignées sur la fenêtre', () => {
    const lengths = new Set(data.zones.map((cost) => cost.weeklyJp.length));
    assert.equal(lengths.size, 1, 'toutes les zones doivent avoir la même longueur de série');
    const windowStart = addDays(SAMPLE_NOW, -ctx.settings.windowDays);
    assert.equal(windowStart < SAMPLE_NOW, true);
  });
});
