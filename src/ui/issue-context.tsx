import { Button, Fragment, IssueContext, Text, useState } from '@forge/ui';
import type { DebtBillView, IssueAttribution } from './api.ts';
import { confirmEvidence, getDebtBill, rejectEvidence } from './api.ts';
import { errorMessage, useResolver } from './async.ts';
import type { ScreenContext } from './context.ts';
import { formatPercent, formatRange } from './format.ts';
import type { Locale, MessageKey } from './i18n/index.ts';
import { t } from './i18n/index.ts';
import { AsyncView } from './components/AsyncView.tsx';
import { DemoBanner } from './components/DemoBanner.tsx';
import { ErrorState } from './components/ErrorState.tsx';
import { ScreenShell } from './components/ScreenShell.tsx';

/** Écran 3 (§14) : « alimente la dette X » ou « ressemble à X, confirmer ? ». */
export default function IssueContextScreen(): JSX.Element {
  return (
    <IssueContext>
      <ScreenShell>{(context) => <IssueContextContent context={context} />}</ScreenShell>
    </IssueContext>
  );
}

function IssueContextContent({ context }: { context: ScreenContext }): JSX.Element {
  const issueId = context.issueId ?? '';
  const resolver = useResolver(issueId, issueId === '' ? null : () => getDebtBill(issueId));
  return (
    <AsyncView
      state={resolver.state}
      locale={context.locale}
      retry={resolver.reload}
      render={(view) => <IssueContextBody locale={context.locale} view={view} />}
    />
  );
}

function IssueContextBody({ locale, view }: { locale: Locale; view: DebtBillView }): JSX.Element {
  const attribution = view.attribution;
  return (
    <Fragment>
      <DemoBanner locale={locale} demoData={view.settings.demoData} />
      <Text>{t(locale, 'ctx.cost', { range: formatRange(locale, view.bill.lowJp, view.bill.highJp) })}</Text>
      {attribution === null ? <Text>{t(locale, 'ctx.none')}</Text> : <AttributionBody locale={locale} attribution={attribution} />}
    </Fragment>
  );
}

function AttributionBody({
  locale,
  attribution,
}: {
  locale: Locale;
  attribution: IssueAttribution;
}): JSX.Element {
  const empty = attribution.feeds === null && attribution.proposal === null;
  return (
    <Fragment>
      {attribution.feeds ? (
        <Fragment>
          <Text>{t(locale, 'ctx.feeds', { key: attribution.feeds.key })}</Text>
          <Text>{t(locale, 'ctx.feedsBody')}</Text>
        </Fragment>
      ) : null}
      {attribution.proposal ? <ProposalBlock locale={locale} proposal={attribution.proposal} /> : null}
      {empty ? <Text>{t(locale, 'ctx.none')}</Text> : null}
    </Fragment>
  );
}

function ProposalBlock({
  locale,
  proposal,
}: {
  locale: Locale;
  proposal: NonNullable<IssueAttribution['proposal']>;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<MessageKey | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const act = async (confirm: boolean) => {
    setBusy(true);
    setFailure(null);
    try {
      if (confirm) await confirmEvidence(proposal.evidenceId, proposal.debtIssueId);
      else await rejectEvidence(proposal.evidenceId, proposal.debtIssueId);
      setOutcome(confirm ? 'ctx.confirmed' : 'ctx.rejected');
    } catch (error) {
      setFailure(errorMessage(error));
    }
    setBusy(false);
  };

  return (
    <Fragment>
      <Text>{t(locale, 'ctx.similar', { key: proposal.key, zone: proposal.zone })}</Text>
      <Text>{t(locale, 'ctx.similarBody', { score: formatPercent(locale, proposal.relevance) })}</Text>
      <Button text={t(locale, 'common.confirm')} disabled={busy} onClick={() => act(true)} />
      <Button text={t(locale, 'common.reject')} disabled={busy} onClick={() => act(false)} />
      {outcome ? <Text>{t(locale, outcome)}</Text> : null}
      {failure ? <ErrorState locale={locale} message={failure} /> : null}
    </Fragment>
  );
}
