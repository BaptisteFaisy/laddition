import type { Request } from '@forge/resolver';
import type { Attribution, Evidence } from '../core/types';
import { getIssueFact, listAttributions, listDebtIssues, listEvidence } from '../platform/db/index';
import { maskEvidence } from '../mcp/masking';
import { projectIdOf } from '../jobs/projects';
import type { Failure } from '../jobs/support';
import { guard, payloadOf, requireString } from '../jobs/support';

/**
 * Lectures de preuves et de parts (§10, §18, items D55/D57).
 *
 * Deux clés demandées par les écrans (`ui/api.ts`) :
 * - `listZoneEvidence` : les preuves d'une zone, chacune avec les parts qui la
 *   répartissent entre les dettes — c'est le chemin du chiffre en deux clics ;
 * - `listDebtAttributions` : les parts d'une dette, pour vérifier la recette
 *   §20 n° 2 (« la somme des parts ne dépasse pas 100 % »).
 *
 * Comme partout ailleurs, rien n'est recalculé : les preuves et les parts sont
 * lues telles que la nuit les a écrites (§15), et ce que le lecteur n'a pas le
 * droit d'ouvrir est masqué avant de sortir du serveur (§18).
 */

/** Part d'une preuve imputée à une dette, telle que l'écran l'affiche. */
export interface AttributionShare {
  debtIssueId: string;
  debtKey: string;
  share: number;
}

/** Une preuve de zone et les parts qui la répartissent. */
export interface ZoneEvidenceLine {
  evidence: Evidence;
  shares: AttributionShare[];
}

/** Preuves d'une zone, les plus coûteuses d'abord, avec leurs parts. */
export async function listZoneEvidence(request: Request<unknown>): Promise<ZoneEvidenceLine[] | Failure> {
  return guard(async () => {
    const payload = payloadOf(request);
    const projectId = await projectIdOf(payload);
    const zone = requireString(payload, 'zone');
    const [stored, attributions, debts] = await Promise.all([
      listEvidence(projectId),
      listAttributions(projectId),
      listDebtIssues(projectId),
    ]);
    const ofZone = stored
      .filter((item) => item.zone === zone)
      .sort((a, b) => b.costJp - a.costJp || a.sourceKey.localeCompare(b.sourceKey));
    const keys = new Map(debts.map((debt) => [debt.issueId, debt.key]));
    return maskEvidence(ofZone).evidence.map((evidence) => ({
      evidence,
      shares: sharesOf(attributions, evidence.id, keys),
    }));
  });
}

/** Parts d'attribution d'une dette, les plus importantes d'abord. */
export async function listDebtAttributions(request: Request<unknown>): Promise<Attribution[] | Failure> {
  return guard(async () => {
    const debtIssueId = requireString(payloadOf(request), 'debtIssueId');
    const fact = await getIssueFact(debtIssueId);
    if (!fact) throw new Error(`ticket ${debtIssueId} inconnu : lancer l'initialisation`);
    const attributions = await listAttributions(fact.projectId);
    return attributions
      .filter((item) => item.debtIssueId === debtIssueId)
      .sort((a, b) => b.share - a.share || a.evidenceId.localeCompare(b.evidenceId));
  });
}

/** Parts d'une preuve, toutes dettes confondues, avec la clé de chaque dette. */
function sharesOf(
  attributions: readonly Attribution[],
  evidenceId: string,
  keys: Map<string, string>,
): AttributionShare[] {
  return attributions
    .filter((item) => item.evidenceId === evidenceId)
    .map((item) => ({
      debtIssueId: item.debtIssueId,
      debtKey: keys.get(item.debtIssueId) ?? item.debtIssueId,
      share: item.share,
    }))
    .sort((a, b) => b.share - a.share || a.debtKey.localeCompare(b.debtKey));
}
