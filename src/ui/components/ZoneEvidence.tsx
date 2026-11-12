import { Cell, Fragment, Head, Row, Table, Text } from '../kit';
import type { ZoneEvidenceLine } from '../api';
import { listZoneEvidence } from '../api';
import { useResolver } from '../async';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { familyLabel, formatDate, formatJp, formatPercent } from '../format';
import { AsyncView } from './AsyncView';
import { FormulaDisclosure } from './FormulaDisclosure';
import { TicketLink } from './TicketLink';

/**
 * Le chemin d'un chiffre de zone vers ses tickets (§18 « Transparence »,
 * item D55), avec les parts qui répartissent chaque preuve entre les dettes
 * (item D57, recette §20 n°2).
 */
export function ZoneEvidence({
  locale,
  projectId,
  zone,
}: {
  locale: Locale;
  projectId: string;
  zone: string;
}): JSX.Element {
  const resolver = useResolver(`${projectId}#${zone}`, () => listZoneEvidence(projectId, zone));
  const name = zone === '' ? t(locale, 'common.unclassified') : zone;
  return (
    <AsyncView
      state={resolver.state}
      locale={locale}
      retry={resolver.reload}
      render={(items) => <ZoneEvidenceTable locale={locale} zone={name} items={items} />}
    />
  );
}

function ZoneEvidenceTable({
  locale,
  zone,
  items,
}: {
  locale: Locale;
  zone: string;
  items: ZoneEvidenceLine[];
}): JSX.Element {
  const caption = t(locale, 'zones.evidenceTitle', { zone });
  return (
    <Table caption={caption} label={caption} empty={t(locale, 'common.empty')}>
      <Head>
        <Cell><Text>{t(locale, 'common.source')}</Text></Cell>
        <Cell><Text>{t(locale, 'common.date')}</Text></Cell>
        <Cell><Text>{t(locale, 'common.cost')}</Text></Cell>
        <Cell><Text>{t(locale, 'zones.col.shares')}</Text></Cell>
        <Cell><Text>{t(locale, 'common.formula')}</Text></Cell>
      </Head>
      {items.map((line) => (
        <ZoneEvidenceRow key={line.evidence.id} locale={locale} line={line} />
      ))}
    </Table>
  );
}

function ZoneEvidenceRow({ locale, line }: { locale: Locale; line: ZoneEvidenceLine }): JSX.Element {
  const evidence = line.evidence;
  return (
    <Row>
      <Cell>
        {evidence.visible ? <TicketLink issueKey={evidence.sourceKey} /> : null}
        {evidence.visible ? null : <Text>{t(locale, 'common.hiddenItems', { count: 1 })}</Text>}
        <Text>{familyLabel(locale, evidence.family)}</Text>
      </Cell>
      <Cell><Text>{formatDate(locale, evidence.occurredAt)}</Text></Cell>
      <Cell>
        <Text>{evidence.insufficient ? t(locale, 'common.insufficient') : formatJp(locale, evidence.costJp)}</Text>
      </Cell>
      <Cell><ShareCell locale={locale} line={line} /></Cell>
      <Cell><FormulaDisclosure locale={locale} family={evidence.family} detail={evidence.detail} /></Cell>
    </Row>
  );
}

/** Les dettes qui se partagent cette preuve, et leur part : jamais plus de 100 %. */
function ShareCell({ locale, line }: { locale: Locale; line: ZoneEvidenceLine }): JSX.Element {
  if (line.shares.length === 0) return <Text>{t(locale, 'common.none')}</Text>;
  return (
    <Fragment>
      {line.shares.map((share) => (
        <Fragment key={share.debtIssueId}>
          <TicketLink issueKey={share.debtKey} />
          <Text>{formatPercent(locale, share.share)}</Text>
        </Fragment>
      ))}
    </Fragment>
  );
}
