import { Fragment, Heading, ProjectSettingsPage, useState } from '@forge/ui';
import type { ProjectSettings } from '../core/types.ts';
import { getSettings } from './api.ts';
import { useResolver } from './async.ts';
import type { ScreenContext } from './context.ts';
import type { Locale } from './i18n/index.ts';
import { t } from './i18n/index.ts';
import { AsyncView } from './components/AsyncView.tsx';
import { DemoBanner } from './components/DemoBanner.tsx';
import { SampleDataButton } from './components/SampleDataButton.tsx';
import { ScreenShell } from './components/ScreenShell.tsx';
import { SettingsForm } from './components/SettingsForm.tsx';

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
  const reload = () => setRefresh(refresh + 1);
  return (
    <AsyncView
      state={resolver.state}
      locale={context.locale}
      retry={resolver.reload}
      render={(settings) => <SettingsBody locale={context.locale} projectId={context.projectId} settings={settings} onChanged={reload} />}
    />
  );
}

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
  return (
    <Fragment>
      <Heading size="large">{t(locale, 'settings.title')}</Heading>
      <DemoBanner locale={locale} demoData={settings.demoData} />
      <SettingsForm locale={locale} settings={settings} onSaved={onChanged} />
      <Heading size="medium">{t(locale, 'settings.sample')}</Heading>
      <SampleDataButton locale={locale} projectId={projectId} onLoaded={onChanged} />
    </Fragment>
  );
}
