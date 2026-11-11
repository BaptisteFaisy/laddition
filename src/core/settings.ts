import type { ProjectSettings } from './types.ts';
import { DEFAULT_DAYS_PER_WEEK, DEFAULT_HOURS_PER_DAY } from './time.ts';

/**
 * Réglages par défaut d'un projet (§9, §11, §14).
 * Toutes les valeurs sont modifiables depuis l'écran de réglages du projet ;
 * celles qui entrent dans un calcul sont rappelées dans l'onglet Méthode.
 */
export const DEFAULT_SETTINGS: Omit<ProjectSettings, 'projectId' | 'projectKey'> = {
  debtRule: { kind: 'label', value: 'tech-debt' },
  zoneMode: 'component',
  hoursPerDay: DEFAULT_HOURS_PER_DAY,
  daysPerWeek: DEFAULT_DAYS_PER_WEEK,
  windowDays: 90,
  deadDays: 180,
  occupationCoefficient: 0.5,
  persistenceFactor: 0.7,
  minBaselineSample: 5,
  clipPercentile: 95,
  maxIncidentPeople: 6,
  postMortemBonusJp: 0.5,
  relevanceFloor: 0.3,
  phantomThresholdJp: 10,
  jsmProjectKeys: [],
  teamByZone: {},
  demoData: false,
};

/** Construit les réglages complets d'un projet, en partant des défauts. */
export function makeSettings(
  projectId: string,
  projectKey: string,
  overrides: Partial<ProjectSettings> = {},
): ProjectSettings {
  return { ...DEFAULT_SETTINGS, projectId, projectKey, ...overrides };
}

/**
 * Fusionne des réglages partiels (venus de la base ou d'un formulaire) avec
 * les défauts. Les valeurs numériques sont bornées pour qu'un réglage absurde
 * ne casse jamais un calcul.
 */
export function mergeSettings(base: ProjectSettings, patch: Partial<ProjectSettings>): ProjectSettings {
  const merged: ProjectSettings = { ...base, ...patch };
  merged.hoursPerDay = boundNumber(merged.hoursPerDay, 1, 24, base.hoursPerDay);
  merged.daysPerWeek = boundNumber(merged.daysPerWeek, 1, 7, base.daysPerWeek);
  merged.windowDays = boundNumber(merged.windowDays, 7, 365, base.windowDays);
  merged.deadDays = boundNumber(merged.deadDays, 30, 730, base.deadDays);
  merged.occupationCoefficient = boundNumber(merged.occupationCoefficient, 0, 1, base.occupationCoefficient);
  merged.persistenceFactor = boundNumber(merged.persistenceFactor, 0, 1, base.persistenceFactor);
  merged.minBaselineSample = boundNumber(merged.minBaselineSample, 1, 100, base.minBaselineSample);
  merged.clipPercentile = boundNumber(merged.clipPercentile, 50, 100, base.clipPercentile);
  merged.maxIncidentPeople = boundNumber(merged.maxIncidentPeople, 1, 50, base.maxIncidentPeople);
  merged.postMortemBonusJp = boundNumber(merged.postMortemBonusJp, 0, 10, base.postMortemBonusJp);
  merged.relevanceFloor = boundNumber(merged.relevanceFloor, 0, 1, base.relevanceFloor);
  merged.phantomThresholdJp = boundNumber(merged.phantomThresholdJp, 0, 1000, base.phantomThresholdJp);
  return merged;
}

/** Nombre borné ; toute valeur non finie retombe sur le défaut. */
function boundNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
