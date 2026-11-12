import type { IssueFact, ProjectSettings } from '../core/types';
import { addDays, weeksBetween } from '../core/time';
import { listIssuesInWindow, listZoneWeeks } from '../platform/db/index';
import { runStatement } from '../platform/db/query';

/**
 * Cycle de vie d'une zone : renommage, fusion, disparition (B24, §19).
 *
 * Une zone n'existe que par les tickets qui la portent. Quand un composant est
 * renommé ou fusionné, l'ancienne zone reste en base avec son historique : elle
 * doit être marquée « à recalculer », puis purgée de `zone_week` dès que plus
 * aucun ticket ne la porte.
 */

/** Toute l'histoire conservée : la fenêtre de la dette morte (§7.3). */
const PURGE_LOOKBACK = '1970-01-01T00:00:00.000Z';

/**
 * Zones qui disparaissent d'un ticket : composant renommé, fusionné, ou retiré
 * du ticket (B24). L'ancienne zone doit être invalidée, puis purgée de
 * `zone_week` si plus aucun ticket ne la porte.
 */
export function disappearedZones(previous: IssueFact | null, next: IssueFact): string[] {
  if (!previous) return [];
  return previous.zones.filter((zone) => zone.length > 0 && !next.zones.includes(zone));
}

/** Zones encore portées par un lot de tickets, sans doublon. */
export function zonesInUse(facts: readonly IssueFact[]): Set<string> {
  const zones = new Set<string>();
  for (const fact of facts) {
    for (const zone of fact.zones) {
      if (zone.length > 0) zones.add(zone);
    }
  }
  return zones;
}

/**
 * Purge les semaines de coût de zones disparues.
 *
 * TODO(integration) : le lot C expose `purgeProject` (`platform/db/repos/purge.ts`),
 * qui purge par **ancienneté** ; la purge par **zone disparue** doit y atterrir
 * (`purgeMissingZones(projectId, zones)`). En attendant, c'est ici, en une
 * instruction bornée.
 */
export async function purgeZoneWeeks(projectId: string, zones: readonly string[]): Promise<number> {
  if (zones.length === 0) return 0;
  const placeholders = zones.map(() => '?').join(', ');
  const result = await runStatement(
    `DELETE FROM zone_week WHERE project_id = ? AND zone IN (${placeholders})`,
    [projectId, ...zones],
  );
  return result.affectedRows ?? 0;
}

/** Zones connues en base mais plus portées par aucun ticket : à purger. */
export function zonesToPurge(knownZones: readonly string[], inUse: ReadonlySet<string>): string[] {
  return [...new Set(knownZones)].filter((zone) => zone.length > 0 && !inUse.has(zone));
}

/**
 * Purge `zone_week` des zones disparues du projet (B24).
 *
 * Les zones encore portées sont lues sur **tous** les faits du projet, pas sur
 * la seule fenêtre de 90 jours : une zone dont les tickets sont plus anciens
 * n'a pas disparu pour autant, et purger son historique effacerait des tendances
 * encore utiles. Renvoie les zones purgées.
 */
export async function purgeDisappearedZones(
  projectId: string,
  settings: ProjectSettings,
  now: string,
): Promise<string[]> {
  const facts = await listIssuesInWindow(projectId, PURGE_LOOKBACK);
  const weeks = weeksBetween(addDays(now, -Math.max(7, settings.deadDays)), now);
  const known = await listZoneWeeks(projectId, weeks);
  const gone = zonesToPurge(known.map((cost) => cost.zone), zonesInUse(facts));
  await purgeZoneWeeks(projectId, gone);
  return gone;
}
