import { Button, Fragment, Text } from '../kit';
import { clearSampleData, loadSampleData } from '../api';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { useAction } from '../use-action';
import { ErrorState } from './ErrorState';

/**
 * Jeu d'exemple (DT-13, §22) : l'injecter, puis le retirer.
 *
 * Le bouton de chargement est posé sur les réglages et sur l'état vide du
 * classement (item D47) ; le bouton de retrait n'apparaît que quand le jeu est
 * chargé (item D48). Ni l'un ni l'autre ne touche aux vrais tickets.
 */
export function SampleDataButton({
  locale,
  projectId,
  onLoaded,
  compact = false,
}: {
  locale: Locale;
  projectId: string;
  onLoaded: () => void;
  compact?: boolean;
}): JSX.Element {
  const action = useAction(() => loadSampleData(projectId), onLoaded);
  return (
    <Fragment>
      {compact ? <Text>{t(locale, 'project.sampleEmpty')}</Text> : <Text>{t(locale, 'settings.sampleBody')}</Text>}
      <Button
        text={action.busy ? t(locale, 'settings.sampleLoading') : t(locale, 'settings.sample')}
        disabled={action.busy}
        onClick={action.start}
      />
      {action.done ? <Text>{t(locale, 'settings.sampleDone')}</Text> : null}
      {action.failure ? <ErrorState locale={locale} message={action.failure} /> : null}
    </Fragment>
  );
}

/** Retire le jeu d'exemple : le bandeau disparaît, les vraies données restent. */
export function SampleDataClearButton({
  locale,
  projectId,
  onCleared,
}: {
  locale: Locale;
  projectId: string;
  onCleared: () => void;
}): JSX.Element {
  const action = useAction(() => clearSampleData(projectId), onCleared);
  return (
    <Fragment>
      <Button
        text={action.busy ? t(locale, 'settings.sampleRemoving') : t(locale, 'settings.sampleRemove')}
        disabled={action.busy}
        onClick={action.start}
      />
      {action.done ? <Text>{t(locale, 'settings.sampleRemoved')}</Text> : null}
      {action.failure ? <ErrorState locale={locale} message={action.failure} /> : null}
    </Fragment>
  );
}
