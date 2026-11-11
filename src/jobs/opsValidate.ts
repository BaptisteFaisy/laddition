import { fetchChangelog, fetchIssue, searchIssues } from '../platform/jira';
import { ensureDebtCostField, writeDebtCost } from '../platform/field';
import { fetchIncidentServices, fetchTeamByComponent, fetchZoneLinks } from '../platform/graph';
import { BOOTSTRAP_FIELDS } from './consumer';
import { requireSettings } from './projects';
import type { ProjectSettings } from '../core/types';

/**
 * Validations du §17 : ce que le cahier des charges demande de vérifier par un
 * prototype avant de construire. Chaque sonde rend un verdict mesuré, jamais une
 * supposition — c'est ce qui alimente `docs/VALIDATIONS.md`.
 */

/** Résultat d'une sonde : ce qui a été mesuré, et ce qu'on en conclut. */
export interface Probe {
  name: string;
  ok: boolean;
  /** Mesures brutes, lisibles telles quelles. */
  measures: Record<string, number | string | boolean>;
  /** Conclusion pour le §17 : on garde, ou on prend le repli. */
  verdict: string;
}

/** Taille de l'échantillon par défaut des sondes. */
const DEFAULT_SAMPLE = 20;

/** Budget du recalcul nocturne (§18) : 15 minutes pour 5 000 tickets. */
const NIGHTLY_BUDGET_MS = 15 * 60 * 1000;
const NIGHTLY_TARGET_ISSUES = 5000;

/** Lance la sonde demandée ; une sonde inconnue rend la liste des connues. */
export async function runProbe(probe: string, projectKey: string, sample: number): Promise<Probe> {
  switch (probe) {
    case 'throughput':
      return probeThroughput(projectKey, sample);
    case 'field':
      return probeFieldWrite(projectKey, sample);
    case 'graph':
      return probeTeamworkGraph(projectKey);
    default:
      return {
        name: probe,
        ok: false,
        measures: {},
        verdict: 'sonde inconnue ; disponibles : throughput, field, graph',
      };
  }
}

/**
 * §17 « Volume et débit de lecture des historiques ».
 * Lit un échantillon de tickets avec leur historique et extrapole au budget de
 * 15 minutes pour 5 000 tickets (§18).
 */
export async function probeThroughput(projectKey: string, sample: number): Promise<Probe> {
  const settings = await projectSettingsOf(projectKey);
  const size = Math.max(1, Math.min(sample || DEFAULT_SAMPLE, 50));
  // Sondage hors fenêtre de 180 jours : le site de démo a un historique ancien,
  // et ce qu'on mesure ici est le débit de lecture, pas la fraîcheur.
  const page = await searchIssues(
    `project = ${settings.projectKey} ORDER BY updated DESC`,
    BOOTSTRAP_FIELDS,
    size,
  );
  const issues = page?.issues ?? [];
  const started = Date.now();
  let histories = 0;
  let entries = 0;
  let failed = 0;
  for (const issue of issues) {
    const log = await fetchChangelog(issue.key);
    if (log === null) failed += 1;
    else {
      histories += 1;
      entries += log.length;
    }
  }
  const elapsed = Date.now() - started;
  return throughputVerdict(issues.length, histories, entries, failed, elapsed);
}

/** Extrapolation et verdict de la sonde de débit. */
function throughputVerdict(
  read: number,
  histories: number,
  entries: number,
  failed: number,
  elapsed: number,
): Probe {
  const perIssue = read > 0 ? Math.round(elapsed / read) : 0;
  const projected = perIssue * NIGHTLY_TARGET_ISSUES;
  const fits = projected <= NIGHTLY_BUDGET_MS;
  return {
    name: 'throughput',
    ok: read > 0 && failed === 0,
    measures: {
      ticketsLus: read,
      historiquesOk: histories,
      historiquesEchoues: failed,
      entreesDHistorique: entries,
      msTotal: elapsed,
      msParTicket: perIssue,
      projetePour5000Tickets: `${Math.round(projected / 60000)} min`,
    },
    verdict: fits
      ? `le budget de 15 min tient pour ${NIGHTLY_TARGET_ISSUES} tickets (${Math.round(projected / 60000)} min projetées) : lots de 50 conservés`
      : `le budget de 15 min est dépassé (${Math.round(projected / 60000)} min projetées) : appliquer le repli du §17 (fenêtre réduite à 90 jours, lots plus petits)`,
  };
}

/**
 * §17 « Écriture en masse d'un champ d'app en lecture seule ».
 * Crée le champ s'il manque, écrit sur un échantillon de tickets, et dit si le
 * repli (propriété de ticket indexée) est nécessaire.
 */
