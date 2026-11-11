import type { Request } from '@forge/resolver';
import type { Attribution, Evidence, IssueFact, ProjectSettings, StatusSpan } from '../core/types';
import { buildBill } from '../core/bill';
import { makeSettings, mergeSettings } from '../core/settings';
import { runStatement, selectRows } from '../platform/db/query';
import {
  getSettings as readSettings,
  replaceAttributions,
  replaceEvidence,
  replaceStatusSpans,
  saveSettings,
  upsertBill,
  upsertIssueFacts,
  upsertRepayment,
  upsertZoneWeek,
} from '../platform/db/index';
import { buildSampleData, sampleContext, sampleProjectSettings } from '../sample/load';
import { weeklyZoneCosts } from '../jobs/zoneCosts';
import { projectIdOf } from '../jobs/projects';
import type { Failure } from '../jobs/support';
import { guard, nowIso, payloadOf } from '../jobs/support';

/**
 * DT-13 : jeu d'exemple, pour tester sans historique (§22).
 *
 * Les données ne sont pas une maquette : `buildSampleData` exécute la méthode
 * complète sur un projet fictif. Elles sont rangées dans la partition du projet
 * courant — celle que lisent les écrans et le calcul nocturne — et les tickets
 * du jeu y sont réétiquetés : aucune écriture ne touche un vrai ticket.
 *
 * Le retrait n'efface que des données marquées `demoData` : sur un projet
 * mesuré, il refuse au lieu de vider les chiffres réels.
 */

/** Bilan de l'injection. */
export interface SampleResult {
  ok: true;
  projectId: string;
  facts: number;
  evidence: number;
  zones: number;
}

/** Injecte le jeu d'exemple ; rejouer l'injection remplace le précédent. */
export async function loadSampleData(request: Request<unknown>): Promise<SampleResult | Failure> {
  return guard(async () => {
    const projectId = await projectIdOf(payloadOf(request));
    const existing = await readSettings(projectId);
    await assertEmptyOrDemo(projectId, existing);
    const now = nowIso();
    const data = buildSampleData(now);
    const facts = retag(data.facts, projectId);
    await upsertIssueFacts(facts);
    await replaceStatusSpansMany(data.spans);
    await replaceEvidence(projectId, data.evidence);
    await replaceAttributions(projectId, data.attributions);
    await upsertZoneWeek(weeklyZoneCosts(data.evidence, projectId, sampleProjectSettings().teamByZone));
    await writeBills(facts, data.evidence, data.attributions, now);
    for (const repayment of data.repayment) await upsertRepayment(repayment);
    await saveSettings(demoSettings(projectId, existing));
    return { ok: true, projectId, facts: facts.length, evidence: data.evidence.length, zones: data.zones.length };
  });
}

/** Tickets du jeu rangés dans la partition du projet courant (clés inchangées). */
function retag(facts: IssueFact[], projectId: string): IssueFact[] {
  return facts.map((fact) => ({ ...fact, projectId }));
}

/**
 * Additions du jeu, calculées par le domaine — le classement s'affiche tout de
 * suite, sans attendre la nuit ni appeler Jira.
 */
async function writeBills(
  facts: IssueFact[],
  evidence: Evidence[],
  attributions: Attribution[],
  now: string,
): Promise<void> {
  const ctx = sampleContext(now);
  for (const debt of facts.filter((fact) => fact.isDebt)) {
    await upsertBill(buildBill(debt, evidence, attributions, ctx));
  }
}

/** Réglages du projet d'exemple, marqués « données d'exemple ». */
function demoSettings(projectId: string, existing: ProjectSettings | null): ProjectSettings {
  const base = existing ?? makeSettings(projectId, projectId);
  const merged = mergeSettings(base, sampleProjectSettings());
  return { ...merged, projectId, projectKey: base.projectKey, demoData: true };
}

/**
 * Refuse d'écraser un projet mesuré : le jeu d'exemple ne s'installe que sur un
 * projet vide, ou sur un projet déjà marqué « données d'exemple ».
 */
async function assertEmptyOrDemo(projectId: string, existing: ProjectSettings | null): Promise<void> {
  if (existing?.demoData === true) return;
  const rows = await selectRows<{ total: unknown }>(
    'SELECT COUNT(*) AS total FROM issue_fact WHERE project_id = ?',
    [projectId],
  );
  const total = Number(rows[0]?.total ?? 0);
  if (total > 0) throw new Error('projet déjà initialisé : le jeu d\'exemple ne remplace pas des données réelles');
}

/** Séjours de statut du jeu, un remplacement par ticket. */
async function replaceStatusSpansMany(spans: StatusSpan[]): Promise<void> {
  const byIssue = new Map<string, StatusSpan[]>();
  for (const span of spans) {
    const list = byIssue.get(span.issueId);
    if (list) list.push(span);
    else byIssue.set(span.issueId, [span]);
  }
  for (const [issueId, list] of byIssue) await replaceStatusSpans(issueId, list);
}

/** Retire le jeu d'exemple (DT-13) ; sans le marqueur, rien n'est effacé. */
export async function clearSampleData(request: Request<unknown>): Promise<{ ok: true } | Failure> {
  return guard(async () => {
    const projectId = await projectIdOf(payloadOf(request));
    const settings = await readSettings(projectId);
    if (settings?.demoData !== true) {
      throw new Error('ce projet ne contient pas de données d\'exemple : rien à effacer');
    }
    for (const statement of CLEAR_STATEMENTS) await runStatement(statement, [projectId]);
    await saveSettings({ ...settings, demoData: false });
    return { ok: true };
  });
}

/** Effacement table par table, dans l'ordre des dépendances (§17 : pas de clé étrangère). */
const CLEAR_STATEMENTS = [
  'DELETE FROM status_span WHERE issue_id IN (SELECT issue_id FROM issue_fact WHERE project_id = ?)',
  'DELETE FROM evidence WHERE project_id = ?',
  'DELETE FROM attribution WHERE project_id = ?',
  'DELETE FROM rejection WHERE project_id = ?',
  'DELETE FROM debt_bill WHERE debt_issue_id IN (SELECT issue_id FROM issue_fact WHERE project_id = ?)',
  'DELETE FROM zone_week WHERE project_id = ?',
  'DELETE FROM baseline WHERE project_id = ?',
  'DELETE FROM repayment WHERE debt_issue_id IN (SELECT issue_id FROM issue_fact WHERE project_id = ?)',
  'DELETE FROM issue_fact WHERE project_id = ?',
];
