import { CustomField, Fragment, Text } from '@forge/ui';
import type { DebtBillView } from './api.ts';
import { getDebtBill } from './api.ts';
import { useResolver } from './async.ts';
import type { ScreenContext } from './context.ts';
import { formatNumber, formatRange } from './format.ts';
import type { Locale } from './i18n/index.ts';
import { t } from './i18n/index.ts';
import { AsyncView } from './components/AsyncView.tsx';
import { ScreenShell } from './components/ScreenShell.tsx';

/**
 * Écran 4 (§14) : le champ « Coût de la dette (j-p / 90 j) », en lecture seule.
 * L'app l'écrit ; l'écran ne fait que l'afficher.
 */
export default function CustomFieldScreen(): JSX.Element {
  return (
    <CustomField>
      <ScreenShell>{(context) => <CustomFieldContent context={context} />}</ScreenShell>
    </CustomField>
  );
}

function CustomFieldContent({ context }: { context: ScreenContext }): JSX.Element {
  const issueId = context.issueId ?? '';
  const resolver = useResolver(issueId, issueId === '' ? null : () => getDebtBill(issueId));
  return (
    <AsyncView
      state={resolver.state}
      locale={context.locale}
      retry={resolver.reload}
      render={(view) => <CustomFieldValue locale={context.locale} view={view} />}
    />
  );
}

function CustomFieldValue({ locale, view }: { locale: Locale; view: DebtBillView }): JSX.Element {
  const { bill, settings } = view;
  const empty = bill.evidenceIds.length === 0 && bill.lowJp === 0 && bill.highJp === 0;
  if (empty) return <Text>{t(locale, 'field.missing')}</Text>;
  return (
    <Fragment>
      <Text>{t(locale, 'field.title')}</Text>
      <Text>
        {t(locale, 'field.value', {
          range: formatRange(locale, bill.lowJp, bill.highJp),
          days: formatNumber(locale, settings.windowDays),
        })}
      </Text>
      {settings.demoData ? <Text>{t(locale, 'common.demoShort')}</Text> : null}
    </Fragment>
  );
}
