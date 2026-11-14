import type { CostMethod, Family } from '../core/types';
import { jpToEuros } from '../core/units';
import type { Locale, MessageKey } from '../i18n/index';
import { t } from '../i18n/index';

/**
 * Mise en forme des nombres et des dates. Volontairement déterministe :
 * aucun `Intl` implicite, donc le même jeu de données donne le même texte
 * quelle que soit la machine (§18 « Stabilité »).
 */

const METHOD_KEYS: Record<CostMethod, MessageKey> = {
  logged: 'common.method.logged',
  computed: 'common.method.computed',
  approximated: 'common.method.approximated',
};

const FAMILY_KEYS: Record<Family, MessageKey> = {
  C1: 'family.C1',
  C2: 'family.C2',
  C3: 'family.C3',
  C4: 'family.C4',
  C5: 'family.C5',
};

/** Nombre à une décimale, virgule en français. `—` si la valeur manque. */
export function formatNumber(locale: Locale, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return t(locale, 'common.none');
  const rounded = Math.round(value * 10) / 10;
  const text = String(rounded);
  return locale === 'fr' ? text.replace('.', ',') : text;
}

/** Un montant en jours-personne. */
export function formatJp(locale: Locale, value: number | null | undefined): string {
  return formatNumber(locale, value);
}

/**
 * Un montant en jours-personne **avec son unité** (« 62 p-d »).
 *
 * À utiliser partout où le chiffre est lu hors d'un en-tête porteur d'unité :
 * une cellule de tableau, une paire libellé/valeur, une phrase. Sans lui, un
 * coût s'affichait « 62 » — un nombre sans unité ne dit rien (§18). Une valeur
 * absente reste « — » : on n'accole pas une unité à un tiret.
 */
export function formatJpUnit(locale: Locale, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return t(locale, 'common.none');
  return t(locale, 'common.exact', { value: formatJp(locale, value) });
}

/** Une fourchette : un seul chiffre quand les bornes se rejoignent. */
export function formatRange(locale: Locale, lowJp: number, highJp: number): string {
  if (lowJp === highJp) return formatJpUnit(locale, lowJp);
  return t(locale, 'common.range', { low: formatJp(locale, lowJp), high: formatJp(locale, highJp) });
}

/**
 * La fourchette en euros (DT-20, item 65), au taux journalier du projet.
 * Rend `—` quand aucun taux n'est renseigné : on n'invente pas un prix.
 */
export function formatRangeEur(
  locale: Locale,
  lowJp: number,
  highJp: number,
  dayRateEur: number | undefined,
): string {
  const low = jpToEuros(lowJp, dayRateEur);
  const high = jpToEuros(highJp, dayRateEur);
  if (low === null || high === null) return t(locale, 'common.none');
  if (low === high) return t(locale, 'common.eur', { value: formatNumber(locale, low) });
  return t(locale, 'common.eurRange', { low: formatNumber(locale, low), high: formatNumber(locale, high) });
}

/** Une part (0 à 1) en pourcentage. */
export function formatPercent(locale: Locale, ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return t(locale, 'common.none');
  return t(locale, 'common.percent', { value: formatNumber(locale, Math.round(ratio * 1000) / 10) });
}

/**
 * Un pourcentage **déjà calculé** (0-100), comme les parts de `DataQuality`
 * (`src/core/quality.ts` les rend en pourcentage, pas en ratio). `formatPercent`
 * attend, lui, un ratio 0-1 : les mélanger affichait « 147 % » pour 1,47 %.
 */
export function formatPercentValue(locale: Locale, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return t(locale, 'common.none');
  return t(locale, 'common.percent', { value: formatNumber(locale, value) });
}

/** Un rapport (retour sur investissement). */
export function formatRatio(locale: Locale, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return t(locale, 'common.none');
  return t(locale, 'common.ratio', { value: formatNumber(locale, value) });
}

/** Des jours. */
export function formatDays(locale: Locale, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return t(locale, 'common.none');
  return t(locale, 'common.days', { value: formatNumber(locale, value) });
}

/** Une date ISO en `AAAA-MM-JJ` (anglais) ou `JJ/MM/AAAA` (français). */
export function formatDate(locale: Locale, iso: string | null | undefined): string {
  if (!iso) return t(locale, 'common.none');
  const parts = iso.slice(0, 10).split('-');
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (!year || !month || !day) return iso;
  return locale === 'fr' ? `${day}/${month}/${year}` : `${year}-${month}-${day}`;
}

/** Une étiquette et sa valeur, avec la ponctuation de la langue. */
export function pair(locale: Locale, label: string, value: string): string {
  return t(locale, 'common.pair', { label, value });
}

/** Nom lisible d'une méthode de coût. */
export function methodLabel(locale: Locale, method: CostMethod): string {
  return t(locale, METHOD_KEYS[method]);
}

/** Nom lisible d'une famille de coût. */
export function familyLabel(locale: Locale, family: Family): string {
  return t(locale, FAMILY_KEYS[family]);
}
