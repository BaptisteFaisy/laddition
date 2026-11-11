import { Fragment, Text } from '@forge/ui';
import type { Family, ProjectSettings, ZoneCost } from '../../core/types.ts';
import { BILLED_FAMILIES } from '../../core/types.ts';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';
import { familyLabel, formatJp, pair } from '../format.ts';

/**
 * La ventilation d'une zone, telle qu'elle sort du calcul : une ligne par
 * famille, chacune avec sa formule. C'est la « méthode » d'un chiffre de zone.
 */
export function ZoneFamilies({
  locale,
  zone,
  settings,
}: {
  locale: Locale;
  zone: ZoneCost;
  settings: ProjectSettings;
}): JSX.Element {
  return (
    <Fragment>
      {BILLED_FAMILIES.map((family) => (
        <Text key={family}>{pair(locale, familyLabel(locale, family), formatJp(locale, familyOf(zone, family)))}</Text>
      ))}
      <Text>{pair(locale, familyLabel(locale, 'C5'), formatJp(locale, zone.byFamily.C5))}</Text>
      <Text>{t(locale, 'family.note.C5')}</Text>
      <Text>{t(locale, 'family.note.C3', { count: settings.minBaselineSample })}</Text>
    </Fragment>
  );
}

function familyOf(zone: ZoneCost, family: Family): number {
  return zone.byFamily[family];
}
