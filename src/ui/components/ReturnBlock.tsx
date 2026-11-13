import { Fragment, Heading, Text } from '../kit';
import type { DebtBill } from '../../core/types';
import type { Locale, MessageKey, MessageVars } from '../i18n/index';
import { t } from '../i18n/index';
import { formatDays, formatJpUnit, formatRatio, pair } from '../format';
import { Disclosure } from './Disclosure';

/**
 * Clés des formules du retour : le lot i18n les ajoute au dictionnaire ; tant
 * qu'elles n'y sont pas, le texte composé (clés déjà présentes) s'affiche —
 * jamais une clé brute à l'écran.
 */
const ROI_FORMULA = 'panel.roi.formula' as MessageKey;
const PAYBACK_FORMULA = 'panel.payback.formula' as MessageKey;

/** Le retour (§11) : ce que la clôture rapporterait, ou pourquoi il n'est pas chiffré. */
export function ReturnBlock({ locale, bill }: { locale: Locale; bill: DebtBill }): JSX.Element {
  return (
    <Fragment>
      <Heading size="small">{t(locale, 'panel.return')}</Heading>
      {bill.repaymentJp === null ? (
        <Text>{t(locale, 'panel.noRepayment')}</Text>
      ) : (
        <Fragment>
          <Text>{pair(locale, t(locale, 'project.col.repayment'), formatJpUnit(locale, bill.repaymentJp))}</Text>
          <Text>{pair(locale, t(locale, 'panel.avoidable'), formatJpUnit(locale, bill.avoidableJp))}</Text>
          <Text>
            {pair(locale, t(locale, 'panel.roi'), `${formatRatio(locale, bill.roiLow)} – ${formatRatio(locale, bill.roiHigh)}`)}
          </Text>
          <RoiMethod locale={locale} bill={bill} />
          <Text>{pair(locale, t(locale, 'panel.payback'), formatDays(locale, bill.paybackDays))}</Text>
          <PaybackMethod locale={locale} bill={bill} />
        </Fragment>
      )}
    </Fragment>
  );
}

/** Divulgation du retour : sa formule et ses entrées (§5 principe 1, §18). */
function RoiMethod({ locale, bill }: { locale: Locale; bill: DebtBill }): JSX.Element {
  const composed = `${t(locale, 'panel.roi')} = ${t(locale, 'panel.avoidable')} ÷ ${t(locale, 'project.col.repayment')}`;
  return (
    <Disclosure label={t(locale, 'common.showFormula')} labelOpen={t(locale, 'common.hideFormula')}>
      <Fragment>
        <Text>{formulaText(locale, ROI_FORMULA, composed)}</Text>
        <Text>{input(locale, t(locale, 'panel.avoidable'), formatJpUnit(locale, bill.avoidableJp))}</Text>
        <Text>{input(locale, t(locale, 'project.col.repayment'), formatJpUnit(locale, bill.repaymentJp))}</Text>
        <Text>
          {input(
            locale,
            t(locale, 'panel.roi'),
            `${formatRatio(locale, bill.roiLow)} – ${formatRatio(locale, bill.roiHigh)}`,
          )}
        </Text>
      </Fragment>
    </Disclosure>
  );
}

/** Divulgation du délai de retour : sa formule et ses entrées (§5 principe 1, §18). */
function PaybackMethod({ locale, bill }: { locale: Locale; bill: DebtBill }): JSX.Element {
  const weekly = weeklyCost(bill);
  const composed = `${t(locale, 'panel.payback')} = ${t(locale, 'project.col.repayment')} ÷ ${formatJpUnit(locale, weekly)} × 7`;
  return (
    <Disclosure label={t(locale, 'common.showFormula')} labelOpen={t(locale, 'common.hideFormula')}>
      <Fragment>
        <Text>{formulaText(locale, PAYBACK_FORMULA, composed, { weekly: formatJpUnit(locale, weekly) })}</Text>
        <Text>{input(locale, t(locale, 'project.col.repayment'), formatJpUnit(locale, bill.repaymentJp))}</Text>
        <Text>{input(locale, t(locale, 'panel.payback'), formatDays(locale, bill.paybackDays))}</Text>
      </Fragment>
    </Disclosure>
  );
}

/**
 * Formule d'un chiffre : la clé du dictionnaire si elle y est, sinon le texte
 * composé avec les clés déjà présentes (§5 principe 1).
 */
function formulaText(locale: Locale, key: MessageKey, composed: string, vars?: MessageVars): string {
  const text = t(locale, key, vars);
  return text === key ? composed : text;
}

/** Une entrée d'une formule : « nom : valeur », sans libellé inventé. */
function input(locale: Locale, name: string, value: string): string {
  return t(locale, 'method.coefficientLine', { name, value });
}

/** Coût hebdomadaire moyen du ticket : l'entrée du délai de retour (§11). */
function weeklyCost(bill: DebtBill): number | null {
  if (bill.repaymentJp === null || bill.paybackDays === null || bill.paybackDays <= 0) return null;
  return (bill.repaymentJp * 7) / bill.paybackDays;
}
