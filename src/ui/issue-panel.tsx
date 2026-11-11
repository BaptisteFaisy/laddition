import { Fragment, Heading, IssuePanel } from '@forge/ui';
import type { ScreenContext } from './context.ts';
import { t } from './i18n/index.ts';
import { BillView } from './components/BillView.tsx';
import { ErrorState } from './components/ErrorState.tsx';
import { ScreenShell } from './components/ScreenShell.tsx';

/** Écran 2 (§14) : l'addition d'un ticket de dette, dans le panneau du ticket. */
export default function IssuePanelScreen(): JSX.Element {
  return (
    <IssuePanel>
      <ScreenShell>{(context) => <IssuePanelContent context={context} />}</ScreenShell>
    </IssuePanel>
  );
}

function IssuePanelContent({ context }: { context: ScreenContext }): JSX.Element {
  const locale = context.locale;
  if (context.issueId === null) {
    return <ErrorState locale={locale} message={t(locale, 'common.errorBody')} />;
  }
  return (
    <Fragment>
      <Heading size="medium">{t(locale, 'panel.title')}</Heading>
      <BillView locale={locale} debtIssueId={context.issueId} />
    </Fragment>
  );
}
