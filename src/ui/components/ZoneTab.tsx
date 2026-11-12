import { Cell, Fragment, Head, Row, Table, Text } from '../kit';
import type { Family, ProjectSettings, RankedDebt, ZoneCost } from '../../core/types';
import { BILLED_FAMILIES } from '../../core/types';
import { teamLabel } from '../domain-strings';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { formatJp, formatPercent } from '../format';
import { Disclosure } from './Disclosure';
import { RangeBadge } from './RangeBadge';
import { TicketLink } from './TicketLink';
import { ZoneEvidence } from './ZoneEvidence';
import { ZoneFamilies } from './ZoneFamilies';

/**
 * Carte des coûts par zone (§14, onglet Zones). Les équipes, jamais les
 * personnes. Chaque zone ouvre sa méthode **et** le chemin vers ses preuves :
 * ses tickets de dette, puis les preuves de la zone (item D55).
 */
export function ZoneTab({
  locale,
  projectId,
  zones,
  ranking,
  settings,
}: {
  locale: Locale;
  projectId: string;
  zones: ZoneCost[];
  ranking: RankedDebt[];
  settings: ProjectSettings;
}): JSX.Element {
  const caption = t(locale, 'zones.title');
  return (
    <Fragment>
      <Text>{t(locale, 'zones.body')}</Text>
      <Table caption={caption} label={caption} empty={t(locale, 'zones.empty')}>
        <Head>
          <Cell><Text>{t(locale, 'zones.col.zone')}</Text></Cell>
          <Cell><Text>{t(locale, 'zones.col.team')}</Text></Cell>
          <Cell><Text>{t(locale, 'zones.col.cost')}</Text></Cell>
          <Cell><Text>{t(locale, 'zones.col.unclassified')}</Text></Cell>
          <Cell><Text>{t(locale, 'zones.col.debts')}</Text></Cell>
          <Cell><Text>{t(locale, 'common.method')}</Text></Cell>
          <Cell><Text>{t(locale, 'common.evidence')}</Text></Cell>
        </Head>
        {zones.map((zone) => (
          <ZoneRow
            key={`${zone.projectKey}:${zone.zone}`}
            locale={locale}
            projectId={projectId}
            zone={zone}
            debts={debtsOfZone(ranking, zone.zone)}
            settings={settings}
          />
        ))}
      </Table>
    </Fragment>
  );
}

/** Dettes du classement qui portent sur cette zone. */
function debtsOfZone(ranking: RankedDebt[], zone: string): RankedDebt[] {
  return ranking.filter((debt) => debt.zone === zone);
}

function ZoneRow({
  locale,
  projectId,
  zone,
  debts,
  settings,
}: {
  locale: Locale;
  projectId: string;
  zone: ZoneCost;
  debts: RankedDebt[];
  settings: ProjectSettings;
}): JSX.Element {
  const name = zone.zone === '' ? t(locale, 'common.unclassified') : zone.zone;
  return (
    <Row>
      <Cell><Text>{name}</Text></Cell>
      <Cell><Text>{teamLabel(locale, zone.team)}</Text></Cell>
      <Cell><ZoneCostCell locale={locale} zone={zone} /></Cell>
      <Cell><Text>{formatPercent(locale, zone.unclassifiedShare)}</Text></Cell>
      <Cell><ZoneDebts locale={locale} debts={debts} /></Cell>
      <Cell>
        <Disclosure label={t(locale, 'common.method')} labelOpen={t(locale, 'common.hideFormula')}>
          <ZoneFamilies locale={locale} zone={zone} settings={settings} />
        </Disclosure>
      </Cell>
      <Cell>
        <Disclosure label={t(locale, 'zones.evidence')} labelOpen={t(locale, 'common.hideFormula')}>
          <ZoneEvidence locale={locale} projectId={projectId} zone={zone.zone} />
        </Disclosure>
      </Cell>
    </Row>
  );
}

/** Les tickets de dette de la zone : chacun ouvre son addition, donc ses preuves. */
function ZoneDebts({ locale, debts }: { locale: Locale; debts: RankedDebt[] }): JSX.Element {
  if (debts.length === 0) return <Text>{t(locale, 'common.none')}</Text>;
  return (
    <Fragment>
      {debts.map((debt) => (
        <TicketLink key={debt.debtIssueId} issueKey={debt.key} />
      ))}
    </Fragment>
  );
}

/** Coût de la zone : « données insuffisantes » si une famille ne peut pas être chiffrée. */
function ZoneCostCell({ locale, zone }: { locale: Locale; zone: ZoneCost }): JSX.Element {
  if (hasInsufficient(zone)) {
    return <RangeBadge locale={locale} lowJp={zone.totalJp} highJp={zone.totalJp} insufficient />;
  }
  return <Text>{formatJp(locale, zone.totalJp)}</Text>;
}

function hasInsufficient(zone: ZoneCost): boolean {
  const flags = zone.insufficientByFamily ?? {};
  return BILLED_FAMILIES.some((family: Family) => flags[family] === true);
}
