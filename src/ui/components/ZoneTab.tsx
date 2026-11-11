import { Cell, Fragment, Head, Row, Table, Text } from '../kit';
import type { ProjectSettings, ZoneCost } from '../../core/types';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { formatJp, formatPercent } from '../format';
import { Disclosure } from './Disclosure';
import { ZoneFamilies } from './ZoneFamilies';

/** Carte des coûts par zone (§14, onglet Zones). Les équipes, jamais les personnes. */
export function ZoneTab({
  locale,
  zones,
  settings,
}: {
  locale: Locale;
  zones: ZoneCost[];
  settings: ProjectSettings;
}): JSX.Element {
  if (zones.length === 0) return <Text>{t(locale, 'zones.empty')}</Text>;
  return (
    <Fragment>
      <Text>{t(locale, 'zones.title')}</Text>
      <Text>{t(locale, 'zones.body')}</Text>
      <Table>
        <Head>
          <Cell><Text>{t(locale, 'zones.col.zone')}</Text></Cell>
          <Cell><Text>{t(locale, 'zones.col.team')}</Text></Cell>
          <Cell><Text>{t(locale, 'zones.col.cost')}</Text></Cell>
          <Cell><Text>{t(locale, 'zones.col.unclassified')}</Text></Cell>
          <Cell><Text>{t(locale, 'common.method')}</Text></Cell>
        </Head>
        {zones.map((zone) => (
          <ZoneRow key={`${zone.projectKey}:${zone.zone}`} locale={locale} zone={zone} settings={settings} />
        ))}
      </Table>
    </Fragment>
  );
}

function ZoneRow({
  locale,
  zone,
  settings,
}: {
  locale: Locale;
  zone: ZoneCost;
  settings: ProjectSettings;
}): JSX.Element {
  return (
    <Row>
      <Cell><Text>{zone.zone || t(locale, 'common.unclassified')}</Text></Cell>
      <Cell><Text>{zone.team ?? t(locale, 'zones.noTeam')}</Text></Cell>
      <Cell><Text>{formatJp(locale, zone.totalJp)}</Text></Cell>
      <Cell><Text>{formatPercent(locale, zone.unclassifiedShare)}</Text></Cell>
      <Cell>
        <Disclosure label={t(locale, 'common.method')} labelOpen={t(locale, 'common.hideFormula')}>
          <ZoneFamilies locale={locale} zone={zone} settings={settings} />
        </Disclosure>
      </Cell>
    </Row>
  );
}
