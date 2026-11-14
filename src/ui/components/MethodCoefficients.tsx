import { Fragment, Heading, Text } from '../kit';
import type { ProjectSettings } from '../../core/types';
import type { Locale, MessageKey } from '../../i18n/index';
import { t } from '../../i18n/index';
import { formatNumber } from '../format';

/** Les coefficients réellement appliqués au dernier calcul. */
export function MethodCoefficients({
  locale,
  settings,
}: {
  locale: Locale;
  settings: ProjectSettings;
}): JSX.Element {
  const lines: Array<{ label: MessageKey; value: string }> = [
    { label: 'settings.hoursPerDay', value: formatNumber(locale, settings.hoursPerDay) },
    { label: 'settings.daysPerWeek', value: formatNumber(locale, settings.daysPerWeek) },
    { label: 'settings.windowDays', value: formatNumber(locale, settings.windowDays) },
    { label: 'settings.deadDays', value: formatNumber(locale, settings.deadDays) },
    { label: 'settings.occupationCoefficient', value: formatNumber(locale, settings.occupationCoefficient) },
    { label: 'settings.persistenceFactor', value: formatNumber(locale, settings.persistenceFactor) },
    { label: 'settings.minBaselineSample', value: formatNumber(locale, settings.minBaselineSample) },
    { label: 'settings.clipPercentile', value: formatNumber(locale, settings.clipPercentile) },
    { label: 'settings.maxIncidentPeople', value: formatNumber(locale, settings.maxIncidentPeople) },
    { label: 'settings.postMortemBonusJp', value: formatNumber(locale, settings.postMortemBonusJp) },
    { label: 'settings.relevanceFloor', value: formatNumber(locale, settings.relevanceFloor) },
    { label: 'settings.phantomThresholdJp', value: formatNumber(locale, settings.phantomThresholdJp) },
  ];
  return (
    <Fragment>
      <Heading size="small">{t(locale, 'method.coefficients')}</Heading>
      {lines.map((line) => (
        <Text key={line.label}>
          {t(locale, 'method.coefficientLine', { name: t(locale, line.label), value: line.value })}
        </Text>
      ))}
    </Fragment>
  );
}
