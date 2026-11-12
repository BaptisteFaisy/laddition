import type { Family } from '../core/types';
import {
  CAVEAT_COMPARISON,
  CAVEAT_INSUFFICIENT_RECUL,
  CAVEAT_OTHER_CHANGES,
} from '../core/repayment';
import { UNKNOWN_TEAM } from '../resolvers/aggregate';
import type { Locale, MessageKey } from './i18n/index';
import { t } from './i18n/index';

/**
 * Chaînes produites par le domaine en français (formules, limites du bulletin,
 * équipe inconnue) : elles traversent l'UI anglaise telles quelles (item D54).
 *
 * Sans toucher au domaine, ce module les traduit à l'affichage quand la chaîne
 * est reconnue, et rend la chaîne brute sinon. Ce qui reste à traduire **à la
 * source** est signalé dans le rapport du lot.
 */

/** Préfixe de la limite d'échantillon (`src/core/repayment.ts`, non exporté). */
const SAMPLE_CAVEAT_PREFIX = 'échantillon de ';

/** Formule i18n d'une famille, sans les coefficients (ils sont dans les entrées). */
const FORMULA_KEYS: Record<Family, MessageKey> = {
  C1: 'evidence.formula.C1',
  C2: 'evidence.formula.C2',
  C3: 'evidence.formula.C3',
  C4: 'evidence.formula.C4',
  C5: 'evidence.formula.C5',
};

/** Noms d'entrées écrits par le domaine, traduits à l'affichage. */
const INPUT_KEYS: Record<string, MessageKey> = {
  durationDays: 'input.durationDays',
  participants: 'input.participants',
  maxParticipants: 'input.maxParticipants',
  postMortem: 'input.postMortem',
  loggedSeconds: 'input.loggedSeconds',
  enCours: 'input.enCours',
  persons: 'input.persons',
  statusHistory: 'input.statusHistory',
  duree: 'input.duree',
  reference: 'input.reference',
  echantillon: 'input.echantillon',
  coefficient: 'input.coefficient',
  centile: 'input.centile',
  reouvertures: 'input.reouvertures',
  joursReprise: 'input.joursReprise',
  delai: 'input.delai',
  joursBloques: 'input.joursBloques',
  ticketBloquant: 'input.ticketBloquant',
};

/** Formule d'une famille, dans la langue de l'écran. */
export function formulaOf(locale: Locale, family: Family): string {
  return t(locale, FORMULA_KEYS[family]);
}

/** Nom d'une entrée de formule, dans la langue de l'écran (sinon le nom brut). */
export function inputLabel(locale: Locale, name: string): string {
  const key = INPUT_KEYS[name];
  return key ? t(locale, key) : name;
}

/** Valeur d'une entrée de formule, mise en forme sans chaîne française. */
export function inputValue(locale: Locale, value: number | string | boolean | null): string {
  if (value === null) return t(locale, 'common.none');
  if (typeof value === 'boolean') return t(locale, value ? 'common.yes' : 'common.no');
  return String(value);
}

/**
 * Limite d'un bulletin de remboursement, traduite quand elle est reconnue.
 * Une limite inconnue est rendue telle quelle : mieux vaut du français que du
 * silence sur ce qui borne le chiffre (§18).
 */
export function caveatLabel(locale: Locale, caveat: string): string {
  if (caveat === CAVEAT_COMPARISON) return t(locale, 'caveat.comparison');
  if (caveat === CAVEAT_OTHER_CHANGES) return t(locale, 'caveat.otherChanges');
  if (caveat === CAVEAT_INSUFFICIENT_RECUL) return t(locale, 'caveat.insufficientWindow');
  if (caveat.startsWith(SAMPLE_CAVEAT_PREFIX)) {
    return t(locale, 'caveat.sample', { weeks: caveat.slice(SAMPLE_CAVEAT_PREFIX.length) });
  }
  return caveat;
}

/** Libellé d'équipe : le domaine écrit « équipe non renseignée » en français. */
export function teamLabel(locale: Locale, team: string | undefined): string {
  if (!team || team === UNKNOWN_TEAM) return t(locale, 'zones.noTeam');
  return team;
}
