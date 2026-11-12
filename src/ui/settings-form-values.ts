import type { DebtRuleKind, ProjectSettings, ZoneMode } from '../core/types';
import type { MessageKey } from './i18n/index';

/** Les valeurs autorisées des deux listes de la règle de dette. */
export const DEBT_RULE_KINDS: readonly DebtRuleKind[] = ['issueType', 'label', 'jql'];
export const ZONE_MODES: readonly ZoneMode[] = ['component', 'compass', 'service', 'label'];

export const KIND_LABELS: Record<DebtRuleKind, MessageKey> = {
  issueType: 'settings.kind.issueType',
  label: 'settings.kind.label',
  jql: 'settings.kind.jql',
};

export const ZONE_MODE_LABELS: Record<ZoneMode, MessageKey> = {
  component: 'settings.zoneMode.component',
  compass: 'settings.zoneMode.compass',
  service: 'settings.zoneMode.service',
  label: 'settings.zoneMode.label',
};

export type NumberField = { name: string; label: MessageKey; value: number };

/** Les nombres réglables : nom du champ et libellé, dans l'ordre affiché. */
const NUMBER_FIELD_DEFS: Array<{ name: string; label: MessageKey }> = [
  { name: 'hoursPerDay', label: 'settings.hoursPerDay' },
  { name: 'daysPerWeek', label: 'settings.daysPerWeek' },
  { name: 'windowDays', label: 'settings.windowDays' },
  { name: 'deadDays', label: 'settings.deadDays' },
  { name: 'occupationCoefficient', label: 'settings.occupationCoefficient' },
  { name: 'persistenceFactor', label: 'settings.persistenceFactor' },
  { name: 'minBaselineSample', label: 'settings.minBaselineSample' },
  { name: 'clipPercentile', label: 'settings.clipPercentile' },
  { name: 'maxIncidentPeople', label: 'settings.maxIncidentPeople' },
  { name: 'postMortemBonusJp', label: 'settings.postMortemBonusJp' },
  { name: 'relevanceFloor', label: 'settings.relevanceFloor' },
  { name: 'phantomThresholdJp', label: 'settings.phantomThresholdJp' },
  { name: 'dayRateEur', label: 'settings.dayRateEur' },
];

/** Les nombres réglables, avec leur valeur en vigueur. */
export function numberFields(settings: ProjectSettings): NumberField[] {
  const values: Record<string, number> = {
    hoursPerDay: settings.hoursPerDay,
    daysPerWeek: settings.daysPerWeek,
    windowDays: settings.windowDays,
    deadDays: settings.deadDays,
    occupationCoefficient: settings.occupationCoefficient,
    persistenceFactor: settings.persistenceFactor,
    minBaselineSample: settings.minBaselineSample,
    clipPercentile: settings.clipPercentile,
    maxIncidentPeople: settings.maxIncidentPeople,
    postMortemBonusJp: settings.postMortemBonusJp,
    relevanceFloor: settings.relevanceFloor,
    phantomThresholdJp: settings.phantomThresholdJp,
    dayRateEur: settings.dayRateEur ?? 0,
  };
  return NUMBER_FIELD_DEFS.map((field) => ({
    name: field.name,
    label: field.label,
    value: values[field.name] ?? 0,
  }));
}

/** Libellé d'un champ du formulaire, pour nommer un refus de saisie. */
export function fieldLabel(name: string): MessageKey {
  const found = NUMBER_FIELD_DEFS.find((field) => field.name === name);
  return found?.label ?? (name === 'debtRuleValue' ? 'settings.debtRuleValue' : 'settings.debtRule');
}

/**
 * Traduit les données du formulaire en réglages partiels. Un champ absent ou
 * illisible devient `NaN` : `mergeSettings` le remplace alors par la valeur
 * en vigueur, jamais par zéro.
 */
export function patchFromForm(data: Record<string, unknown>): Partial<ProjectSettings> {
  return {
    debtRule: { kind: debtRuleKindOf(data['debtRuleKind']), value: readText(data['debtRuleValue']) },
    zoneMode: zoneModeOf(data['zoneMode']),
    zoneLabelField: readText(data['zoneLabelField']),
    hoursPerDay: readNumber(data['hoursPerDay']),
    daysPerWeek: readNumber(data['daysPerWeek']),
    windowDays: readNumber(data['windowDays']),
    deadDays: readNumber(data['deadDays']),
    occupationCoefficient: readNumber(data['occupationCoefficient']),
    persistenceFactor: readNumber(data['persistenceFactor']),
    minBaselineSample: readNumber(data['minBaselineSample']),
    clipPercentile: readNumber(data['clipPercentile']),
    maxIncidentPeople: readNumber(data['maxIncidentPeople']),
    postMortemBonusJp: readNumber(data['postMortemBonusJp']),
    relevanceFloor: readNumber(data['relevanceFloor']),
    phantomThresholdJp: readNumber(data['phantomThresholdJp']),
    jsmProjectKeys: readList(data['jsmProjectKeys']),
    ...optionalPatch(data),
  };
}

