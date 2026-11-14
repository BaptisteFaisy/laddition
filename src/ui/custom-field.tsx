import { CustomField, Fragment, Text } from './kit';
import { mountScreen } from './mount';
import type { IssueCost } from './api';
import { getDebtBill, getIssueCost } from './api';
import { useResolver } from './async';
import type { ScreenContext } from './context';
import { formatNumber, formatRange } from './format';
import { costOfBill } from './issue-cost';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { AsyncView } from './components/AsyncView';
import { ScreenShell } from './components/ScreenShell';

/**
 * Écran 4 (§14) : le champ « Coût de la dette (j-p / 90 j) », en lecture seule.
 *
 * Trois lignes de texte : l'écran ne charge donc que le coût du ticket, pas
 * tout l'état du projet (item D39). Sans ticket dans le contexte, il le dit au
 * lieu de charger indéfiniment (item D62).
 */
export default function CustomFieldScreen(): JSX.Element {
  return (
    <CustomField>
      <ScreenShell>{(context) => <CustomFieldContent context={context} />}</ScreenShell>
    </CustomField>
  );
}

function CustomFieldContent({ context }: { context: ScreenContext }): JSX.Element {
  const locale = context.locale;
  const issueId = context.issueId;
  if (issueId === null) return <Text>{t(locale, 'field.noIssue')}</Text>;
  return <CustomFieldData locale={locale} issueId={issueId} />;
}

function CustomFieldData({ locale, issueId }: { locale: Locale; issueId: string }): JSX.Element {
  const resolver = useResolver(issueId, () => issueCostOf(issueId));
  return (
    <AsyncView
      state={resolver.state}
      locale={locale}
      retry={resolver.reload}
      render={(cost) => <CustomFieldValue locale={locale} cost={cost} />}
    />
  );
}

/** Le coût du ticket : la clé réduite d'abord, l'addition complète en repli. */
async function issueCostOf(issueId: string): Promise<IssueCost> {
  try {
    return await getIssueCost(issueId);
  } catch {
    // TODO(integration): retirer ce repli dès que `getIssueCost` est exposé.
    return costOfBill(await getDebtBill(issueId));
  }
}

function CustomFieldValue({ locale, cost }: { locale: Locale; cost: IssueCost }): JSX.Element {
  if (cost.insufficient) return <Text>{t(locale, 'field.insufficient')}</Text>;
  if (cost.lowJp === 0 && cost.highJp === 0) return <Text>{t(locale, 'field.missing')}</Text>;
  return (
    <Fragment>
      <Text>{t(locale, 'field.title')}</Text>
      <Text>
        {t(locale, 'field.value', {
          range: formatRange(locale, cost.lowJp, cost.highJp),
          days: formatNumber(locale, cost.days),
        })}
      </Text>
    </Fragment>
  );
}

mountScreen(<CustomFieldScreen />);
