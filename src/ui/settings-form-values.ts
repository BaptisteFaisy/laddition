import type { DebtRuleKind, ProjectSettings, ZoneMode } from '../core/types.ts';
import type { MessageKey } from './i18n/index.ts';

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

/** Les douze nombres réglables, dans l'ordre où ils sont affichés. */
export function numberFields(settings: ProjectSettings): NumberField[] {
  return [
    { name: 'hoursPerDay', label: 'settings.hoursPerDay', value: settings.hoursPerDay },
    { name: 'daysPerWeek', label: 'settings.daysPerWeek', value: settings.daysPerWeek },
    { name: 'windowDays', label: 'settings.windowDays', value: settings.windowDays },
    { name: 'deadDays', label: 'settings.deadDays', value: settings.deadDays },
    { name: 'occupationCoefficient', label: 'settings.occupationCoefficient', value: settings.occupationCoefficient },
    { name: 'persistenceFactor', label: 'settings.persistenceFactor', value: settings.persistenceFactor },
    { name: 'minBaselineSample', label: 'settings.minBaselineSample', value: settings.minBaselineSample },
    { name: 'clipPercentile', label: 'settings.clipPercentile', value: settings.clipPercentile },
    { name: 'maxIncidentPeople', label: 'settings.maxIncidentPeople', value: settings.maxIncidentPeople },
    { name: 'postMortemBonusJp', label: 'settings.postMortemBonusJp', value: settings.postMortemBonusJp },
    { name: 'relevanceFloor', label: 'settings.relevanceFloor', value: settings.relevanceFloor },
    { name: 'phantomThresholdJp', label: 'settings.phantomThresholdJp', value: settings.phantomThresholdJp },
  ];
}

/**
 * Traduit les données du formulaire en réglages partiels. Un champ absent ou
 * illisible devient `NaN` : `mergeSettings` le remplace alors par la valeur
 * en vigueur, jamais par zéro.
 */
export function patchFromForm(data: Record<string, unknown>): Partial<ProjectSettings> {
  return {
    debtRule: { kind: readKind(data['debtRuleKind']), value: readText(data['debtRuleValue']) },
    zoneMode: readZoneMode(data['zoneMode']),
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
  };
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

function readKind(value: unknown): DebtRuleKind {
  const found = DEBT_RULE_KINDS.find((kind) => kind === value);
  return found ?? 'label';
}

function readZoneMode(value: unknown): ZoneMode {
  const found = ZONE_MODES.find((mode) => mode === value);
  return found ?? 'component';
}