/**
 * Les deux réglages optionnels (items 8 et 65) : absents du formulaire, ils
 * restent absents du correctif. Une équipe par zone ou un taux journalier que
 * l'utilisateur n'a pas touchés ne sont donc jamais écrasés par du vide.
 */
function optionalPatch(data: Record<string, unknown>): Partial<ProjectSettings> {
  const patch: Partial<ProjectSettings> = {};
  if ('teamByZone' in data) patch.teamByZone = teamByZoneOf(data['teamByZone']);
  if ('dayRateEur' in data) patch.dayRateEur = readNumber(data['dayRateEur']);
  return patch;
}

/** Bornes des nombres réglables, alignées sur `core/settings.ts`. */
const BOUNDS: Record<string, { min: number; max: number }> = {
  hoursPerDay: { min: 1, max: 24 },
  daysPerWeek: { min: 1, max: 7 },
  windowDays: { min: 7, max: 365 },
  deadDays: { min: 30, max: 730 },
  occupationCoefficient: { min: 0, max: 1 },
  persistenceFactor: { min: 0, max: 1 },
  minBaselineSample: { min: 1, max: 100 },
  clipPercentile: { min: 50, max: 100 },
  maxIncidentPeople: { min: 1, max: 50 },
  postMortemBonusJp: { min: 0, max: 10 },
  relevanceFloor: { min: 0, max: 1 },
  phantomThresholdJp: { min: 0, max: 1000 },
  dayRateEur: { min: 0, max: 100000 },
};

/** Un refus de saisie, nommé pour que l'écran dise quoi corriger (item D59). */
export type FieldProblem =
  | { field: string; kind: 'number' }
  | { field: string; kind: 'range'; min: number; max: number }
  | { field: string; kind: 'required' };

/**
 * Vérifie la saisie **avant** l'envoi : un champ absent n'est pas vérifié, il
 * garde sa valeur en vigueur. Sans cette vérification, l'écran annonçait
 * « Enregistré » alors que la saisie invalide était ignorée (item D59).
 */
export function validatePatch(draft: Record<string, unknown>): FieldProblem[] {
  const problems: FieldProblem[] = [];
  for (const [name, bounds] of Object.entries(BOUNDS)) {
    if (!(name in draft)) continue;
    const value = readNumber(draft[name]);
    if (!Number.isFinite(value)) {
      problems.push({ field: name, kind: 'number' });
    } else if (value < bounds.min || value > bounds.max) {
      problems.push({ field: name, kind: 'range', min: bounds.min, max: bounds.max });
    }
  }
  if ('debtRuleValue' in draft && readText(draft['debtRuleValue']) === '') {
    problems.push({ field: 'debtRuleValue', kind: 'required' });
  }
  return problems;
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value.trim().replace(',', '.'));
  return Number.NaN;
}

function readList(value: unknown): string[] {
  return readText(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * Équipes saisies → équipes par zone (item 8) : `zone=équipe`, une entrée par
 * zone. Une entrée sans `=`, sans zone ou sans équipe est ignorée : on ne
 * devine jamais une équipe (§15).
 */
export function teamByZoneOf(value: unknown): Record<string, string> {
  const found: Record<string, string> = {};
  for (const entry of readList(value)) {
    const at = entry.indexOf('=');
    if (at <= 0) continue;
    const zone = entry.slice(0, at).trim();
    const team = entry.slice(at + 1).trim();
    if (zone !== '' && team !== '') found[zone] = team;
  }
  return found;
}

/** Texte du champ « équipe par zone », à partir des équipes en vigueur. */
export function teamByZoneText(teamByZone: Record<string, string>): string {
  return Object.entries(teamByZone)
    .map(([zone, team]) => `${zone}=${team}`)
    .join(', ');
}

/** Type de règle lu depuis une chaîne : toute valeur inconnue retombe sur `label`. */
export function debtRuleKindOf(value: unknown): DebtRuleKind {
  return DEBT_RULE_KINDS.find((kind) => kind === value) ?? 'label';
}

/** Mode de zone lu depuis une chaîne : toute valeur inconnue retombe sur `component`. */
export function zoneModeOf(value: unknown): ZoneMode {
  return ZONE_MODES.find((mode) => mode === value) ?? 'component';
}
