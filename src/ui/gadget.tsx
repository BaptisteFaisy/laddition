import { useState } from 'react';
import { Button, DashboardGadget, Fragment, Heading, Text, TextField } from './kit';
import { mountScreen } from './mount';
import type { GadgetData } from './api';
import { getGadgetData, getProjectPage } from './api';
import { useResolver } from './async';
import type { ScreenContext } from './context';
import { dataOfPage } from './gadget-data';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { AsyncView } from './components/AsyncView';
import { Disclosure } from './components/Disclosure';
import { FormulaList } from './components/FormulaList';
import { QuarterCostTable, TeamCostTable, TopDebtsTable } from './components/GadgetTables';
import { ProjectLink } from './components/ProjectLink';
import { ScreenShell } from './components/ScreenShell';

/**
 * Écran 5 (§14) : le gadget de tableau de bord — dettes, équipes, trimestres.
 *
 * Le contexte d'un `jira:dashboardGadget` ne fournit pas de projet : l'écran
 * demande donc une clé de projet et le dit explicitement (item D49), et ne lit
 * que les trois lignes qu'il affiche (item D40).
 */
export default function GadgetScreen(): JSX.Element {
  const [chosen, setChosen] = useState('');
  return (
    <DashboardGadget>
      <ScreenShell projectKeyHint={chosen}>
        {(context) => <GadgetContent context={context} chosen={chosen} onChoose={setChosen} />}
      </ScreenShell>
    </DashboardGadget>
  );
}

function GadgetContent({
  context,
  chosen,
  onChoose,
}: {
  context: ScreenContext;
  chosen: string;
  onChoose: (projectKey: string) => void;
}): JSX.Element {
  const projectKey = chosen === '' ? context.projectKey : chosen;
  if (projectKey === '') return <GadgetProjectPicker locale={context.locale} onChoose={onChoose} />;
  return <GadgetData locale={context.locale} projectId={context.projectId} projectKey={projectKey} />;
}

/** Repli explicite : sans projet dans le contexte, on en saisit la clé. */
function GadgetProjectPicker({
  locale,
  onChoose,
}: {
  locale: Locale;
  onChoose: (projectKey: string) => void;
}): JSX.Element {
  const [value, setValue] = useState('');
  const invalid = value.trim() === '';
  return (
    <Fragment>
      <Heading size="small">{t(locale, 'app.title')}</Heading>
      <Text>{t(locale, 'gadget.projectHint')}</Text>
      <TextField
        name="gadgetProjectKey"
        label={t(locale, 'gadget.project')}
        defaultValue=""
        onChange={setValue}
      />
      <Button
        text={t(locale, 'gadget.projectLoad')}
        disabled={invalid}
        onClick={() => onChoose(value.trim())}
      />
      {invalid ? <Text>{t(locale, 'gadget.noProject')}</Text> : null}
    </Fragment>
  );
}

function GadgetData({
  locale,
  projectId,
  projectKey,
}: {
  locale: Locale;
  projectId: string;
  projectKey: string;
}): JSX.Element {
  const resolver = useResolver(`${projectId}#${projectKey}`, () => gadgetDataOf(projectId, projectKey));
  return (
    <AsyncView
      state={resolver.state}
      locale={locale}
      retry={resolver.reload}
      render={(data) => <GadgetBody locale={locale} projectKey={projectKey} data={data} />}
    />
  );
}

/** Les lignes du gadget : la clé réduite d'abord, la page projet en repli. */
async function gadgetDataOf(projectId: string, projectKey: string): Promise<GadgetData> {
  try {
    return await getGadgetData(projectId, projectKey);
  } catch {
    // TODO(integration): retirer ce repli dès que `getGadgetData` est exposé.
    return dataOfPage(await getProjectPage(projectId, projectKey));
  }
}

function GadgetBody({
  locale,
  projectKey,
  data,
}: {
  locale: Locale;
  projectKey: string;
  data: GadgetData;
}): JSX.Element {
  return (
    <Fragment>
      <Heading size="small">{t(locale, 'app.title')}</Heading>
      <ProjectLink projectKey={projectKey} label={t(locale, 'gadget.open')} />
      <TopDebtsTable locale={locale} debts={data.debts} />
      <TeamCostTable locale={locale} rows={data.costByTeam} />
      <QuarterCostTable locale={locale} rows={data.costByQuarter} />
      <Disclosure label={t(locale, 'common.method')} labelOpen={t(locale, 'common.hideFormula')}>
        <FormulaList locale={locale} />
      </Disclosure>
    </Fragment>
  );
}

mountScreen(<GadgetScreen />);
