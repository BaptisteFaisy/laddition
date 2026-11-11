import { DashboardGadget, Fragment, Heading, Text } from './kit';
import { mountScreen } from './mount';
import type { ProjectPageData } from './api';
import { getProjectPage } from './api';
import { useResolver } from './async';
import type { ScreenContext } from './context';
import type { Locale } from './i18n/index';
import { t } from './i18n/index';
import { AsyncView } from './components/AsyncView';
import { DemoBanner } from './components/DemoBanner';
import { Disclosure } from './components/Disclosure';
import { QuarterCostTable, TeamCostTable, TopDebtsTable } from './components/GadgetTables';
import { MethodFormulas } from './components/MethodFormulas';
import { ScreenShell } from './components/ScreenShell';

/** Écran 5 (§14) : le gadget de tableau de bord — dettes, équipes, trimestres. */
export default function GadgetScreen(): JSX.Element {
  return (
    <DashboardGadget>
      <ScreenShell>{(context) => <GadgetContent context={context} />}</ScreenShell>
    </DashboardGadget>
  );
}

function GadgetContent({ context }: { context: ScreenContext }): JSX.Element {
  const resolver = useResolver(context.projectId, () => getProjectPage(context.projectId, context.projectKey));
  return (
    <AsyncView
      state={resolver.state}
      locale={context.locale}
      retry={resolver.reload}
      render={(data) => <GadgetBody locale={context.locale} data={data} />}
    />
  );
}

function GadgetBody({ locale, data }: { locale: Locale; data: ProjectPageData }): JSX.Element {
  return (
    <Fragment>
      <Heading size="small">{t(locale, 'gadget.title')}</Heading>
      <DemoBanner locale={locale} demoData={data.settings.demoData} />
      <Text>{t(locale, 'gadget.top')}</Text>
      <TopDebtsTable locale={locale} debts={data.ranking.slice(0, 5)} />
      <Text>{t(locale, 'gadget.team')}</Text>
      <TeamCostTable locale={locale} rows={data.costByTeam} />
      <Text>{t(locale, 'gadget.quarter')}</Text>
      <QuarterCostTable locale={locale} rows={data.costByQuarter} />
      <Disclosure label={t(locale, 'common.method')} labelOpen={t(locale, 'common.hideFormula')}>
        <MethodFormulas locale={locale} settings={data.settings} />
      </Disclosure>
    </Fragment>
  );
}

mountScreen(<GadgetScreen />);
