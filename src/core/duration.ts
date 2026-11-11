import type { IssueFact, StatusCategory, StatusSpan } from './types';
import { businessDaysBetween, diffDays, parseIso } from './time';

/** Entrée d'historique Jira, réduite à ce qui sert aux durées. */
export interface HistoryEntry {
  created: string;
  /** Nom du champ modifié, tel que rendu par Jira (`status`). */
  field: string;
  /** Statut d'arrivée, quand le champ est `status`. */
  toStatusCategory: StatusCategory | null;
}

/**
 * Reconstitue les séjours d'un ticket dans chaque catégorie de statut (DT-03).
 *
 * Le premier séjour commence à la création, dans la catégorie du statut de
 * création ; chaque changement de statut ferme le séjour courant et en ouvre
 * un nouveau. Le dernier séjour reste ouvert (`endedAt: null`) tant que le
 * ticket n'est pas résolu.
 */
export function reconstructStatusSpans(
  history: HistoryEntry[],
  createdAt: string,
  resolvedAt: string | null,
): StatusSpan[] {
  const changes = history
    .filter((entry) => entry.field === 'status' && entry.toStatusCategory !== null)
    .slice()
    .sort((a, b) => a.created.localeCompare(b.created));

  const spans: StatusSpan[] = [];
  let currentCategory: StatusCategory = 'todo';
  let currentStart = createdAt;

  for (const change of changes) {
    const category = change.toStatusCategory as StatusCategory;
    if (category === currentCategory) continue;
    spans.push({ issueId: '', category: currentCategory, startedAt: currentStart, endedAt: change.created });
    currentCategory = category;
    currentStart = change.created;
  }

  const lastEnd = resolvedAt ?? null;
  spans.push({ issueId: '', category: currentCategory, startedAt: currentStart, endedAt: lastEnd });
  return spans;
}

/** Renseigne l'identifiant de ticket sur chaque séjour. */
export function attachIssueId(spans: StatusSpan[], issueId: string): StatusSpan[] {
  return spans.map((span) => ({ ...span, issueId }));
}

/**
 * Jours ouvrés passés dans une catégorie donnée, bornés par `untilIso`
 * quand un séjour est encore ouvert.
 */
export function activeDays(spans: StatusSpan[], category: StatusCategory, untilIso?: string): number {
  let total = 0;
  for (const span of spans) {
    if (span.category !== category) continue;
    const end = span.endedAt ?? untilIso ?? null;
    total += businessDaysBetween(span.startedAt, end);
  }
  return total;
}

/** Jours ouvrés en statuts actifs, toutes catégories « en cours » confondues. */
export function inProgressDays(spans: StatusSpan[], untilIso?: string): number {
  return activeDays(spans, 'inprogress', untilIso);
}

/**
 * Durée approchée d'un ticket sans historique de statuts (§19) :
 * création → résolution, en jours ouvrés. Le coût qui en découle est marqué
 * « approximé » et signalé comme tel à l'écran.
 */
export function approximateDays(fact: IssueFact, untilIso?: string): number {
  const end = fact.resolvedAt ?? untilIso ?? null;
  return businessDaysBetween(fact.createdAt, end);
}

/** Durée calendaire d'un ticket, en jours (sert à la famille C5, en délai). */
export function calendarDays(fact: IssueFact, untilIso?: string): number {
  const end = fact.resolvedAt ?? untilIso ?? null;
  return Math.max(0, diffDays(fact.createdAt, end));
}

/** Vrai quand le ticket est encore ouvert à l'instant de référence. */
export function isOpen(fact: IssueFact, nowIso: string): boolean {
  if (!fact.resolvedAt) return true;
  const resolved = parseIso(fact.resolvedAt);
  const now = parseIso(nowIso);
  if (!resolved || !now) return true;
  return resolved.getTime() > now.getTime();
}

/** Nombre de réouvertures : séjours revenus en arrière après un « terminé ». */
export function reworkCount(spans: StatusSpan[]): number {
  let reworks = 0;
  for (let index = 1; index < spans.length; index += 1) {
    const previous = spans[index - 1] as StatusSpan;
    const current = spans[index] as StatusSpan;
    if (previous.category === 'done' && current.category !== 'done') reworks += 1;
  }
  return reworks;
}

/** Jours ouvrés passés entre une réouverture et la résolution suivante (C4). */
export function reworkDays(spans: StatusSpan[], untilIso?: string): number {
  let total = 0;
  for (let index = 1; index < spans.length; index += 1) {
    const previous = spans[index - 1] as StatusSpan;
    const current = spans[index] as StatusSpan;
    if (previous.category !== 'done' || current.category === 'done') continue;
    const end = current.endedAt ?? untilIso ?? null;
    total += businessDaysBetween(current.startedAt, end);
  }
  return total;
}
