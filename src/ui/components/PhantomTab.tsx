import { Cell, Fragment, Head, markTableRow, Row, Table, Text } from '../kit';
import type { PhantomDebt } from '../../core/types';
import { listPhantomDebt } from '../api';
import { useResolver } from '../async';
import type { Locale } from '../../i18n/index';
import { t } from '../../i18n/index';
import { formatJp, formatNumber } from '../format';
import { AsyncView } from './AsyncView';
import { Disclosure } from './Disclosure';
import { FamilyCostLines } from './FamilyCostLines';
import { FormulaList } from './FormulaList';
import { PhantomDraft } from './PhantomDraft';
import { ZoneEvidence } from './ZoneEvidence';

/**
 * Dette fantôme (DT-08) : une zone coûteuse que personne ne rembourse.
 *
 * Le chiffre ouvre ses preuves (item D55), les familles sont détaillées
 * (item D57), et le ticket n'est créé qu'après relecture du brouillon
 * (item D51).
 */
export function PhantomTab({
  locale,
  projectId,
  projectKey,
  thresholdJp,
}: {
  locale: Locale;
  projectId: string;
  projectKey: string;
  thresholdJp: number;
}): JSX.Element {
  const resolver = useResolver(projectId, () => listPhantomDebt(projectId, projectKey));
  return (
    <AsyncView
      state={resolver.state}
      locale={locale}
      retry={resolver.reload}
      render={(items) => (
        <PhantomTable
          locale={locale}
          projectId={projectId}
          projectKey={projectKey}
          thresholdJp={thresholdJp}
          items={items}
        />
      )}
    />
  );
}

function PhantomTable({
  locale,
  projectId,
  projectKey,
  thresholdJp,
  items,
}: {
  locale: Locale;
  projectId: string;
  projectKey: string;
  thresholdJp: number;
  items: PhantomDebt[];
}): JSX.Element {
  const caption = t(locale, 'phantom.title');
  return (
    <Fragment>
      <Text>{t(locale, 'phantom.body', { threshold: formatNumber(locale, thresholdJp) })}</Text>
      <Table caption={caption} label={caption} empty={t(locale, 'phantom.empty')}>
        <Head>
          <Cell><Text>{t(locale, 'phantom.col.zone')}</Text></Cell>
          <Cell><Text>{t(locale, 'phantom.col.cost')}</Text></Cell>
          <Cell><Text>{t(locale, 'phantom.col.families')}</Text></Cell>
          <Cell><Text>{t(locale, 'common.evidence')}</Text></Cell>
          <Cell><Text>{t(locale, 'phantom.draft')}</Text></Cell>
        </Head>
        {items.map((phantom) => (
          <PhantomRow key={phantom.zone} locale={locale} projectId={projectId} projectKey={projectKey} phantom={phantom} />
        ))}
      </Table>
    </Fragment>
  );
}

function PhantomRow({
  locale,
  projectId,
  projectKey,
  phantom,
}: {
  locale: Locale;
  projectId: string;
  projectKey: string;
  phantom: PhantomDebt;
}): JSX.Element {
  return (
    <Row>
      <Cell><Text>{phantom.zone}</Text></Cell>
      <Cell><Text>{formatJp(locale, phantom.totalJp)}</Text></Cell>
      <Cell>
        <FamilyCostLines locale={locale} byFamily={phantom.byFamily} />
        <Disclosure label={t(locale, 'common.method')} labelOpen={t(locale, 'common.hideFormula')}>
          <FormulaList locale={locale} />
        </Disclosure>
      </Cell>
      <Cell>
        <Disclosure label={t(locale, 'zones.evidence')} labelOpen={t(locale, 'common.hideFormula')}>
          <ZoneEvidence locale={locale} projectId={projectId} zone={phantom.zone} />
        </Disclosure>
      </Cell>
      <Cell><PhantomDraft locale={locale} projectKey={projectKey} zone={phantom.zone} /></Cell>
    </Row>
  );
}

/** Ligne de tableau : `parseTable` doit savoir la résoudre (kit.tsx). */
markTableRow(PhantomRow);
