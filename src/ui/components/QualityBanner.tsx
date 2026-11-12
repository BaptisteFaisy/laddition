import { Banner, Text } from '../kit';
import type { DataQuality } from '../../core/types';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { formatNumber, formatPercentValue, pair } from '../format';

/**
 * Signal de qualité des données : une part importante de coût non classée
 * fausse le classement, donc elle est dite à voix haute, pas enfouie.
 */
export function QualityBanner({ locale, quality }: { locale: Locale; quality: DataQuality }): JSX.Element | null {
  if (quality.unclassifiedShare < 0.2) return null;
  return (
    <Banner appearance="warning" title={t(locale, 'method.quality')}>
      <Text>
        {pair(locale, t(locale, 'method.quality.unclassifiedShare'), formatPercentValue(locale, quality.unclassifiedShare))}
      </Text>
      <Text>
        {pair(locale, t(locale, 'method.quality.withoutZone'), formatNumber(locale, quality.issuesWithoutZone))}
      </Text>
    </Banner>
  );
}
