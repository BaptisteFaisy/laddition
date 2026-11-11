import { useState } from 'react';
import { Button, Cell, Fragment, Head, Row, Table, Text } from '../kit';
import type { PhantomDebt } from '../../core/types';
import { draftDebtTicket, listPhantomDebt } from '../api';
import { errorMessage, useResolver } from '../async';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { formatJp, formatNumber } from '../format';
import { AsyncView } from './AsyncView';

/** Dette fantôme (DT-08) : une zone coûteuse que personne ne rembourse. */
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
        <PhantomTable locale={locale} projectKey={projectKey} thresholdJp={thresholdJp} items={items} />
      )}
    />
  );
}

function PhantomTable({
  locale,
  projectKey,
  thresholdJp,
  items,
}: {
  locale: Locale;
  projectKey: string;
  thresholdJp: number;
  items: PhantomDebt[];
}): JSX.Element {
  if (items.length === 0) return <Text>{t(locale, 'phantom.empty')}</Text>;
  return (
    <Fragment>
      <Text>{t(locale, 'phantom.title')}</Text>
      <Text>{t(locale, 'phantom.body', { threshold: formatNumber(locale, thresholdJp) })}</Text>
      <Table>
        <Head>
          <Cell><Text>{t(locale, 'phantom.col.zone')}</Text></Cell>
          <Cell><Text>{t(locale, 'phantom.col.cost')}</Text></Cell>
          <Cell><Text>{t(locale, 'phantom.draft')}</Text></Cell>
        </Head>
        {items.map((phantom) => (
          <PhantomRow key={phantom.zone} locale={locale} projectKey={projectKey} phantom={phantom} />
        ))}
      </Table>
    </Fragment>
  );
}

function PhantomRow({
  locale,
  projectKey,
  phantom,
}: {
  locale: Locale;
  projectKey: string;
  phantom: PhantomDebt;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [drafted, setDrafted] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const draft = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const ticket = await draftDebtTicket(projectKey, phantom.zone);
      setDrafted(ticket.key);
    } catch (error) {
      setFailure(errorMessage(error));
    }
    setBusy(false);
  };

  return (
    <Row>
      <Cell><Text>{phantom.zone}</Text></Cell>
      <Cell><Text>{formatJp(locale, phantom.totalJp)}</Text></Cell>
      <Cell>
        <Button
          text={busy ? t(locale, 'phantom.drafting') : t(locale, 'phantom.draft')}
          disabled={busy}
          onClick={draft}
        />
        {drafted ? <Text>{t(locale, 'phantom.drafted', { key: drafted })}</Text> : null}
        {failure ? <Text>{failure}</Text> : null}
      </Cell>
    </Row>
  );
}
