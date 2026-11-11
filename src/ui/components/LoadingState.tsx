import { SectionMessage, Text } from '@forge/ui';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';

/** État de chargement : jamais une page blanche (§14). */
export function LoadingState({ locale }: { locale: Locale }): JSX.Element {
  return (
    <SectionMessage appearance="info" title={t(locale, 'common.loadingTitle')}>
      <Text>{t(locale, 'common.loading')}</Text>
    </SectionMessage>
  );
}
