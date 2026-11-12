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
import type { Locale } from '../i18n/index';
import { formatDays, formatJp, formatNumber, pair } from '../format';
import type { SimulationResult, SimulationRow } from '../../core/simulation';
import { TicketLink } from './TicketLink';

/** Textes de l'écran, en constantes : à recopier dans `src/ui/i18n`. */
export const SIMULATION_TEXTS = {
  intro:
    'Simulation : capacité retrouvée si les dettes sélectionnées sont remboursées. ' +
    'Tous les chiffres proviennent du dernier calcul stocké — aucun recalcul, chaque nombre affiche sa méthode.',
  tableCaption: 'Capacité retrouvée par dette sélectionnée',
  headDebt: 'Dette',
  headZone: 'Zone',
  headAvoidable: 'Évitable sur 2 trimestres (j-p)',
  headObserved: 'Observé (j-p / semaine)',
  headRepayment: 'Coût du remboursement (j-p)',
  headPayback: 'Délai de retour',
  headMethod: 'Méthode du chiffre',
  caveatPrefix: 'limite : ',
  totalAvoidable: 'Total évitable (j-p, deux trimestres)',
  totalObserved: 'Total observé (j-p par semaine)',
  totalRepayment: 'Total du coût de remboursement (j-p)',
  unquantifiedCount: 'Dettes sans chiffre exploitable',
  unclassifiedZone: 'non classé',
  empty: 'Aucune dette sélectionnée.',
  disclaimerTitle: 'Lecture',
  disclaimer:
    'La simulation additionne des chiffres déjà stockés, jamais une projection nouvelle. ' +
    'Un bulletin publié compare le coût de la zone avant et après la clôture : une observation, pas une preuve de causalité.',
} as const;

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
      <Text>{SIMULATION_TEXTS.intro}</Text>
      <Table
        caption={SIMULATION_TEXTS.tableCaption}
        label={SIMULATION_TEXTS.tableCaption}
        empty={SIMULATION_TEXTS.empty}
      >
        <Head>
          <Cell>{SIMULATION_TEXTS.headDebt}</Cell>
          <Cell>{SIMULATION_TEXTS.headZone}</Cell>
          <Cell>{SIMULATION_TEXTS.headAvoidable}</Cell>
          <Cell>{SIMULATION_TEXTS.headObserved}</Cell>
          <Cell>{SIMULATION_TEXTS.headRepayment}</Cell>
          <Cell>{SIMULATION_TEXTS.headPayback}</Cell>
          <Cell>{SIMULATION_TEXTS.headMethod}</Cell>
        </Head>
        <SimulationRows rows={result.rows} locale={locale} />
      </Table>
      <SimulationTotals result={result} locale={locale} />
      <Banner appearance="information" title={SIMULATION_TEXTS.disclaimerTitle}>
        <Text>{SIMULATION_TEXTS.disclaimer}</Text>
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
            <Text>{row.zone === '' ? SIMULATION_TEXTS.unclassifiedZone : row.zone}</Text>
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
            <MethodCell row={row} />
          </Cell>
        </Row>
      ))}
    </Fragment>
  );
}

/** Méthode du chiffre, avec les limites stockées du bulletin le cas échéant. */
function MethodCell({ row }: { row: SimulationRow }): JSX.Element {
  return (
    <Fragment>
      <Text>{row.methodText}</Text>
      {row.caveats.map((caveat) => (
        <Text key={caveat}>{`${SIMULATION_TEXTS.caveatPrefix}${caveat}`}</Text>
      ))}
    </Fragment>
  );
}

/** Totaux de la sélection : les deux unités restent sur deux lignes séparées. */
function SimulationTotals({ result, locale }: SimulationTabProps): JSX.Element {
  const { totals } = result;
  return (
    <Stack space="space.050">
      <Text>{pair(locale, SIMULATION_TEXTS.totalAvoidable, formatJp(locale, totals.avoidableJp))}</Text>
      <Text>{pair(locale, SIMULATION_TEXTS.totalObserved, formatJp(locale, totals.observedWeeklyJp))}</Text>
      <Text>{pair(locale, SIMULATION_TEXTS.totalRepayment, formatJp(locale, totals.repaymentJp))}</Text>
      <Text>{pair(locale, SIMULATION_TEXTS.unquantifiedCount, formatNumber(locale, totals.unquantifiedCount))}</Text>
    </Stack>
  );
}
