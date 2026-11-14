import { Button, Banner, Text } from '../kit';
import type { Locale } from '../../i18n/index';
import { t } from '../../i18n/index';

/** État d'erreur explicite : ce qui a échoué, et un moyen de réessayer. */
export function ErrorState({
  locale,
  message,
  retry,
}: {
  locale: Locale;
  message: string;
  retry?: (() => void) | undefined;
}): JSX.Element {
  return (
    <Banner appearance="error" title={t(locale, 'common.errorTitle')}>
      <Text>{t(locale, 'common.errorBody')}</Text>
      <Text>{message}</Text>
      {retry ? <Button text={t(locale, 'common.retry')} onClick={retry} /> : null}
    </Banner>
  );
}
