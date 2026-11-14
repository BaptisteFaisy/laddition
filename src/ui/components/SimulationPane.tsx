import { useState } from 'react';
import type { RankedDebt } from '../../core/types';
import type { SimulationResult } from '../../core/simulation';
import { MAX_SIMULATED_DEBTS } from '../../core/simulation';
import { simulateRepayment } from '../api';
import { formatRange } from '../format';
import type { Locale } from '../../i18n/index';
import { t } from '../../i18n/index';
import { Button, Cell, Fragment, Head, markTableRow, Row, Stack, Table, Text } from '../kit';
import { useAction } from '../use-action';
import { ErrorState } from './ErrorState';
import { SimulationTab } from './SimulationTab';
import { TicketLink } from './TicketLink';

/** Dettes cochées à l'ouverture : les plus coûteuses du classement. */
const PICKED_BY_DEFAULT = 3;

/**
 * Onglet « Simulation » (DT-21, item 66) : choisir des dettes, lancer le
 * calcul, lire la capacité retrouvée.
 *
 * Rien n'est écrit nulle part et rien n'est recalculé : le résolveur
 * `simulateRepayment` additionne des chiffres déjà stockés. La sélection est
 * bornée par `MAX_SIMULATED_DEBTS`, la même constante que le résolveur refuse
 * de dépasser — l'écran n'envoie jamais une demande qu'il sait refusée.
 */
export function SimulationPane({
  locale,
  projectId,
  ranking,
}: {
  locale: Locale;
  projectId: string;
  ranking: readonly RankedDebt[];
}): JSX.Element {
  const [picked, setPicked] = useState<readonly string[]>(() =>
    ranking.slice(0, PICKED_BY_DEFAULT).map((debt) => debt.debtIssueId),
  );
  const [result, setResult] = useState<SimulationResult | null>(null);
  const action = useAction(async () => {
    setResult(await simulateRepayment(projectId, picked));
  });
  if (ranking.length === 0) return <Text>{t(locale, 'simulation.pane.none')}</Text>;
  return (
    <Stack space="space.200">
      <Text>{t(locale, 'simulation.pane.intro')}</Text>
      <SelectionTable locale={locale} ranking={ranking} picked={picked} onToggle={toggleOf(picked, setPicked)} />
      <RunBar locale={locale} count={picked.length} busy={action.busy} failure={action.failure} onRun={action.start} />
      {result ? <SimulationTab locale={locale} result={result} /> : null}
    </Stack>
  );
}

/** Ajoute ou retire une dette de la sélection, sans jamais dépasser la borne. */
function toggleOf(
  picked: readonly string[],
  setPicked: (next: readonly string[]) => void,
): (debtIssueId: string) => void {
  return (debtIssueId) => {
    if (picked.includes(debtIssueId)) {
      setPicked(picked.filter((id) => id !== debtIssueId));
      return;
    }
    if (picked.length >= MAX_SIMULATED_DEBTS) return;
    setPicked([...picked, debtIssueId]);
  };
}

/** La liste des dettes du classement, avec une case par ligne. */
function SelectionTable({
  locale,
  ranking,
  picked,
  onToggle,
}: {
  locale: Locale;
  ranking: readonly RankedDebt[];
  picked: readonly string[];
  onToggle: (debtIssueId: string) => void;
}): JSX.Element {
  const caption = t(locale, 'simulation.pane.tableCaption');
  return (
    <Table caption={caption} label={caption}>
      <Head>
        <Cell><Text>{t(locale, 'simulation.pane.col.debt')}</Text></Cell>
        <Cell><Text>{t(locale, 'simulation.pane.col.zone')}</Text></Cell>
        <Cell><Text>{t(locale, 'simulation.pane.col.range')}</Text></Cell>
        <Cell><Text>{t(locale, 'simulation.pane.col.pick')}</Text></Cell>
      </Head>
      <SelectionRows locale={locale} rows={ranking.slice(0, MAX_SIMULATED_DEBTS)} picked={picked} onToggle={onToggle} />
    </Table>
  );
}

/** Une ligne par dette : clé cliquable, zone, fourchette, inclusion. */
function SelectionRows({
  locale,
  rows,
  picked,
  onToggle,
}: {
  locale: Locale;
  rows: readonly RankedDebt[];
  picked: readonly string[];
  onToggle: (debtIssueId: string) => void;
}): JSX.Element {
  return (
    <Fragment>
      {rows.map((debt) => (
        <Row key={debt.debtIssueId}>
          <Cell><TicketLink issueKey={debt.key} /></Cell>
          <Cell><Text>{debt.zone === '' ? t(locale, 'simulation.unclassifiedZone') : debt.zone}</Text></Cell>
          <Cell><Text>{formatRange(locale, debt.lowJp, debt.highJp)}</Text></Cell>
          <Cell>
            <Button appearance="default" onClick={() => onToggle(debt.debtIssueId)}>
              {picked.includes(debt.debtIssueId)
                ? t(locale, 'simulation.pane.exclude')
                : t(locale, 'simulation.pane.include')}
            </Button>
          </Cell>
        </Row>
      ))}
    </Fragment>
  );
}

/** Le bouton de lancement, honnête sur l'état : occupé, refusé, échoué. */
function RunBar({
  locale,
  count,
  busy,
  failure,
  onRun,
}: {
  locale: Locale;
  count: number;
  busy: boolean;
  failure: string | null;
  onRun: () => void;
}): JSX.Element {
  return (
    <Stack space="space.100">
      <Button appearance="primary" isDisabled={busy || count === 0} onClick={onRun}>
        {t(locale, 'simulation.pane.run')}
      </Button>
      <Text>{t(locale, 'simulation.pane.selected', { count })}</Text>
      <Text>{t(locale, 'simulation.pane.cap', { max: MAX_SIMULATED_DEBTS })}</Text>
      {failure ? <ErrorState locale={locale} message={failure} retry={onRun} /> : null}
    </Stack>
  );
}

/** Ligne de tableau : `parseTable` doit savoir la résoudre (kit.tsx). */
markTableRow(SelectionRows);
