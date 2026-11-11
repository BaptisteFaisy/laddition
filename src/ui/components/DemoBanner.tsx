import { SectionMessage, Text } from '@forge/ui';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';

/** Bandeau permanent dès que `settings.demoData` est vrai (§14). */
export function DemoBanner({ locale, demoData }: { locale: Locale; demoData: boolean }): JSX.Element | null {
  if (!demoData) return null;
  return (
    <SectionMessage appearance="warning" title={t(locale, 'common.demoTitle')}>
      <Text>{t(locale, 'common.demoBody')}</Text>
    </SectionMessage>
  );
}
