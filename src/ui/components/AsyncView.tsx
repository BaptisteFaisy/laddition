import { Fragment } from '../kit';
import type { AsyncState } from '../async';
import type { Locale } from '../../i18n/index';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';

export interface AsyncViewProps<T> {
  state: AsyncState<T>;
  locale: Locale;
  retry?: (() => void) | undefined;
  render: (data: T) => JSX.Element;
}

/** Aiguillage unique chargement / erreur / donnée, partagé par tous les écrans. */
export function AsyncView<T>({ state, locale, retry, render }: AsyncViewProps<T>): JSX.Element {
  if (state.status === 'loading') return <LoadingState locale={locale} />;
  if (state.status === 'error') return <ErrorState locale={locale} message={state.message} retry={retry} />;
  return <Fragment>{render(state.data)}</Fragment>;
}
