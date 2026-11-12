/**
 * Purge bornée du stockage (§17 : 1 Gio par installation).
 *
 * Sans purge, trois tables grossissent indéfiniment : `zone_week` (une ligne
 * par zone et par semaine, à vie), `issue_fact.description` (`MEDIUMTEXT` par
 * ticket) et `status_span` (l'historique complet de chaque ticket). Le cache
 * des scores et les preuves suivent le même sort, plus lentement.
 *
 * **Ce qui est conservé** (les deux fenêtres du produit) :
 * - la **dette morte** (§7.3, DT-09) : `deadDays`, 180 jours par défaut — rien
 *   de plus récent n'est touché, donc le classement des dettes qui dorment et
 *   la fenêtre d'analyse (90 jours) restent intacts ;
 * - les **bulletins** (§11) : `bulletinWeeks`, 8 semaines par défaut — les
 *   lignes `repayment` sont de toute façon autoportantes (`before_rate`,
 *   `after_rate`, `weeks_before`, `weeks_after`) : purger les semaines ne
 *   détruit aucun bulletin publié.
 *
 * **Ce qui est effacé**, enfants avant parents (§17 : pas de clé étrangère) :
 * attributions des vieilles preuves → séjours des tickets dont la dernière
 * activité est antérieure à la fenêtre → vieilles preuves → descriptions des
 * vieux tickets → vieilles semaines → vieux scores → vieux rejets →
 * confirmations orphelines.
 *
 * Chaque instruction est bornée (`LIMIT`) et rejouée jusqu'à épuisement : la
 * purge ne dépasse jamais 5 s par requête et peut s'arrêter à tout moment sans
 * laisser de trou (Forge SQL n'a pas de transaction).
 *
 * Elle n'est branchée nulle part ici : c'est le lot D (jobs) qui décide quand
 * l'appeler — une fois par nuit, après le recalcul, est le choix naturel.
 */

import { addDays, weekKey } from '../../../core/time';
import type { SqlParams } from '../rows';
import { MAX_PAGE_LIMIT, runStatement, safeLimitInt, selectRows } from '../query';
import { toDbDateRequired } from '../rows';

/** Ancienneté conservée par défaut : la fenêtre de la dette morte (§7.3). */
export const PURGE_DEAD_DAYS = 180;

/** Ancienneté conservée par défaut pour les semaines : les bulletins (§11). */
export const PURGE_BULLETIN_WEEKS = 8;

/** Lignes effacées par instruction : borne la durée d'une requête (§17). */
export const PURGE_BATCH = 500;

/** Instructions maximum par table : garde-fou contre une boucle infinie. */
const PURGE_MAX_ROUNDS = 40;

/** Réglages d'une purge ; toute valeur absente prend le défaut du produit. */
export interface PurgeOptions {
  /** Instant de référence (ISO) ; l'instant de l'appel par défaut. */
  now?: string;
  /** Ancienneté conservée pour les faits, preuves et scores (jours). */
  deadDays?: number;
  /** Ancienneté conservée pour les semaines de coût (semaines). */
  bulletinWeeks?: number;
  /** Lignes effacées par instruction. */
  batchSize?: number;
}

/** Compte rendu d'une purge : ce qui a été rendu au plafond de 1 Gio. */
export interface PurgeReport {
  projectId: string;
  /** Lignes effacées, par table. */
  deleted: Record<string, number>;
  /** Descriptions vidées (le `MEDIUMTEXT` des vieux tickets). */
  trimmedDescriptions: number;
  /**
   * Instructions en échec : la purge continue, l'échec est signalé (§17).
   *
   * Constaté le 12/11 en production : une purge qui échouait interrompait tout
   * le calcul et le projet n'était jamais recalculé.
   */
  errors?: string[];
}

/**
 * Purge un projet : tout ce qui est plus vieux que les fenêtres conservées.
 *
 * Idempotente et sans effet sur un projet récent. Ne jette pas pour une table
 * vide ; propage en revanche une erreur SQL réelle (l'appelant décide).
 */
export async function purgeProject(projectId: string, options: PurgeOptions = {}): Promise<PurgeReport> {
  const cutoffs = purgeCutoffs(options);
  const batch = options.batchSize ?? PURGE_BATCH;
  const report: PurgeReport = { projectId, deleted: {}, trimmedDescriptions: 0 };

  report.deleted['attribution'] = await deleteBounded(
    'attribution',
    batch,
    `project_id = ? AND evidence_id IN (
       SELECT evidence_id FROM evidence WHERE project_id = ? AND occurred_at < ?)`,
    [projectId, projectId, cutoffs.old],
  );
  report.deleted['status_span'] = await deleteBounded(
    'status_span',
    batch,
    `issue_id IN (
       SELECT issue_id FROM issue_fact
        WHERE project_id = ?
          AND created_at < ?
          AND COALESCE(resolved_at, closed_at, created_at) < ?)`,
    [projectId, cutoffs.old, cutoffs.old],
  );
  report.deleted['evidence'] = await deleteBounded(
    'evidence',
    batch,
    'project_id = ? AND occurred_at < ?',
    [projectId, cutoffs.old],
  );
  report.trimmedDescriptions = await trimDescriptions(projectId, cutoffs.old, batch);
  report.deleted['zone_week'] = await deleteBounded(
    'zone_week',
    batch,
    'project_id = ? AND week < ?',
    [projectId, cutoffs.oldWeek],
  );
  report.deleted['score_cache'] = await deleteBounded(
    'score_cache',
    batch,
    'project_id = ? AND computed_at < ?',
    [projectId, cutoffs.old],
  );
  // Après `evidence` : les confirmations perdues par la purge deviennent orphelines.
  Object.assign(report.deleted, await purgeDecisions(projectId, cutoffs.old, batch));
  return report;
}

