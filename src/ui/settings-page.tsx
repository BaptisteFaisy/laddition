import { useState } from 'react';
import { Fragment, Heading, ProjectSettingsPage } from './kit';
import { mountScreen } from './mount';
import type { ProjectSettings } from '../core/types';
import { getSettings } from './api';
import { useResolver } from './async';
import type { ScreenContext } from './context';
import { useDemoFlag } from './demo-flag';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { AsyncView } from './components/AsyncView';
import { BootstrapWizard } from './components/BootstrapWizard';
import { SampleDataButton, SampleDataClearButton } from './components/SampleDataButton';
import { ScreenShell } from './components/ScreenShell';
import { SettingsForm } from './components/SettingsForm';

/** Écran 6 (§14) : les réglages qui pilotent tous les calculs. */
export default function SettingsPageScreen(): JSX.Element {
  return (
    <ProjectSettingsPage>
      <ScreenShell>{(context) => <SettingsContent context={context} />}</ScreenShell>
    </ProjectSettingsPage>
  );
}

function SettingsContent({ context }: { context: ScreenContext }): JSX.Element {
  const [refresh, setRefresh] = useState(0);
  const resolver = useResolver(`${context.projectId}#${refresh}`, () => getSettings(context.projectId));
  const reload = () => setRefresh((current) => current + 1);
  return (
    <AsyncView
      state={resolver.state}
      locale={context.locale}
      retry={resolver.reload}
      render={(settings) => (
        <SettingsBody locale={context.locale} projectId={context.projectId} settings={settings} onChanged={reload} />
      )}
    />
  );
}

/**
 * Trois blocs : l'assistant d'initialisation (§22, item D46), les réglages, et
 * le jeu d'exemple avec son bouton de retrait (item D48).
 */
function SettingsBody({
  locale,
  projectId,
  settings,
  onChanged,
}: {
  locale: Locale;
  projectId: string;
  settings: ProjectSettings;
  onChanged: () => void;
}): JSX.Element {
  const demo = useDemoFlag();
  const changed = () => {
    onChanged();
    demo.refresh();
  };
  return (
    <Fragment>
      <Heading size="large">{t(locale, 'settings.title')}</Heading>
      <BootstrapWizard locale={locale} projectId={projectId} settings={settings} onSaved={changed} />
      <Heading size="medium">{t(locale, 'settings.advanced')}</Heading>
      <SettingsForm locale={locale} settings={settings} onSaved={changed} />
      <Heading size="medium">{t(locale, 'settings.sample')}</Heading>
      <SampleDataButton locale={locale} projectId={projectId} onLoaded={changed} />
      {settings.demoData ? (
        <SampleDataClearButton locale={locale} projectId={projectId} onCleared={changed} />
      ) : null}
    </Fragment>
  );
}

mountScreen(<SettingsPageScreen />);
