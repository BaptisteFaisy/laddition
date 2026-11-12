import type { IssueFact, ProjectSettings } from '../core/types';
import { getSettings, saveSettings } from '../platform/db/repos/project';
import { insertRows, onDuplicateUpdate, runDdl, runStatement, selectRows } from '../platform/db/query';

/**
 * Un composant renommé ne doit pas scinder l'historique (item B24, §19 cas 10).
 *
 * Une zone, c'est un composant Jira. Tant qu'elle s'appelle par son **nom**,
 * un renommage coupe l'histoire en deux : les tickets d'avant portent l'ancien
 * nom, ceux d'après le nouveau — et la purge des zones disparues efface alors
 * l'ancienne moitié. Une fusion fait l'inverse : deux composants, une zone.
 *
 * La parade : garder l'**identifiant** Jira du composant, qui lui ne change
 * jamais. L'app mémorise le libellé connu pour chaque identifiant
 * (`zone_alias`) ; quand un identifiant revient avec un autre libellé, c'est un
 * renommage : l'historique stocké est migré vers le nouveau libellé, et la
 * purge ne peut plus le prendre pour une zone disparue.
 */

/** Une zone dont le libellé a changé. */
export interface ZoneRename {
  /** Identifiant Jira du composant, stable. */
  componentId: string;
  /** Libellé précédent, celui qui figure dans l'historique stocké. */
  from: string;
  /** Libellé nouveau. */
  to: string;
}

const TABLE = 'zone_alias';
const COLUMNS = ['project_id', 'component_id', 'label', 'seen_at'] as const;

const DDL =
  `CREATE TABLE IF NOT EXISTS ${TABLE} (` +
  'project_id VARCHAR(64) NOT NULL, component_id VARCHAR(128) NOT NULL, ' +
  'label VARCHAR(255) NOT NULL, seen_at DATETIME(3) NOT NULL, ' +
  'PRIMARY KEY (project_id, component_id)' +
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';

let tableReady: Promise<void> | null = null;

/** Crée la table des libellés connus une fois par exécution. */
function ensureTable(): Promise<void> {
  tableReady ??= runDdl(DDL).catch((error: unknown) => {
    tableReady = null;
    throw error;
  });
  return tableReady;
}

/**
 * Renommages détectés : un identifiant connu dont le libellé a changé.
 *
 * Un identifiant **disparu** n'est pas un renommage : c'est une zone qui
 * s'efface, et son historique part avec la purge (§17). Un libellé repris par un
 * autre identifiant n'est pas un renommage non plus : c'est une fusion, et les
 * deux histoires doivent rester séparées.
 */
export function detectRenames(
  current: ReadonlyMap<string, string>,
  previous: ReadonlyMap<string, string>,
): ZoneRename[] {
  const renames: ZoneRename[] = [];
  for (const [componentId, label] of current) {
    const before = previous.get(componentId);
    if (before === undefined || before === label) continue;
    if (before.length === 0 || label.length === 0) continue;
    // Le nouveau libellé était-il porté par un **autre** identifiant ? Alors
    // c'est une fusion : un composant a repris le nom d'un composant disparu,
    // et les deux histoires doivent rester séparées.
    if ([...previous].some(([id, other]) => id !== componentId && other === label)) continue;
    // L'ancien libellé est-il encore porté par un autre composant ? Migrer
    // l'historique vers ce nom-là le mélangerait avec l'autre zone.
    if ([...current].some(([id, other]) => id !== componentId && other === before)) continue;
    renames.push({ componentId, from: before, to: label });
  }
  return renames;
}

/**
 * Libellés vus sur les tickets d'un projet : identifiant → libellé.
 *
 * Les composants sans identifiant Jira sont ignorés : ils n'ont pas d'identité
 * stable, donc un renommage les resterait invisible — autant le dire.
 */
export function componentLabels(facts: readonly IssueFact[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const fact of facts) {
    const ids = fact.componentIds ?? [];
    fact.components.forEach((name, index) => {
      const id = ids[index] ?? '';
      if (id.length === 0 || name.length === 0) return;
      labels.set(id, name);
    });
  }
  return labels;
}

/** Libellés connus pour un projet : ce que l'app a vu la dernière fois. */
export async function knownComponentLabels(projectId: string): Promise<Map<string, string>> {
  await ensureTable();
  const rows = await selectRows<{ component_id: unknown; label: unknown }>(
    `SELECT component_id, label FROM ${TABLE} WHERE project_id = ?`,
    [projectId],
  );
  const labels = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.component_id === 'string' && typeof row.label === 'string') {
      labels.set(row.component_id, row.label);
    }
  }
  return labels;
}

/** Mémorise les libellés vus : la prochaine passe saura dire si un nom a changé. */
export async function rememberComponentLabels(
  projectId: string,
  labels: ReadonlyMap<string, string>,
): Promise<void> {
  if (labels.size === 0) return;
  await ensureTable();
  const seenAt = new Date().toISOString();
  await insertRows({
    table: TABLE,
    columns: [...COLUMNS],
    rows: [...labels].map(([componentId, label]) => ({ projectId, componentId, label, seenAt })),
    toValues: (item) => [item.projectId, item.componentId, item.label, item.seenAt],
    onDuplicate: onDuplicateUpdate(COLUMNS, ['project_id', 'component_id']),
  });
}

/**
 * Migre l'historique stocké d'une zone renommée.
 *
 * Trois endroits portent un libellé de zone : les preuves, l'instantané
 * `zone_week` et la carte « équipe → zone » des réglages. Les trois sont
 * migrés, sinon l'historique resterait coupé (ou l'équipe perdrait sa zone).
 */
export async function migrateRenamedZones(
  projectId: string,
  renames: readonly ZoneRename[],
): Promise<number> {
  let migrated = 0;
  for (const rename of renames) {
    const evidence = await runStatement(
      'UPDATE evidence SET zone = ? WHERE project_id = ? AND zone = ?',
      [rename.to, projectId, rename.from],
    );
    const weeks = await runStatement(
      'UPDATE zone_week SET zone = ? WHERE project_id = ? AND zone = ?',
      [rename.to, projectId, rename.from],
    );
    migrated += (evidence.affectedRows ?? 0) + (weeks.affectedRows ?? 0);
  }
  await migrateTeamMap(projectId, renames);
  return migrated;
}

/** Renomme la zone dans la carte « équipe → zone » des réglages. */
async function migrateTeamMap(projectId: string, renames: readonly ZoneRename[]): Promise<void> {
  const settings = await getSettings(projectId);
  if (!settings) return;
  const teams = { ...settings.teamByZone };
  let changed = false;
  for (const rename of renames) {
    const team = teams[rename.from];
    if (team === undefined) continue;
    delete teams[rename.from];
    teams[rename.to] = team;
    changed = true;
  }
  if (!changed) return;
  await saveSettings({ ...settings, teamByZone: teams } as ProjectSettings);
}

/**
 * Passage de remembers : détecte les renommages, migre l'historique, et
 * mémorise les libellés vus pour la prochaine fois.
 *
 * Renvoie les renommages traités, pour que l'appelant puisse le dire (le
 * recalcul journalier le consigne dans son rapport).
 */
export async function syncComponentLabels(
  projectId: string,
  facts: readonly IssueFact[],
): Promise<ZoneRename[]> {
  const current = componentLabels(facts);
  if (current.size === 0) return [];
  const previous = await knownComponentLabels(projectId);
  const renames = detectRenames(current, previous);
  if (renames.length > 0) await migrateRenamedZones(projectId, renames);
  await rememberComponentLabels(projectId, current);
  return renames;
}
