/**
 * Amorçage du double SQL pour les tests des actions MCP et des résolveurs.
 *
 * **Fichier réservé aux tests** : aucun module de production ne l'importe. Il
 * réutilise le double en mémoire de la couche de stockage
 * (`platform/db/fakeSql.ts`, item F78) et ses fabriques d'objets du domaine —
 * une seule implémentation par fixture (§18).
 *
 * Le jeu amorcé est un mini-projet cohérent avec le cahier des charges :
 * - `PAY` (identifiant `p1`), fenêtre de 90 jours ;
 * - trois dettes (`PAY-77`, `PAY-41`, `PAY-90`), une morte (`PAY-50`), un
 *   ticket ordinaire (`PAY-1`) qui n'est pas une dette ;
 * - une zone sans dette (`legacy`) → dette fantôme, une zone sous le seuil
 *   (`archive`) → ni fantôme ni morte ;
 * - une preuve masquée (`ev2`) → §18 ;
 * - deux preuves homonymes (`DUP-1`) → ambiguïté refusée à l'écriture (E74) ;
 * - une preuve partagée entre deux dettes (parts 0,6 + 0,4) → recette §20 n° 2.
 */

import type { Attribution, DebtBill, Evidence, Family, FamilyTotal, IssueFact, Repayment } from '../../core/types';
import { makeSettings } from '../../core/settings';
import { addDays, weeksBetween } from '../../core/time';
import { ensureSchema } from '../../platform/db/index';
import {
  replaceAttributions,
  replaceEvidence,
  saveSettings,
  upsertBills,
  upsertIssueFacts,
  upsertRepayments,
} from '../../platform/db/index';
import { upsertZoneWeek } from '../../platform/db/index';
import type { ZoneWeekInput } from '../../platform/db/index';
import { restoreSql, useFakeSql } from '../../platform/db/fakeSql';
import type { FakeSqlClient } from '../../platform/db/fakeSql';
import { attribution, debtBill, evidence, issueFact, repayment } from '../../platform/db/testFixtures';
import { zeroFamilyNumbers } from '../../platform/db/rows';
import type { TestContext } from 'node:test';

/** Projet du jeu de test. */
export const PROJECT_ID = 'p1';
export const PROJECT_KEY = 'PAY';

/** Installe le double SQL, crée le schéma, et restaure Forge SQL en sortie. */
export async function startFakeDb(context: TestContext): Promise<FakeSqlClient> {
  const client = useFakeSql();
  context.after(restoreSql);
  await ensureSchema();
  return client;
}

/** Amorce le projet `PAY` complet : réglages, tickets, preuves, parts, additions. */
export async function seedPayProject(): Promise<void> {
  await saveSettings(makeSettings(PROJECT_ID, PROJECT_KEY));
  await upsertIssueFacts(facts());
  await replaceEvidence(PROJECT_ID, evidenceRows());
  await replaceAttributions(PROJECT_ID, attributions());
  await upsertBills(PROJECT_ID, bills());
  await upsertRepayments(PROJECT_ID, repayments());
  await upsertZoneWeek(zoneWeeks());
}

/** Les cinq tickets du jeu : dettes, dette morte, et un ticket ordinaire. */
export function facts(): IssueFact[] {
  const base = { projectId: PROJECT_ID, projectKey: PROJECT_KEY, createdAt: daysAgo(20) };
  return [
    issueFact({ ...base, issueId: 'd77', key: 'PAY-77', isDebt: true, zones: ['taxes'], components: ['taxes'], summary: 'Double calcul des taxes' }),
    issueFact({ ...base, issueId: 'd41', key: 'PAY-41', isDebt: true, zones: ['notifications'], components: ['notifications'], summary: 'Notifications en double' }),
    issueFact({ ...base, issueId: 'd90', key: 'PAY-90', isDebt: true, zones: ['api'], components: ['api'], summary: 'Dette sans addition' }),
    issueFact({ ...base, issueId: 'd50', key: 'PAY-50', isDebt: true, zones: ['archive'], components: ['archive'], createdAt: daysAgo(400), summary: 'Dette endormie' }),
    issueFact({ ...base, issueId: 'i1', key: 'PAY-1', isDebt: false, zones: ['taxes'], components: ['taxes'], summary: 'Un bug ordinaire' }),
  ];
}

/** Preuves du jeu, dont une masquée (§18) et deux homonymes (item E74). */
export function evidenceRows(): Evidence[] {
  return [
    evidence({ id: 'ev1', zone: 'taxes', family: 'C1', sourceIssueId: 's101', sourceKey: 'PAY-101', costJp: 6, detail: detail('Incidents', '2 intervenants × 3 j') }),
    evidence({ id: 'ev2', zone: 'taxes', family: 'C2', sourceIssueId: 's102', sourceKey: 'PAY-102', costJp: 3, visible: false, detail: detail('Bugs', 'formule d\'un ticket hors droits') }),
    evidence({ id: 'ev3', zone: 'notifications', family: 'C3', sourceIssueId: 's103', sourceKey: 'PAY-103', costJp: 4, detail: detail('Lenteur', '1,8 × référence 2,2 j') }),
    evidence({ id: 'ev4', zone: 'notifications', family: 'C5', sourceIssueId: 's104', sourceKey: 'PAY-104', costJp: 12, detail: detail('Retard induit', 'blocage 12 j') }),
    evidence({ id: 'ev5', zone: 'taxes', family: 'C4', sourceIssueId: 's105', sourceKey: 'DUP-1', costJp: 1, detail: detail('Retouches', '1 relecture') }),
    evidence({ id: 'ev6', zone: 'taxes', family: 'C4', sourceIssueId: 's106', sourceKey: 'DUP-1', costJp: 2, detail: detail('Retouches', '2 relectures') }),
    evidence({ id: 'ev7', zone: 'legacy', family: 'C4', sourceIssueId: 's120', sourceKey: 'PAY-120', costJp: 5, detail: detail('Retouches', '5 reprises') }),
  ];
}