/**
 * Purge tous les projets connus (une ligne par projet dans `settings`).
 *
 * Utile à la sonde d'exploitation et au passage nocturne : le plafond de 1 Gio
 * est celui de l'installation, pas d'un projet (§17).
 */
export async function purgeAllProjects(options: PurgeOptions = {}): Promise<PurgeReport[]> {
  const reports: PurgeReport[] = [];
  for (const projectId of await knownProjectIds()) {
    reports.push(await purgeProject(projectId, options));
  }
  return reports;
}

/** Seuils d'ancienneté d'une purge, en formats SQL et semaine ISO. */
export interface PurgeCutoffs {
  /** Date SQL : plus vieux que la dette morte (jours). */
  old: string;
  /** Clé de semaine ISO : plus vieux que les bulletins conservés. */
  oldWeek: string;
}

/** Calcule les seuils ; `now` explicite pour rester rejouable en test. */
export function purgeCutoffs(options: PurgeOptions = {}): PurgeCutoffs {
  const now = options.now ?? new Date().toISOString();
  const deadDays = Math.max(1, options.deadDays ?? PURGE_DEAD_DAYS);
  const bulletinWeeks = Math.max(1, options.bulletinWeeks ?? PURGE_BULLETIN_WEEKS);
  const oldIso = addDays(now, -deadDays);
  // Les semaines servent aussi aux courbes (90 jours) : on garde le plus long.
  const weekDays = Math.max(deadDays, bulletinWeeks * 7);
  return { old: toDbDateRequired(oldIso), oldWeek: weekKey(addDays(now, -weekDays)) };
}

/** Projets réglés, dans l'ordre de leur identifiant. */
async function knownProjectIds(): Promise<string[]> {
  const rows = await selectRows<{ project_id: string }>(
    'SELECT project_id FROM settings ORDER BY project_id',
  );
  return rows.map((row) => row.project_id);
}

/**
 * Efface par instructions bornées, jusqu'à épuisement.
 *
 * `table` et `where` sont des constantes de ce module : aucune valeur venue de
 * l'appelant n'est interpolée, seuls les paramètres sont liés.
 */
async function deleteBounded(
  table: string,
  batchSize: number,
  where: string,
  params: SqlParams,
): Promise<number> {
  let total = 0;
  for (let round = 0; round < PURGE_MAX_ROUNDS; round += 1) {
    // LIMIT inline : Forge SQL refuse un paramètre lié ici (voir query.safeLimitInt).
    const bound = safeLimitInt(batchSize, 1, MAX_PAGE_LIMIT);
    const result = await runStatement(`DELETE FROM ${table} WHERE ${where} LIMIT ${bound}`, params);
    const affected = result.affectedRows ?? 0;
    total += affected;
    if (affected < batchSize) break;
  }
  return total;
}

/**
 * Vide la `description` des tickets sortis de toute fenêtre : le `MEDIUMTEXT`
 * est rendu au plafond sans perdre le fait lui-même, que le classement et les
 * bulletins citent encore.
 *
 * Le critère est celui des séjours de statut — création **et** dernière
 * activité avant le seuil. Un ticket créé il y a un an mais résolu hier reste
 * dans la fenêtre d'analyse : son texte sert encore au score de pertinence
 * (§18), donc on n'y touche pas.
 */
async function trimDescriptions(projectId: string, old: string, batchSize: number): Promise<number> {
  let total = 0;
  for (let round = 0; round < PURGE_MAX_ROUNDS; round += 1) {
    const result = await runStatement(
      'UPDATE issue_fact SET description = NULL ' +
        'WHERE project_id = ? AND created_at < ? ' +
        'AND COALESCE(resolved_at, closed_at, created_at) < ? ' +
        `AND description IS NOT NULL LIMIT ${safeLimitInt(batchSize, 1, MAX_PAGE_LIMIT)}`,
      [projectId, old, old, batchSize],
    );
    const affected = result.affectedRows ?? 0;
    total += affected;
    if (affected < batchSize) break;
  }
  return total;
}

/**
 * Tables de décision (§7.4, §10 règle 2) : les vieux rejets sont rendus au
 * plafond et les confirmations dont la preuve n'existe plus — purgée à
 * l'instant ou disparue avant — suivent comme orphelines (reliquat item 22).
 * Une confirmation est une décision, pas un calcul : tant que sa preuve vit,
 * elle reste, quel que soit son âge.
 */
async function purgeDecisions(
  projectId: string,
  old: string,
  batch: number,
): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  deleted['rejection'] = await deleteBounded(
    'rejection',
    batch,
    'project_id = ? AND rejected_at < ?',
    [projectId, old],
  );
  // `confirmation` vit hors du schéma §16 (DDL dans `jobs/confirmations.ts`) :
  // installation neuve sans table = rien à purger, pas une erreur SQL.
  if (await tableExists('confirmation')) {
    deleted['confirmation'] = await deleteBounded(
      'confirmation',
      batch,
      `project_id = ? AND evidence_id NOT IN (
         SELECT evidence_id FROM evidence WHERE project_id = ?)`,
      [projectId, projectId],
    );
  }
  return deleted;
}

/** Vrai quand la table est présente dans la base de l'app (même requête que `isSchemaReady`). */
async function tableExists(table: string): Promise<boolean> {
  try {
    const rows = await selectRows<{ name: unknown }>(
      'SELECT table_name AS name FROM information_schema.tables ' +
        'WHERE table_schema = DATABASE() AND table_name = ?',
      [table],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}