export async function probeFieldWrite(projectKey: string, sample: number): Promise<Probe> {
  const settings = await projectSettingsOf(projectKey);
  const setup = await ensureDebtCostField(settings.projectKey);
  if (!setup.ok || !setup.fieldId) {
    return {
      name: 'field',
      ok: false,
      measures: { raison: setup.reason ?? 'champ non créé' },
      verdict: 'repli à appliquer : propriété de ticket indexée pour JQL (§17)',
    };
  }
  const page = await searchIssues(`project = ${settings.projectKey} ORDER BY created DESC`, ['summary'], Math.min(sample || DEFAULT_SAMPLE, 50));
  const keys = (page?.issues ?? []).map((issue) => issue.key);
  const values = new Map(keys.map((key, index) => [key, index % 5]));
  const outcome = keys.length > 0 ? await writeDebtCost(keys, values, setup.fieldId) : null;
  return fieldVerdict(setup.fieldId, keys.length, outcome?.updated.length ?? 0, outcome?.failed.length ?? 0, outcome?.reason ?? null);
}

/** Verdict de la sonde d'écriture du champ. */
function fieldVerdict(
  fieldId: string,
  attempted: number,
  updated: number,
  failed: number,
  reason: string | null,
): Probe {
  const ok = attempted > 0 && updated === attempted;
  return {
    name: 'field',
    ok,
    measures: { champId: fieldId, tentes: attempted, ecrits: updated, echoues: failed, raison: reason ?? 'aucune' },
    verdict: ok
      ? `le champ d'app en lecture seule est écrit en masse (${updated}/${attempted}) : il reste triable et filtrable en JQL, aucun repli nécessaire`
      : `écriture partielle ou refusée (${updated}/${attempted}, ${reason ?? 'sans motif'}) : basculer sur la propriété de ticket indexée (§17)`,
  };
}

/**
 * §17 « Compass accessible », « services affectés », « PR dans le graphe ».
 * Le graphe ne s'appelle qu'au nom d'un utilisateur (§15) : hors écran, l'appel
 * échoue et c'est une réponse utile — elle dit si le repli est obligatoire.
 */
export async function probeTeamworkGraph(projectKey: string): Promise<Probe> {
  const settings = await projectSettingsOf(projectKey);
  const page = await searchIssues(`project = ${settings.projectKey} ORDER BY created DESC`, ['summary', 'components'], 5);
  const keys = (page?.issues ?? []).map((issue) => issue.key);
  const zones = await fetchZoneLinks(keys);
  const services = await fetchIncidentServices(keys);
  const componentIds = (page?.issues ?? []).flatMap((issue) => (issue.fields?.components ?? []).map((c) => String(c.id ?? '')));
  const teams = await fetchTeamByComponent(componentIds.filter((id) => id.length > 0));
  return graphVerdict(keys.length, countNonEmpty(zones), countNonEmpty(services), teams.size);
}

/** Verdict de la sonde Teamwork Graph. */
function graphVerdict(keys: number, withZone: number, withServices: number, teams: number): Probe {
  const reached = withZone > 0 || withServices > 0 || teams > 0;
  return {
    name: 'graph',
    ok: true,
    measures: { ticketsInterroges: keys, avecComposantCompass: withZone, avecServiceAffecte: withServices, equipesTrouvees: teams },
    verdict: reached
      ? 'le graphe répond : zones Compass et services exploitables, à lire au nom de l\'utilisateur et à mettre en cache (§15)'
      : 'le graphe ne rend rien (scope manquant ou appel hors contexte utilisateur) : le repli du §17 s\'applique — composants Jira pour les zones, temps en statut de revue pour les PR',
  };
}

/** Compte les entrées non vides d'une carte. */
function countNonEmpty(map: Map<string, string[]>): number {
  let count = 0;
  for (const value of map.values()) if (value.length > 0) count += 1;
  return count;
}

/** Réglages d'un projet, avec un motif clair s'il n'est pas initialisé. */
async function projectSettingsOf(projectKey: string): Promise<ProjectSettings> {
  const { projectIdByKey } = await import('./projects');
  const projectId = await projectIdByKey(projectKey);
  if (!projectId) throw new Error(`projet « ${projectKey} » non initialisé : action=init d'abord`);
  return requireSettings(projectId);
}

/** Un ticket, relu pour vérification ; `null` s'il est illisible. */
export async function probeIssue(key: string): Promise<unknown> {
  return fetchIssue(key);
}
