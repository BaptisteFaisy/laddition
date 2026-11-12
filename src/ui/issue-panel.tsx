import { Fragment, Heading, IssuePanel } from './kit';
import { mountScreen } from './mount';
import type { ScreenContext } from './context';
import { t } from './i18n/index';
import { BillView } from './components/BillView';
import { CaseButton } from './components/CaseButton';
import { ErrorState } from './components/ErrorState';
import { ScreenShell } from './components/ScreenShell';

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
      <CaseButton locale={locale} issueKey={context.issueKey} />
    </Fragment>
  );
}

mountScreen(<IssuePanelScreen />);
