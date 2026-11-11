import { Fragment } from '@forge/ui';
import type { ScreenContext } from '../context.ts';
import { useScreenContext } from '../context.ts';
import type { Locale } from '../i18n/index.ts';
import { DEFAULT_LOCALE } from '../i18n/index.ts';
import { ErrorState } from './ErrorState.tsx';
import { LoadingState } from './LoadingState.tsx';

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
