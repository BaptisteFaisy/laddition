import { useState } from 'react';
import { Button, Cell, Fragment, Head, markTableRow, Row, Table, Text } from '../kit';
import type { PendingMatch } from '../api';
import { confirmEvidence, rejectEvidence } from '../api';
import { errorMessage } from '../async';
import type { Locale, MessageKey } from '../i18n/index';
import { t } from '../i18n/index';
import { familyLabel, formatJp, formatPercent } from '../format';
import { ErrorState } from './ErrorState';
import { TicketLink } from './TicketLink';

/**
 * Rapprochements proposés par le modèle (§10). Un clic confirme ou rejette ;
 * un rejet n'est plus jamais proposé (recette 3), et la liste se recharge
 * (item D52). Une preuve que le lecteur ne peut pas ouvrir reste masquée :
 * sa clé n'est pas affichée (item D63, §18 « Droits »).
 */
export function MatchList({
  locale,
  debtIssueId,
  matches,
  visibleEvidenceIds,
  onChanged,
}: {
  locale: Locale;
  debtIssueId: string;
  matches: PendingMatch[];
  visibleEvidenceIds: Set<string>;
  onChanged: () => void;
}): JSX.Element {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<MessageKey | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const act = async (evidenceId: string, confirm: boolean) => {
    setBusyId(evidenceId);
    setFailure(null);
    try {
      if (confirm) await confirmEvidence(evidenceId, debtIssueId);
      else await rejectEvidence(evidenceId, debtIssueId);
      setOutcome(confirm ? 'panel.matched' : 'panel.rejected');
      onChanged();
    } catch (error) {
      setFailure(errorMessage(error));
    }
    setBusyId(null);
  };

  return (
    <Fragment>
      <Text>{t(locale, 'panel.matches')}</Text>
      {failure ? <ErrorState locale={locale} message={failure} /> : null}
      {outcome ? <Text>{t(locale, outcome)}</Text> : null}
      {matches.length === 0 ? <Text>{t(locale, 'panel.matchesEmpty')}</Text> : null}
      {matches.length > 0 ? (
        <MatchTable locale={locale} matches={matches} visible={visibleEvidenceIds} busyId={busyId} act={act} />
      ) : null}
    </Fragment>
  );
}

function MatchTable({
  locale,
  matches,
  visible,
  busyId,
  act,
}: {
  locale: Locale;
  matches: PendingMatch[];
  visible: Set<string>;
  busyId: string | null;
  act: (evidenceId: string, confirm: boolean) => Promise<void>;
}): JSX.Element {
  const caption = t(locale, 'panel.matches');
  return (
    <Table caption={caption} label={caption}>
      <Head>
        <Cell><Text>{t(locale, 'common.source')}</Text></Cell>
        <Cell><Text>{t(locale, 'common.cost')}</Text></Cell>
        <Cell><Text>{t(locale, 'panel.matchWhy')}</Text></Cell>
        <Cell><Text>{t(locale, 'common.confirm')}</Text></Cell>
      </Head>
      {matches.map((match) => (
        <MatchRow
          key={match.evidenceId}
          locale={locale}
          match={match}
          hidden={!visible.has(match.evidenceId)}
          busy={busyId === match.evidenceId}
          act={act}
        />
      ))}
    </Table>
  );
}

function MatchRow({
  locale,
  match,
  hidden,
  busy,
  act,
}: {
  locale: Locale;
  match: PendingMatch;
  hidden: boolean;
  busy: boolean;
  act: (evidenceId: string, confirm: boolean) => Promise<void>;
}): JSX.Element {
  return (
    <Row>
      <Cell>
        {hidden ? <Text>{t(locale, 'common.hiddenItems', { count: 1 })}</Text> : <TicketLink issueKey={match.sourceKey} />}
        <Text>{familyLabel(locale, match.family)}</Text>
      </Cell>
      <Cell><Text>{formatJp(locale, match.costJp)}</Text></Cell>
      <Cell>
        <Text>{match.rationale}</Text>
        <Text>{formatPercent(locale, match.relevance)}</Text>
      </Cell>
      <Cell>
        <Button text={t(locale, 'common.confirm')} disabled={busy} onClick={() => act(match.evidenceId, true)} />
        <Button text={t(locale, 'common.reject')} disabled={busy} onClick={() => act(match.evidenceId, false)} />
      </Cell>
    </Row>
  );
}

/** Ligne de tableau : `parseTable` doit savoir la résoudre (kit.tsx). */
markTableRow(MatchRow);