/** Parts imputées : `ev3` est partagée entre deux dettes (0,6 + 0,4). */
export function attributions(): Attribution[] {
  return [
    attribution({ evidenceId: 'ev1', debtIssueId: 'd77', share: 1, basis: 'link', relevance: 1 }),
    attribution({ evidenceId: 'ev2', debtIssueId: 'd77', share: 0.5, basis: 'inferred', relevance: 0.7 }),
    attribution({ evidenceId: 'ev3', debtIssueId: 'd41', share: 0.6, basis: 'inferred', relevance: 0.8 }),
    attribution({ evidenceId: 'ev3', debtIssueId: 'd90', share: 0.4, basis: 'inferred', relevance: 0.5 }),
    attribution({ evidenceId: 'ev5', debtIssueId: 'd77', share: 1, basis: 'link', relevance: 1 }),
    attribution({ evidenceId: 'ev6', debtIssueId: 'd77', share: 1, basis: 'link', relevance: 1 }),
  ];
}

/** Additions enregistrées : `PAY-90` n'en a volontairement aucune. */
export function bills(): DebtBill[] {
  return [
    debtBill({
      debtIssueId: 'd77',
      key: 'PAY-77',
      lowJp: 6,
      highJp: 9,
      evidenceIds: ['ev1', 'ev2', 'ev5', 'ev6'],
      hiddenCount: 1,
      repaymentJp: 2,
      avoidableJp: 8.4,
      roiLow: 4.2,
      roiHigh: 4.5,
      paybackDays: 30,
      byFamily: familyTotals({ C1: { lowJp: 6, highJp: 6 }, C2: { lowJp: 0, highJp: 1.5 } }),
    }),
    debtBill({
      debtIssueId: 'd41',
      key: 'PAY-41',
      lowJp: 0,
      highJp: 2.4,
      evidenceIds: ['ev3'],
      hiddenCount: 0,
      byFamily: familyTotals({ C3: { lowJp: 0, highJp: 2.4 } }),
    }),
  ];
}

/** Un bulletin publié : `PAY-41` est remboursée, `PAY-77` ne l'est pas. */
export function repayments(): Repayment[] {
  return [
    repayment({
      debtIssueId: 'd41',
      key: 'PAY-41',
      zone: 'notifications',
      beforeRate: 2.6,
      afterRate: 0.7,
      caveats: ['autres changements sur la zone', 'échantillon de 8 semaines'],
    }),
  ];
}

/** Coûts de zone sur les trois dernières semaines de la fenêtre. */
export function zoneWeeks(): ZoneWeekInput[] {
  const rows: ZoneWeekInput[] = [];
  for (const week of recentWeeks(3)) {
    rows.push(zoneWeek('taxes', week, 3, { C1: 2, C2: 1 }));
    rows.push(zoneWeek('notifications', week, 1.5, { C3: 1.5 }));
    rows.push(zoneWeek('api', week, 1, { C3: 1 }));
    rows.push(zoneWeek('legacy', week, 4, { C4: 4 }));
    rows.push(zoneWeek('archive', week, 1, { C4: 1 }));
  }
  return rows;
}

/** Semaines ISO récentes, dans la fenêtre de 90 jours par défaut. */
export function recentWeeks(count: number): string[] {
  const now = new Date().toISOString();
  return weeksBetween(addDays(now, -90), now).slice(-count);
}

/* ------------------------------------------------------------ fabriques */

/** Une case zone × semaine. */
function zoneWeek(zone: string, week: string, costJp: number, families: Partial<Record<Family, number>>): ZoneWeekInput {
  return { projectId: PROJECT_ID, zone, week, costJp, byFamily: familyNumbers(families) };
}

/** Ventilation par famille complète, à partir de valeurs partielles. */
function familyNumbers(values: Partial<Record<Family, number>>): Record<Family, number> {
  const out = zeroFamilyNumbers();
  for (const family of Object.keys(out) as Family[]) out[family] = values[family] ?? 0;
  return out;
}

/** Totaux par famille d'une addition, à partir de valeurs partielles. */
function familyTotals(values: Partial<Record<Family, Partial<FamilyTotal>>>): Record<Family, FamilyTotal> {
  const out = {} as Record<Family, FamilyTotal>;
  for (const family of Object.keys(zeroFamilyNumbers()) as Family[]) {
    const item = values[family] ?? {};
    out[family] = {
      lowJp: item.lowJp ?? 0,
      highJp: item.highJp ?? 0,
      evidenceCount: item.evidenceCount ?? 0,
      insufficient: item.insufficient ?? false,
    };
  }
  return out;
}

/** Détail de preuve, tel que le calcule la nuit (§18 : la formule est montrée). */
function detail(familyLabel: string, formula: string) {
  return { durationDays: 1, method: 'computed' as const, formula, inputs: {}, familyLabel };
}

/** Date ISO à N jours dans le passé. */
function daysAgo(days: number): string {
  return addDays(new Date().toISOString(), -days);
}
