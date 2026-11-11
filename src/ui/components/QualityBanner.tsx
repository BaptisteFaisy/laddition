import { SectionMessage, Text } from '@forge/ui';
import type { DataQuality } from '../../core/types.ts';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';
import { formatNumber, formatPercent } from '../format.ts';

/**
 * Signal de qualité des données : une part importante de coût non classée
 * fausse le classement, donc elle est dite à voix haute, pas enfouie.
 */
export function QualityBanner({ locale, quality }: { locale: Locale; quality: DataQuality }): JSX.Element | null {
  if (quality.unclassifiedShare < 0.2) return null;
  return (
    <SectionMessage appearance="warning" title={t(locale, 'method.quality')}>
      <Text>{t(locale, 'method.quality.unclassifiedShare')} : {formatPercent(locale, quality.unclassifiedShare)}</Text>
      <Text>{t(locale, 'method.quality.withoutZone')} : {formatNumber(locale, quality.issuesWithoutZone)}</Text>
    </SectionMessage>
  );
}
