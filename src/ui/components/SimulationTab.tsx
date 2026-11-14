/**
 * Onglet « Simulation » (DT-21) : capacité retrouvée si les dettes
 * sélectionnées sont remboursées.
 *
 * Composant **passif** : il reçoit le résultat du résolveur
 * `simulateRepayment` en props et l'affiche — aucun appel réseau, aucun état,
 * aucun recalcul. Chaque ligne montre son chiffre **et sa méthode**
 * (`methodText`, limites du bulletin comprises) : principe 1 du §5.
 *
 * Composé uniquement depuis la façade `../kit` (jamais `@forge/react`). Les
 * textes sont des constantes exportées, à recopier dans `src/ui/i18n`.
 */

import { Banner, Cell, Fragment, Head, Row, Stack, Table, Text } from '../kit';
import type { Locale } from '../../i18n/index';
import { t } from '../../i18n/index';
import { formatDays, formatJp, formatNumber, pair } from '../format';
import type { SimulationResult, SimulationRow } from '../../core/simulation';
import { caveatLabel, methodText } from '../../i18n/domain-strings';
import { TicketLink } from './TicketLink';

/** Textes de l'écran, en constantes : à recopier dans `src/ui/i18n`. */

/** Props de l'onglet : le résultat du résolveur et la langue. */
export interface SimulationTabProps {
  /** Rendu de la clé `simulateRepayment` : chiffres stockés + méthodes. */
  result: SimulationResult;
  locale: Locale;
}

/** Écran de simulation : tableau des dettes sélectionnées, totaux, limites. */
export function SimulationTab({ result, locale }: SimulationTabProps): JSX.Element {
  return (
    <Stack space="space.200">
      <Text>{t(locale, 'simulation.intro')}</Text>
      <Table
        caption={t(locale, 'simulation.tableCaption')}
        label={t(locale, 'simulation.tableCaption')}
        empty={t(locale, 'simulation.empty')}
      >
        <Head>
          <Cell>{t(locale, 'simulation.head.debt')}</Cell>
          <Cell>{t(locale, 'simulation.head.zone')}</Cell>
          <Cell>{t(locale, 'simulation.head.avoidable')}</Cell>
          <Cell>{t(locale, 'simulation.head.observed')}</Cell>
          <Cell>{t(locale, 'simulation.head.repayment')}</Cell>
          <Cell>{t(locale, 'simulation.head.payback')}</Cell>
          <Cell>{t(locale, 'simulation.head.method')}</Cell>
        </Head>
        <SimulationRows rows={result.rows} locale={locale} />
      </Table>
      <SimulationTotals result={result} locale={locale} />
      <Banner appearance="information" title={t(locale, 'simulation.disclaimerTitle')}>
        <Text>{t(locale, 'simulation.disclaimer')}</Text>
      </Banner>
    </Stack>
  );
}

/** Une ligne par dette sélectionnée, dans un `Fragment` que `Table` sait lire. */
function SimulationRows({ rows, locale }: { rows: readonly SimulationRow[]; locale: Locale }): JSX.Element {
  return (
    <Fragment>
      {rows.map((row) => (
        <Row key={row.debtIssueId}>
          <Cell>
            <TicketLink issueKey={row.key} />
          </Cell>
          <Cell>
            <Text>{row.zone === '' ? t(locale, 'simulation.unclassifiedZone') : row.zone}</Text>
          </Cell>
          <Cell>
            <Text>{formatJp(locale, row.avoidableJp)}</Text>
          </Cell>
          <Cell>
            <Text>{formatJp(locale, row.observedWeeklyJp)}</Text>
          </Cell>
          <Cell>
            <Text>{formatJp(locale, row.repaymentJp)}</Text>
          </Cell>
          <Cell>
            <Text>{formatDays(locale, row.paybackDays)}</Text>
          </Cell>
          <Cell>
            <MethodCell row={row} locale={locale} />
          </Cell>
        </Row>
      ))}
    </Fragment>
  );
}

/** Méthode du chiffre, avec les limites stockées du bulletin le cas échéant. */
function MethodCell({ row, locale }: { row: SimulationRow; locale: Locale }): JSX.Element {
  return (
    <Fragment>
      <Text>{methodText(locale, row.methodText)}</Text>
      {row.caveats.map((caveat) => (
        <Text key={caveat}>{`${t(locale, 'simulation.caveatPrefix')}${caveatLabel(locale, caveat)}`}</Text>
      ))}
    </Fragment>
  );
}

/** Totaux de la sélection : les deux unités restent sur deux lignes séparées. */
function SimulationTotals({ result, locale }: SimulationTabProps): JSX.Element {
  const { totals } = result;
  return (
    <Stack space="space.050">
      <Text>{pair(locale, t(locale, 'simulation.total.avoidable'), formatJp(locale, totals.avoidableJp))}</Text>
      <Text>{pair(locale, t(locale, 'simulation.total.observed'), formatJp(locale, totals.observedWeeklyJp))}</Text>
      <Text>{pair(locale, t(locale, 'simulation.total.repayment'), formatJp(locale, totals.repaymentJp))}</Text>
      <Text>{pair(locale, t(locale, 'simulation.unquantified'), formatNumber(locale, totals.unquantifiedCount))}</Text>
    </Stack>
  );
}
