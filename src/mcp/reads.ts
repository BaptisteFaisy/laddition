/**
 * Lectures partagées des actions MCP (§13).
 *
 * Rien n'est recalculé ici : les additions, les preuves et les coûts de zone
 * sont lus tels que le calcul nocturne les a écrits (§15). Ce fichier ne fait
 * que les retrouver et les trier — une seule implémentation par lecture,
 * partagée par les actions, par `get-debt-case` et par les résolveurs.
 */

import type { DebtBill, Evidence, IssueFact, ZoneCost } from '../core/types';
import { addDays, weeksBetween } from '../core/time';
import {
  getIssueFactByKey,
  getSettings,
  listBills,
  listDebtIssues,
  listEvidence,
  listZoneWeeks,
} from '../platform/db/index';
import { makeSettings } from '../core/settings';
import type { ProjectContext } from './project';
import { projectKeyOf, projectOf } from './project';

/** Instant de référence des lectures : l'horloge du runtime, jamais le domaine. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Ticket de dette et son projet, retrouvés depuis sa clé. */
export interface LocatedDebt {
  project: ProjectContext;
  debt: IssueFact;
}

/**
 * Retrouve la dette et son projet ; jette un motif actionnable si elle est
 * absente (ticket inconnu, ou ticket qui n'est pas une dette — item D45).
 */
export async function locateDebt(issueKey: string): Promise<LocatedDebt> {
  const byKey = await getIssueFactByKey(issueKey);
  if (byKey) {
    if (!byKey.isDebt) {
      throw new Error(
        `« ${issueKey} » n'est pas un ticket de dette : seules les dettes ont une addition ` +
          '(voir list-dead-debt ou le réglage « définition de la dette »)',
      );
    }
    const settings = (await getSettings(byKey.projectId)) ?? makeSettings(byKey.projectId, byKey.projectKey);
    return {
      project: { projectId: byKey.projectId, projectKey: byKey.projectKey, settings },
      debt: byKey,
    };
  }
  const project = await projectOf(projectKeyOf(issueKey));
  const debts = await listDebtIssues(project.projectId);
  const debt = debts.find((item) => item.key === issueKey);
  if (!debt) {
    throw new Error(
      `« ${issueKey} » n'est pas un ticket de dette connu du projet ${project.projectKey} : ` +
        'vérifier la clé, ou lancer le calcul nocturne',
    );
  }
  return { project, debt };
}

/** Addition enregistrée d'un ticket, par sa clé. */
export async function billOf(projectId: string, issueKey: string): Promise<DebtBill> {
  const bills = await listBills(projectId);
  const bill = bills.find((item) => item.key === issueKey);
  if (!bill) {
    throw new Error(
      `aucune addition calculée pour « ${issueKey} » : relancer le calcul nocturne ` +
        "(ou l'initialisation si le projet vient d'être réglé)",
    );
  }
  return bill;
}

/** Preuves d'une addition, dans l'ordre de coût décroissant de `evidenceIds`. */
export async function evidenceOfBill(projectId: string, bill: DebtBill): Promise<Evidence[]> {
  const all = await listEvidence(projectId);
  const byId = new Map(all.map((item) => [item.id, item]));
  const ordered: Evidence[] = [];
  for (const id of bill.evidenceIds) {
    const item = byId.get(id);
    if (item) ordered.push(item);
  }
  return ordered;
}

/** Coûts de toutes les zones sur la fenêtre d'analyse du projet. */
export async function zoneCostsOf(project: ProjectContext): Promise<ZoneCost[]> {
  const now = nowIso();
  const weeks = weeksBetween(addDays(now, -project.settings.windowDays), now);
  return listZoneWeeks(project.projectId, weeks);
}

/** Vrai quand au moins un ticket de dette est rattaché à la zone. */
export async function isZoneCovered(projectId: string, zone: string): Promise<boolean> {
  const debts = await listDebtIssues(projectId);
  return debts.some((debt) => debt.zones.includes(zone));
}

/**
 * Zones mesurées sur la fenêtre, triées (item E67).
 *
 * Servent autant à répondre qu'à **nommer les zones valides dans une erreur** :
 * un appelant qui se trompe de zone reçoit la liste au lieu de deviner.
 */
export function availableZones(costs: readonly ZoneCost[]): string[] {
  return costs.map((item) => item.zone).sort((a, b) => a.localeCompare(b));
}

/** Message d'erreur d'une zone inconnue, avec les zones valides (item E67). */
export function unknownZoneError(zone: string, costs: readonly ZoneCost[], windowDays: number): Error {
  const zones = availableZones(costs);
  const list = zones.length > 0 ? zones.join(', ') : 'aucune zone mesurée sur la fenêtre';
  return new Error(`zone « ${zone} » inconnue sur la fenêtre de ${windowDays} jours — zones disponibles : ${list}`);
}

/** Les cinq preuves les plus coûteuses d'une zone, visibles et facturables (§18). */
export function topEvidenceOf(zone: string, evidence: readonly Evidence[], max = 5): Evidence[] {
  return evidence
    .filter((item) => item.zone === zone && item.visible !== false && item.family !== 'C5')
    .slice()
    .sort((a, b) => b.costJp - a.costJp || a.id.localeCompare(b.id))
    .slice(0, max);
}

/**
 * Preuve visée par sa clé : identifiant de preuve d'abord, clé de source ensuite.
 *
 * Item E74 : cette lecture alimente une action qui **écrit** une décision. Un
 * `sourceKey` porté par plusieurs preuves n'est donc jamais résolu au premier
 * homonyme — l'ambiguïté est refusée, avec les identifiants en clair pour que
 * l'appelant relance sur le bon.
 */
export async function evidenceFor(evidenceKey: string, projectId: string): Promise<Evidence> {
  const all = await listEvidence(projectId);
  const byId = all.filter((item) => item.id === evidenceKey);
  if (byId.length > 0) return byId[0] as Evidence;
  const bySource = all.filter((item) => item.sourceKey === evidenceKey);
  if (bySource.length === 1) return bySource[0] as Evidence;
  if (bySource.length > 1) {
    const ids = bySource.slice(0, 5).map((item) => item.id).join(', ');
    throw new Error(
      `preuve « ${evidenceKey} » ambiguë : ${bySource.length} preuves portent cette clé ` +
        `(identifiants : ${ids}) — renvoyer l'identifiant de preuve exact`,
    );
  }
  throw new Error(
    `preuve « ${evidenceKey} » inconnue du projet : utiliser l'identifiant de preuve ` +
      'rendu par list-zone-evidence ou get-debt-bill',
  );
}
