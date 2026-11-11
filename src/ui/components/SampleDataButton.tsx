import { Button, Fragment, Text, useState } from '@forge/ui';
import { loadSampleData } from '../api.ts';
import { errorMessage } from '../async.ts';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';
import { ErrorState } from './ErrorState.tsx';

/** DT-13 : injecter le jeu d'exemple, sans jamais toucher aux vrais tickets. */
export function SampleDataButton({
  locale,
  projectId,
  onLoaded,
}: {
  locale: Locale;
  projectId: string;
  onLoaded: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await loadSampleData(projectId);
      setDone(true);
      onLoaded();
    } catch (error) {
      setFailure(errorMessage(error));
    }
    setBusy(false);
  };

  return (
    <Fragment>
      <Text>{t(locale, 'settings.sampleBody')}</Text>
      <Button
        text={busy ? t(locale, 'settings.sampleLoading') : t(locale, 'settings.sample')}
        disabled={busy}
        onClick={load}
      />
      {done ? <Text>{t(locale, 'settings.sampleDone')}</Text> : null}
      {failure ? <ErrorState locale={locale} message={failure} /> : null}
    </Fragment>
  );
}
