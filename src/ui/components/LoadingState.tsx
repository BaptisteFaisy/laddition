import { Banner, Text } from '../kit';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';

/** État de chargement : jamais une page blanche (§14). */
export function LoadingState({ locale }: { locale: Locale }): JSX.Element {
  return (
    <Banner appearance="information" title={t(locale, 'common.loadingTitle')}>
      <Text>{t(locale, 'common.loading')}</Text>
    </Banner>
  );
}
