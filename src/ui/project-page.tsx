import { useState } from 'react';
import { Fragment, Heading, ProjectPage, TabEntry, Tabs, Text } from './kit';
import { mountScreen } from './mount';
import type { ProjectPageData } from './api';
import { getProjectPage } from './api';
import { useResolver } from './async';
import type { ScreenContext } from './context';
import { formatNumber } from './format';
import type { Locale } from './i18n/index';
import { t } from './i18n/index';
import { AsyncView } from './components/AsyncView';
import { BillView } from './components/BillView';
import { DeadTab } from './components/DeadTab';
import { DemoBanner } from './components/DemoBanner';
import { MethodTab } from './components/MethodTab';
import { PhantomTab } from './components/PhantomTab';
import { QualityBanner } from './components/QualityBanner';
import { RankingTable } from './components/RankingTable';
import { RepaymentTab } from './components/RepaymentTab';
import { ScreenShell } from './components/ScreenShell';
import { ZoneTab } from './components/ZoneTab';

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
    <Tabs id="laddition-tabs">
      <TabEntry label={t(locale, 'project.tab.zones')}>
        <ZoneTab locale={locale} zones={data.zones} settings={data.settings} />
      </TabEntry>
      <TabEntry label={t(locale, 'project.tab.phantom')}>
        <PhantomTab
          locale={locale}
          projectId={context.projectId}
          projectKey={context.projectKey}
          thresholdJp={data.settings.phantomThresholdJp}
        />
      </TabEntry>
      <TabEntry label={t(locale, 'project.tab.dead')}>
        <DeadTab locale={locale} projectId={context.projectId} deadDays={data.settings.deadDays} />
      </TabEntry>
      <TabEntry label={t(locale, 'project.tab.repayments')}>
        <RepaymentTab locale={locale} projectId={context.projectId} />
      </TabEntry>
      <TabEntry label={t(locale, 'project.tab.method')}>
        <MethodTab locale={locale} settings={data.settings} quality={data.quality} />
      </TabEntry>
    </Tabs>
  );
}

mountScreen(<ProjectPageScreen />);
