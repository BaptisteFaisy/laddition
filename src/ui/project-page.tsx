import { Fragment, Heading, ProjectPage, Tab, Tabs, Text, useState } from '@forge/ui';
import type { ProjectPageData } from './api.ts';
import { getProjectPage } from './api.ts';
import { useResolver } from './async.ts';
import type { ScreenContext } from './context.ts';
import { formatNumber } from './format.ts';
import type { Locale } from './i18n/index.ts';
import { t } from './i18n/index.ts';
import { AsyncView } from './components/AsyncView.tsx';
import { BillView } from './components/BillView.tsx';
import { DeadTab } from './components/DeadTab.tsx';
import { DemoBanner } from './components/DemoBanner.tsx';
import { MethodTab } from './components/MethodTab.tsx';
import { PhantomTab } from './components/PhantomTab.tsx';
import { QualityBanner } from './components/QualityBanner.tsx';
import { RankingTable } from './components/RankingTable.tsx';
import { RepaymentTab } from './components/RepaymentTab.tsx';
import { ScreenShell } from './components/ScreenShell.tsx';
import { ZoneTab } from './components/ZoneTab.tsx';

/** Écran 1 (§14) : le classement, puis les cinq onglets du projet. */
export default function ProjectPageScreen(): JSX.Element {
  return (
    <ProjectPage>
      <ScreenShell>{(context) => <ProjectPageContent context={context} />}</ScreenShell>
    </ProjectPage>
  );
}

function ProjectPageContent({ context }: { context: ScreenContext }): JSX.Element {
  const resolver = useResolver(context.projectId, () => getProjectPage(context.projectId, context.projectKey));
  return (
    <AsyncView
      state={resolver.state}
      locale={context.locale}
      retry={resolver.reload}
      render={(data) => <ProjectPageBody context={context} data={data} />}
    />
  );
}

function ProjectPageBody({ context, data }: { context: ScreenContext; data: ProjectPageData }): JSX.Element {
  const locale = context.locale;
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <Fragment>
      <Heading size="large">{t(locale, 'project.title', { project: context.projectKey })}</Heading>
      <Text>{t(locale, 'app.tagline')}</Text>
      <DemoBanner locale={locale} demoData={data.settings.demoData} />
      <QualityBanner locale={locale} quality={data.quality} />
      <Heading size="medium">{t(locale, 'project.rankingTitle')}</Heading>
      <Text>{t(locale, 'project.rankingBody', { days: formatNumber(locale, data.settings.windowDays) })}</Text>
      <RankingTable locale={locale} ranking={data.ranking} selectedId={selected} onSelect={setSelected} />
      {selected === null ? <Text>{t(locale, 'project.selectHint')}</Text> : null}
      {selected ? <BillView locale={locale} debtIssueId={selected} /> : null}
      <ProjectTabs context={context} data={data} />
    </Fragment>
  );
}

function ProjectTabs({ context, data }: { context: ScreenContext; data: ProjectPageData }): JSX.Element {
  const locale = context.locale;
  return (
    <Tabs>
      <Tab label={t(locale, 'project.tab.zones')}>
        <ZoneTab locale={locale} zones={data.zones} settings={data.settings} />
      </Tab>
      <Tab label={t(locale, 'project.tab.phantom')}>
        <PhantomTab
          locale={locale}
          projectId={context.projectId}
          projectKey={context.projectKey}
          thresholdJp={data.settings.phantomThresholdJp}
        />
      </Tab>
      <Tab label={t(locale, 'project.tab.dead')}>
        <DeadTab locale={locale} projectId={context.projectId} deadDays={data.settings.deadDays} />
      </Tab>
      <Tab label={t(locale, 'project.tab.repayments')}>
        <RepaymentTab locale={locale} projectId={context.projectId} />
      </Tab>
      <Tab label={t(locale, 'project.tab.method')}>
        <MethodTab locale={locale} settings={data.settings} quality={data.quality} />
      </Tab>
    </Tabs>
  );
}
