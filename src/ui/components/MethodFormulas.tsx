import { Fragment, Heading, Text } from '@forge/ui';
import type { ProjectSettings } from '../../core/types.ts';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';
import { familyLabel, formatNumber, pair } from '../format.ts';

/** Les cinq formules, écrites telles quelles, avec les coefficients en vigueur. */
export function MethodFormulas({ locale, settings }: { locale: Locale; settings: ProjectSettings }): JSX.Element {
  return (
    <Fragment>
      <Heading size="small">{t(locale, 'method.formulas')}</Heading>
      <Text>
        {pair(
          locale,
          familyLabel(locale, 'C1'),
          t(locale, 'method.formula.C1', {
            people: formatNumber(locale, settings.maxIncidentPeople),
            bonus: formatNumber(locale, settings.postMortemBonusJp),
          }),
        )}
      </Text>
      <Text>{pair(locale, familyLabel(locale, 'C2'), t(locale, 'method.formula.C2'))}</Text>
      <Text>
        {pair(
          locale,
          familyLabel(locale, 'C3'),
          t(locale, 'method.formula.C3', { coefficient: formatNumber(locale, settings.occupationCoefficient) }),
        )}
      </Text>
      <Text>{t(locale, 'family.note.C3', { count: formatNumber(locale, settings.minBaselineSample) })}</Text>
      <Text>{pair(locale, familyLabel(locale, 'C4'), t(locale, 'method.formula.C4'))}</Text>
      <Text>{pair(locale, familyLabel(locale, 'C5'), t(locale, 'method.formula.C5'))}</Text>
      <Text>{t(locale, 'family.note.C5')}</Text>
    </Fragment>
  );
}
