import { Fragment, Text } from '../kit';
import type { Family } from '../../core/types';
import { BILLED_FAMILIES } from '../../core/types';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { familyLabel, formatJp, pair } from '../format';

/**
 * Le coût d'une zone ou d'une dette fantôme, famille par famille.
 *
 * Une famille non chiffrable affiche « données insuffisantes » au lieu d'un
 * zéro (item D56) : un 0 laisserait croire que la famille a été mesurée.
 */
export function FamilyCostLines({
  locale,
  byFamily,
  insufficientByFamily,
}: {
  locale: Locale;
  byFamily: Record<Family, number>;
  insufficientByFamily?: Partial<Record<Family, boolean>>;
}): JSX.Element {
  const families: readonly Family[] = [...BILLED_FAMILIES, 'C5'];
  return (
    <Fragment>
      {families.map((family) => (
        <Text key={family}>
          {pair(locale, familyLabel(locale, family), costOf(locale, byFamily, insufficientByFamily, family))}
        </Text>
      ))}
    </Fragment>
  );
}

/** Coût d'une famille, ou « données insuffisantes » quand elle n'est pas chiffrable. */
function costOf(
  locale: Locale,
  byFamily: Record<Family, number>,
  insufficientByFamily: Partial<Record<Family, boolean>> | undefined,
  family: Family,
): string {
  if (insufficientByFamily?.[family]) return t(locale, 'common.insufficient');
  return formatJp(locale, byFamily[family]);
}
