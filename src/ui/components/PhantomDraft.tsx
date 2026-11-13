import { useState } from 'react';
import { Button, Fragment, Text } from '../kit';
import type { DebtDraft, DraftedTicket } from '../api';
import { draftDebtTicket, previewDebtTicket } from '../api';
import { errorMessage } from '../async';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { pair } from '../format';
import { useSiteUrl } from '../site-url';
import { ErrorState } from './ErrorState';
import { TicketLink } from './TicketLink';

/**
 * Dette fantôme : préparer → relire → créer (§7.2, item D51).
 *
 * Le brouillon est d'abord rendu **sans** créer de ticket, puis relu à l'écran ;
 * la création n'arrive qu'au second clic, et l'adresse du ticket créé est
 * affichée avec sa clé cliquable (item D50).
 */
export function PhantomDraft({
  locale,
  projectKey,
  zone,
}: {
  locale: Locale;
  projectKey: string;
  zone: string;
}): JSX.Element {
  const flow = useDraftFlow(projectKey, zone, locale);
  return (
    <Fragment>
      {flow.created ? <CreatedTicket locale={locale} ticket={flow.created} /> : null}
      {!flow.created && !flow.draft ? (
        <Fragment>
          <Button
            text={flow.busy ? t(locale, 'phantom.previewing') : t(locale, 'phantom.preview')}
            disabled={flow.busy}
            onClick={flow.prepare}
          />
          {flow.previewFailed ? <PrepareFallback locale={locale} busy={flow.busy} onCreate={flow.create} /> : null}
        </Fragment>
      ) : null}
      {!flow.created && flow.draft ? (
        <DraftReview locale={locale} draft={flow.draft} busy={flow.busy} onCreate={flow.create} />
      ) : null}
      {flow.failure ? <ErrorState locale={locale} message={flow.failure} /> : null}
    </Fragment>
  );
}

/**
 * Repli tant que la relecture n'est pas disponible : la création reste
 * possible, mais l'écran dit clairement qu'elle se fait sans relecture.
 */
function PrepareFallback({
  locale,
  busy,
  onCreate,
}: {
  locale: Locale;
  busy: boolean;
  onCreate: () => void;
}): JSX.Element {
  return (
    <Fragment>
      <Text>{t(locale, 'phantom.previewUnavailable')}</Text>
      <Button
        text={busy ? t(locale, 'phantom.creating') : t(locale, 'phantom.create')}
        disabled={busy}
        onClick={onCreate}
      />
    </Fragment>
  );
}

/** Les deux appels réseau du brouillon : préparer, puis créer. */
function useDraftFlow(projectKey: string, zone: string, locale: Locale) {
  const siteUrl = useSiteUrl();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<DebtDraft | null>(null);
  const [created, setCreated] = useState<DraftedTicket | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (error) {
      setFailure(errorMessage(error));
    }
    setBusy(false);
  };

  const prepare = () =>
    run(async () => {
      try {
        setDraft(await previewDebtTicket(projectKey, zone, locale));
        setPreviewFailed(false);
      } catch (error) {
        setPreviewFailed(true);
        throw error;
      }
    });

  return {
    busy,
    draft,
    created,
    failure,
    previewFailed,
    prepare,
    create: () => run(async () => setCreated(await draftDebtTicket(projectKey, zone, locale, siteUrl))),
  };
}

/** Le brouillon relu avant création : titre, description, origine du texte. */
function DraftReview({
  locale,
  draft,
  busy,
  onCreate,
}: {
  locale: Locale;
  draft: DebtDraft;
  busy: boolean;
  onCreate: () => void;
}): JSX.Element {
  const source = draft.source === 'model' ? 'phantom.draftSourceModel' : 'phantom.draftSourceTemplate';
  return (
    <Fragment>
      <Text>{t(locale, 'phantom.previewTitle')}</Text>
      <Text>{pair(locale, t(locale, 'phantom.draftTitle'), draft.title)}</Text>
      <Text>{pair(locale, t(locale, 'phantom.draftDescription'), draft.description)}</Text>
      <Text>{t(locale, source)}</Text>
      <Text>{t(locale, 'phantom.reviewHint')}</Text>
      <Button
        text={busy ? t(locale, 'phantom.creating') : t(locale, 'phantom.create')}
        disabled={busy}
        onClick={onCreate}
      />
    </Fragment>
  );
}

/** Ticket créé : sa clé cliquable et son adresse (§18 « Transparence »). */
function CreatedTicket({ locale, ticket }: { locale: Locale; ticket: DraftedTicket }): JSX.Element {
  return (
    <Fragment>
      <Text>{t(locale, 'phantom.drafted', { key: ticket.key })}</Text>
      <TicketLink issueKey={ticket.key} />
      <Text>{pair(locale, t(locale, 'phantom.createdUrl'), ticket.url)}</Text>
    </Fragment>
  );
}
