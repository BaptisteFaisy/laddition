import { useState } from 'react';
import { Banner, Button, Fragment, IssueContext, Text } from './kit';
import { mountScreen } from './mount';
import type { DebtBillView, IssueAttribution } from './api';
import { confirmEvidence, getDebtBill, rejectEvidence } from './api';
import { errorMessage, useResolver } from './async';
import type { ScreenContext } from './context';
import type { Locale, MessageKey, MessageVars } from '../i18n/index';
import { t } from '../i18n/index';
import { formatJpUnit, formatPercent, formatRange } from './format';
import { AsyncView } from './components/AsyncView';
import { ErrorState } from './components/ErrorState';
import { ScreenShell } from './components/ScreenShell';
import { TicketLink } from './components/TicketLink';

/** Écran 3 (§14) : « alimente la dette X » ou « ressemble à X, confirmer ? ». */
export default function IssueContextScreen(): JSX.Element {
  return (
    <IssueContext>
      <ScreenShell>{(context) => <IssueContextContent context={context} />}</ScreenShell>
    </IssueContext>
  );
}

function IssueContextContent({ context }: { context: ScreenContext }): JSX.Element {
  const locale = context.locale;
  const issueId = context.issueId;
  if (issueId === null) return <Text>{t(locale, 'ctx.noIssue')}</Text>;
  return <IssueContextData locale={locale} issueId={issueId} />;
}

function IssueContextData({ locale, issueId }: { locale: Locale; issueId: string }): JSX.Element {
  const resolver = useResolver(issueId, () => getDebtBill(issueId));
  const [outcome, setOutcome] = useState<{ key: MessageKey; vars: MessageVars } | null>(null);
  const decided = (key: MessageKey, vars: MessageVars) => {
    setOutcome({ key, vars });
    resolver.reload();
  };
  return (
    <AsyncView
      state={resolver.state}
      locale={locale}
      retry={resolver.reload}
      render={(view) => (
        <IssueContextBody locale={locale} issueId={issueId} view={view} outcome={outcome} onDecided={decided} />
      )}
    />
  );
}

/**
 * Corps de l'encart. Après une confirmation ou un rejet, l'encart **se
 * recharge** (item D52) : la proposition et ses boutons disparaissent, et le
 * message de résultat porte ses variables de traduction (plus de `{key}` nu).
 * Le message vit au-dessus du rechargement, sinon il disparaissait avec lui.
 */
function IssueContextBody({
  locale,
  issueId,
  view,
  outcome,
  onDecided,
}: {
  locale: Locale;
  issueId: string;
  view: DebtBillView;
  outcome: { key: MessageKey; vars: MessageVars } | null;
  onDecided: (key: MessageKey, vars: MessageVars) => void;
}): JSX.Element {
  const attribution = view.attribution;
  return (
    <Fragment>
      <CostLine locale={locale} issueId={issueId} view={view} />
      {outcome ? (
        <Banner appearance="success">
          <Text>{t(locale, outcome.key, outcome.vars)}</Text>
        </Banner>
      ) : null}
      {attribution === null ? null : (
        <AttributionBody locale={locale} attribution={attribution} onDecided={onDecided} />
      )}
    </Fragment>
  );
}

/**
 * Ligne de coût (item D53) : une dette montre sa fourchette ; un ticket qui
 * n'est pas une dette montre le coût de sa propre preuve, et rien du tout quand
 * il n'en a pas — jamais un « 0 – 0 » sans sens.
 */
function CostLine({ locale, issueId, view }: { locale: Locale; issueId: string; view: DebtBillView }): JSX.Element | null {
  if (view.attribution === null) {
    return <Text>{t(locale, 'ctx.cost', { range: formatRange(locale, view.bill.lowJp, view.bill.highJp) })}</Text>;
  }
  const proof = view.evidence.find((item) => item.sourceIssueId === issueId);
  if (!proof) return null;
  return <Text>{t(locale, 'ctx.issueCost', { value: formatJpUnit(locale, proof.costJp) })}</Text>;
}

function AttributionBody({
  locale,
  attribution,
  onDecided,
}: {
  locale: Locale;
  attribution: IssueAttribution;
  onDecided: (key: MessageKey, vars: MessageVars) => void;
}): JSX.Element {
  const empty = attribution.feeds === null && attribution.proposal === null;
  return (
    <Fragment>
      {attribution.feeds ? (
        <Fragment>
          <Text>{t(locale, 'ctx.feeds', { key: attribution.feeds.key })}</Text>
          <Text>{t(locale, 'ctx.feedsBody')}</Text>
          <TicketLink issueKey={attribution.feeds.key} label={t(locale, 'ctx.openDebt')} />
        </Fragment>
      ) : null}
      {attribution.proposal ? (
        <ProposalBlock locale={locale} proposal={attribution.proposal} onDecided={onDecided} />
      ) : null}
      {empty ? <Text>{t(locale, 'ctx.none')}</Text> : null}
    </Fragment>
  );
}

function ProposalBlock({
  locale,
  proposal,
  onDecided,
}: {
  locale: Locale;
  proposal: NonNullable<IssueAttribution['proposal']>;
  onDecided: (key: MessageKey, vars: MessageVars) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const act = async (confirm: boolean) => {
    setBusy(true);
    setFailure(null);
    try {
      if (confirm) await confirmEvidence(proposal.evidenceId, proposal.debtIssueId);
      else await rejectEvidence(proposal.evidenceId, proposal.debtIssueId);
      onDecided(confirm ? 'ctx.confirmed' : 'ctx.rejected', { key: proposal.key });
    } catch (error) {
      setFailure(errorMessage(error));
    }
    setBusy(false);
  };

  return (
    <Fragment>
      <Text>{t(locale, 'ctx.similar', { key: proposal.key, zone: proposal.zone })}</Text>
      <Text>{t(locale, 'ctx.similarBody', { score: formatPercent(locale, proposal.relevance) })}</Text>
      <TicketLink issueKey={proposal.key} />
      <Button text={t(locale, 'common.confirm')} disabled={busy} onClick={() => act(true)} />
      <Button text={t(locale, 'common.reject')} disabled={busy} onClick={() => act(false)} />
      {failure ? <ErrorState locale={locale} message={failure} /> : null}
    </Fragment>
  );
}

mountScreen(<IssueContextScreen />);
