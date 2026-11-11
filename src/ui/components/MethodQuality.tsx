import { Fragment, Heading, Text } from '@forge/ui';
import type { DataQuality } from '../../core/types.ts';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';
import { familyLabel, formatNumber, formatPercent, pair } from '../format.ts';

/** Qualité des données affichée dans l'onglet Méthode (§14). */
export function MethodQuality({ locale, quality }: { locale: Locale; quality: DataQuality }): JSX.Element {
  return (
    <Fragment>
      <Heading size="small">{t(locale, 'method.quality')}</Heading>
      <Text>{pair(locale, t(locale, 'method.quality.issues'), formatNumber(locale, quality.issuesTotal))}</Text>
      <Text>{pair(locale, t(locale, 'method.quality.withoutZone'), formatNumber(locale, quality.issuesWithoutZone))}</Text>
      <Text>
        {pair(locale, t(locale, 'method.quality.unclassifiedShare'), formatPercent(locale, quality.unclassifiedShare))}
      </Text>
      <Text>{pair(locale, t(locale, 'method.quality.loggedShare'), formatPercent(locale, quality.loggedShare))}</Text>
      <Text>
        {pair(locale, t(locale, 'method.quality.approximated'), formatNumber(locale, quality.approximatedIssues))}
      </Text>
      <Text>{t(locale, 'method.quality.insufficient')}</Text>
      {quality.insufficientFamilies.length === 0 ? (
        <Text>{t(locale, 'method.quality.none')}</Text>
      ) : (
        quality.insufficientFamilies.map((entry) => (
          <Text key={`${entry.zone}:${entry.family}`}>
            {t(locale, 'method.quality.insufficientLine', {
              zone: entry.zone || t(locale, 'common.unclassified'),
              family: familyLabel(locale, entry.family),
            })}
          </Text>
        ))
      )}
    </Fragment>
  );
}
