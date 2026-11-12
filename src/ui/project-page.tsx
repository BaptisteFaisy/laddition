import { useState } from 'react';
import { Fragment, Heading, ProjectPage, TabEntry, Tabs, Text } from './kit';
import { mountScreen } from './mount';
import type { ProjectPageData } from './api';
import { getProjectPage } from './api';
import { useResolver } from './async';
import type { ScreenContext } from './context';
import { useDemoFlag } from './demo-flag';
import { formatNumber } from './format';
import type { Locale } from './i18n/index';
import { t } from './i18n/index';
import { AsyncView } from './components/AsyncView';
import { BillView } from './components/BillView';
import { CaseButton } from './components/CaseButton';
import { DeadTab } from './components/DeadTab';
import { MethodTab } from './components/MethodTab';
import { PhantomTab } from './components/PhantomTab';
import { QualityBanner } from './components/QualityBanner';
import { RankingTable } from './components/RankingTable';
import { RepaymentTab } from './components/RepaymentTab';
import { SampleDataButton } from './components/SampleDataButton';
import { ScreenShell } from './components/ScreenShell';
import { SimulationPane } from './components/SimulationPane';
import { ZoneTab } from './components/ZoneTab';
import type { RankedDebt } from '../core/types';

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
      render={(data) => <ProjectPageBody context={context} data={data} reload={resolver.reload} />}
    />
  );
}

function ProjectPageBody({
  context,
  data,
  reload,
}: {
  context: ScreenContext;
  data: ProjectPageData;
  reload: () => void;
}): JSX.Element {
  const locale = context.locale;
  const demo = useDemoFlag();
  const [selected, setSelected] = useState<string | null>(null);
  const loaded = () => {
    demo.refresh();
    reload();
  };
  return (
    <Fragment>
      <Heading size="large">{t(locale, 'project.title', { project: context.projectKey })}</Heading>
      <Text>{t(locale, 'app.tagline')}</Text>
      <QualityBanner locale={locale} quality={data.quality} />
      <Heading size="medium">{t(locale, 'project.rankingTitle')}</Heading>
      <Text>{t(locale, 'project.rankingBody', { days: formatNumber(locale, data.settings.windowDays) })}</Text>
      <RankingTable
        locale={locale}
        ranking={data.ranking}
        selectedId={selected}
        onSelect={setSelected}
        emptyAction={emptyAction(locale, context.projectId, data.settings.demoData, loaded)}
      />
      {selected === null ? <Text>{t(locale, 'project.selectHint')}</Text> : null}
      {selected ? <SelectedDebt locale={locale} debtIssueId={selected} ranking={data.ranking} /> : null}
      <ProjectTabs context={context} data={data} />
    </Fragment>
  );
}

/**
 * Une dette ouverte : son addition, puis son argumentaire à la demande (DT-17).
 * L'argumentaire appelle le modèle : il n'est jamais chargé sans un clic.
 */
function SelectedDebt({
  locale,
  debtIssueId,
  ranking,
}: {
  locale: Locale;
  debtIssueId: string;
  ranking: readonly RankedDebt[];
}): JSX.Element {
  const key = ranking.find((debt) => debt.debtIssueId === debtIssueId)?.key ?? null;
  return (
    <Fragment>
      <BillView locale={locale} debtIssueId={debtIssueId} />
      <CaseButton locale={locale} issueKey={key} />
    </Fragment>
  );
}

/** Sur un classement vide, le jeu d'exemple est à un clic (item D47, docs/JUGES.md). */
function emptyAction(locale: Locale, projectId: string, demoData: boolean, onLoaded: () => void): JSX.Element | null {
  if (demoData) return null;
  return <SampleDataButton locale={locale} projectId={projectId} onLoaded={onLoaded} compact />;
}

function ProjectTabs({ context, data }: { context: ScreenContext; data: ProjectPageData }): JSX.Element {
  const locale = context.locale;
  return (
    <Tabs id="laddition-tabs">
      <TabEntry label={t(locale, 'project.tab.zones')}>
        <ZoneTab
          locale={locale}
          projectId={context.projectId}
          zones={data.zones}
          ranking={data.ranking}
          settings={data.settings}
        />
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
      <TabEntry label={t(locale, 'project.tab.simulation')}>
        <SimulationPane locale={locale} projectId={context.projectId} ranking={data.ranking} />
      </TabEntry>
      <TabEntry label={t(locale, 'project.tab.method')}>
        <MethodTab locale={locale} settings={data.settings} quality={data.quality} />
      </TabEntry>
    </Tabs>
  );
}

mountScreen(<ProjectPageScreen />);
