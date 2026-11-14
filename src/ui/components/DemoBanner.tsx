import { Banner, Text } from '../kit';
import type { Locale } from '../../i18n/index';
import { t } from '../../i18n/index';

/** Bandeau permanent dès que `settings.demoData` est vrai (§14). */
export function DemoBanner({ locale, demoData }: { locale: Locale; demoData: boolean }): JSX.Element | null {
  if (!demoData) return null;
  return (
    <Banner appearance="warning" title={t(locale, 'common.demoTitle')}>
      <Text>{t(locale, 'common.demoBody')}</Text>
    </Banner>
  );
}
