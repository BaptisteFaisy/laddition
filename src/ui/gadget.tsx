import { DashboardGadget, Fragment, Heading, Text } from '@forge/ui';
import type { ProjectPageData } from './api.ts';
import { getProjectPage } from './api.ts';
import { useResolver } from './async.ts';
import type { ScreenContext } from './context.ts';
import type { Locale } from './i18n/index.ts';
import { t } from './i18n/index.ts';
import { AsyncView } from './components/AsyncView.tsx';
import { DemoBanner } from './components/DemoBanner.tsx';
import { Disclosure } from './components/Disclosure.tsx';
import { QuarterCostTable, TeamCostTable, TopDebtsTable } from './components/GadgetTables.tsx';
import { MethodFormulas } from './components/MethodFormulas.tsx';
import { ScreenShell } from './components/ScreenShell.tsx';

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
