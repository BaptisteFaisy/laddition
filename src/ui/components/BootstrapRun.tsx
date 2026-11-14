import { useState } from 'react';
import { Button, Fragment, Heading, ProgressBar, Text } from '../kit';
import type { BootstrapProgress } from '../../core/types';
import { startBootstrap } from '../api';
import type { Locale } from '../../i18n/index';
import { t } from '../../i18n/index';
import { formatNumber } from '../format';
import { useAction } from '../use-action';
import { useBootstrapProgress } from '../use-bootstrap-progress';
import { ErrorState } from './ErrorState';

/**
 * Étape 3 de l'assistant : lancer l'initialisation et la regarder avancer
 * (DT-12, item D46). La barre lit `bootstrapProgress` ; le bouton écrit
 * `startBootstrap`.
 */
export function BootstrapRun({
  locale,
  projectId,
  onBack,
}: {
  locale: Locale;
  projectId: string;
  onBack: () => void;
}): JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const state = useBootstrapProgress(projectId, attempt);
  const action = useAction(async () => {
    state.setFailure(null);
    state.setProgress(await startBootstrap(projectId));
    setAttempt((current) => current + 1);
  });
  const progress = state.progress;

  return (
    <Fragment>
      <Heading size="small">{t(locale, 'setup.step3')}</Heading>
      <Text>{progress === null ? t(locale, 'setup.idle') : statusText(locale, progress)}</Text>
      {progress && !progress.finished ? (
        <ProgressBar value={percentOf(progress)} ariaLabel={t(locale, 'setup.progressLabel')} />
      ) : null}
      {progress && progress.failed > 0 ? (
        <Text>{t(locale, 'setup.failedCount', { count: formatNumber(locale, progress.failed) })}</Text>
      ) : null}
      {progress?.error ? <Text>{t(locale, 'setup.failed', { error: progress.error })}</Text> : null}
      {state.failure ? <ErrorState locale={locale} message={state.failure} /> : null}
      <Button
        text={action.busy ? t(locale, 'setup.starting') : t(locale, 'setup.start')}
        disabled={action.busy}
        onClick={action.start}
      />
      <Button appearance="subtle" text={t(locale, 'setup.back')} onClick={onBack} />
    </Fragment>
  );
}

/** Phrase d'état de l'initialisation, dans la langue de l'écran. */
function statusText(locale: Locale, progress: BootstrapProgress): string {
  if (progress.finished) {
    return t(locale, 'setup.finished', { total: formatNumber(locale, progress.total) });
  }
  return t(locale, 'setup.progress', {
    done: formatNumber(locale, progress.done),
    total: formatNumber(locale, progress.total),
  });
}

/** Avancement en pourcentage, pour la barre de progression. */
function percentOf(progress: BootstrapProgress): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.round((progress.done / progress.total) * 100));
}
