/**
 * GET `list-zone-evidence` — les preuves d'une zone (items E67, D55, §13).
 *
 * C'est l'outil dont un **agent de code** a besoin avant de toucher une zone :
 * `get-zone-costs` dit combien la zone coûte, celui-ci dit **sur quoi** ce coût
 * repose — chaque preuve avec sa clé source, sa famille, son coût et sa formule.
 *
 * Rien n'est recalculé (§15) : les preuves sont lues telles que le calcul
 * nocturne les a écrites. Les preuves hors des droits du lecteur sont comptées
 * dans le total mais masquées (§18).
 */

import type { CostMethod, Evidence, Family } from '../core/types';
import { BILLED_FAMILIES } from '../core/types';
import { listEvidence } from '../platform/db/index';
import { resolveProject } from './project';
import { availableZones, unknownZoneError, zoneCostsOf } from './reads';
import { maskEvidence } from './masking';
import type { ActionEnvelope, JsonPayload } from './result';
import { optionalText, requireText, run } from './result';

/** Une preuve de la zone, avec ce qui la justifie. */
export interface ZoneEvidenceRow {
  id: string;
  /** Clé du ticket source ; vide quand la preuve est masquée (§18). */
  sourceKey: string;
  family: Family;
  familyLabel: string;
  costJp: number;
  /** Formule appliquée, avec ses valeurs : c'est la transparence du §18. */
  formula: string;
  method: CostMethod;
  occurredAt: string;
  /** Vrai pour C5 : un délai, jamais additionné au coût. */
  isDelay: boolean;
  /** Vrai quand la famille manque de références pour être chiffrée (§9, C3). */
  insufficient: boolean;
  visible: boolean;
}

/** Preuves d'une zone, total et méthode en vigueur. */
export interface ZoneEvidenceData {
  projectKey: string;
  zone: string;
  windowDays: number;
  /** Zones mesurées sur la fenêtre : l'appelant ne devine jamais un nom. */
  availableZones: string[];
  /** Coût facturable de la zone (C1 à C4) ; le retard induit en est exclu. */
  totalJp: number;
  /** Délai induit (C5), rendu à part : ce n'est pas de l'effort. */
  delayDays: number;
  evidence: ZoneEvidenceRow[];
  /** Preuves comptées mais masquées pour ce lecteur. */
  hiddenCount: number;
}

/** GET `list-zone-evidence` : sur quoi repose le coût d'une zone. */
export async function listZoneEvidence(payload: JsonPayload): Promise<ActionEnvelope<ZoneEvidenceData>> {
  return run(async () => {
    const zone = requireText(payload, 'zone');
    const project = await resolveProject(optionalText(payload, 'projectKey'));
    const costs = await zoneCostsOf(project);
    const cost = costs.find((item) => item.zone === zone);
    if (!cost) throw unknownZoneError(zone, costs, project.settings.windowDays);
    const masked = maskEvidence(await evidenceOfZone(project.projectId, zone));
    const rows = masked.evidence.map(toRow);
    return {
      projectKey: project.projectKey,
      zone,
      windowDays: project.settings.windowDays,
      availableZones: availableZones(costs),
      totalJp: sumOf(rows, (row) => !row.isDelay),
      delayDays: sumOf(rows, (row) => row.isDelay),
      evidence: rows,
      hiddenCount: masked.hiddenCount,
    };
  });
}

/** Preuves d'une zone, les plus coûteuses d'abord, puis par clé source. */
async function evidenceOfZone(projectId: string, zone: string) {
  const all = await listEvidence(projectId);
  return all
    .filter((item) => item.zone === zone)
    .sort((a, b) => b.costJp - a.costJp || a.sourceKey.localeCompare(b.sourceKey));
}

/** Ligne rendue : la famille dit si c'est un coût ou un délai. */
function toRow(item: Evidence): ZoneEvidenceRow {
  return {
    id: item.id,
    sourceKey: item.sourceKey,
    family: item.family,
    familyLabel: item.detail.familyLabel,
    costJp: item.costJp,
    formula: item.detail.formula,
    method: item.method,
    occurredAt: item.occurredAt,
    isDelay: !BILLED_FAMILIES.includes(item.family),
    insufficient: item.insufficient === true,
    visible: item.visible !== false,
  };
}

/** Somme des lignes retenues, arrondie au centième. */
function sumOf(rows: readonly ZoneEvidenceRow[], keep: (row: ZoneEvidenceRow) => boolean): number {
  const total = rows.reduce((sum, row) => (keep(row) ? sum + row.costJp : sum), 0);
  return Math.round(total * 100) / 100;
}
