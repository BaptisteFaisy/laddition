/**
 * Dette morte (DT-09, §7.3).
 *
 * Un ticket de dette que plus aucune preuve ne vient alimenter n'est plus une
 * dette qui coûte : c'est un ticket qui dort. On le signale pour qu'il soit
 * rouvert, requalifié ou fermé — jamais pour le retirer du classement en
 * silence.
 *
 * Choix de comptage : `businessDaysBetween` est l'unité du domaine pour les
 * durées de travail, mais la séniorité d'un ticket dormant est une affaire de
 * calendrier — six mois d'oubli restent six mois, week-ends compris. On utilise
 * donc `diffDays` (jours calendaires) : c'est aussi ce qui rend le seuil
 * `deadDays` lisible tel quel dans les réglages (§9).
 */

import type { Attribution, DeadDebt, Evidence, IssueFact, ProjectSettings } from './types.ts';
import { diffDays } from './time.ts';
import { UNCLASSIFIED_ZONE, zonesForIssue } from './zones.ts';

/**
 * Tickets de dette sans preuve récente.
 *
 * Un ticket jamais alimenté n'a pas de `lastEvidenceAt` : on compte alors
 * depuis sa création, ce qui revient à dire « jamais justifié ».
 * Tri : jours sans preuve décroissant, puis clé alphabétique.
 */
export function findDeadDebt(
  debts: IssueFact[],
  evidence: Evidence[],
  attributions: Attribution[],
  settings: ProjectSettings,
  now: string,
): DeadDebt[] {
  const byId = indexEvidence(evidence);
  const lastByDebt = lastEvidenceDates(attributions, byId);
  const dead: DeadDebt[] = [];
  for (const debt of debts) {
    if (!debt.isDebt) continue;
    const lastEvidenceAt = lastByDebt.get(debt.issueId) ?? null;
    const days = elapsedCalendarDays(lastEvidenceAt ?? debt.createdAt, now);
    if (days <= settings.deadDays) continue;
    dead.push({
      debtIssueId: debt.issueId,
      key: debt.key,
      summary: debt.summary,
      zone: primaryZone(debt, settings),
      daysWithoutEvidence: days,
      lastEvidenceAt,
    });
  }
  return dead.sort(compareDead);
}

/** Preuves indexées par identifiant, pour retrouver leur date. */
function indexEvidence(evidence: Evidence[]): Map<string, Evidence> {
  const byId = new Map<string, Evidence>();
  for (const item of evidence) byId.set(item.id, item);
  return byId;
}

/**
 * Date de la preuve la plus récente de chaque ticket de dette.
 * Une attribution de part nulle ne compte pas : elle ne pèse sur rien.
 */
function lastEvidenceDates(
  attributions: Attribution[],
  byId: Map<string, Evidence>,
): Map<string, string> {
  const last = new Map<string, string>();
  for (const attribution of attributions) {
    if (!(attribution.share > 0)) continue;
    const item = byId.get(attribution.evidenceId);
    if (!item) continue;
    const known = last.get(attribution.debtIssueId);
    if (known === undefined || item.occurredAt > known) {
      last.set(attribution.debtIssueId, item.occurredAt);
    }
  }
  return last;
}

/** Jours calendaires écoulés, arrondis au jour, jamais négatifs. */
function elapsedCalendarDays(from: string, now: string): number {
  return Math.round(diffDays(from, now));
}

/** Zone d'affichage du ticket : la première retenue par le §8. */
function primaryZone(debt: IssueFact, settings: ProjectSettings): string {
  return zonesForIssue(debt, settings)[0] ?? UNCLASSIFIED_ZONE;
}

/** Jours sans preuve décroissant, puis clé alphabétique. */
function compareDead(a: DeadDebt, b: DeadDebt): number {
  if (b.daysWithoutEvidence !== a.daysWithoutEvidence) {
    return b.daysWithoutEvidence - a.daysWithoutEvidence;
  }
  return a.key.localeCompare(b.key);
}
