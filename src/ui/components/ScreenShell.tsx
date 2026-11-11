import { Fragment } from '../kit';
import type { ScreenContext } from '../context';
import { useScreenContext } from '../context';
import type { Locale } from '../i18n/index';
import { DEFAULT_LOCALE } from '../i18n/index';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';

/**
 * Enveloppe commune des six écrans : lit le contexte Forge une fois, affiche
 * chargement ou erreur, puis délègue le rendu à `children`.
 */
export function ScreenShell({
  children,
  locale,
}: {
  children: (context: ScreenContext) => JSX.Element;
  locale?: Locale | undefined;
}): JSX.Element {
  const state = useScreenContext();
  const activeLocale = locale ?? DEFAULT_LOCALE;
  if (state.status === 'loading') return <LoadingState locale={activeLocale} />;
  if (state.status === 'error') return <ErrorState locale={activeLocale} message={state.message} />;
  return <Fragment>{children(state.data)}</Fragment>;
}
