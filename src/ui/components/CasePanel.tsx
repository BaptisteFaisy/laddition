import { getDebtCase } from '../api';
import type { DebtCaseView } from '../api';
import { useResolver } from '../async';
import { formatNumber, pair } from '../format';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { Badge, Fragment, Heading, Stack, Text } from '../kit';
import { AsyncView } from './AsyncView';
import { RangeBadge } from './RangeBadge';
import { ReturnBlock } from './ReturnBlock';

/**
 * L'argumentaire d'une dette (DT-17, §7.6) : les chiffres de l'addition, les
 * limites de la méthode et le texte rédigé d'une page.
 *
 * Tout vient du résolveur `getDebtCase`, qui appelle `writeArgumentaire()` :
 * quand le modèle échoue, le gabarit déterministe prend le relais (`source`).
 * L'écran ne rédige rien et ne calcule rien — il affiche la page telle que le
 * serveur l'a construite, avec les mêmes chiffres que l'outil MCP.
 */
export function CasePanel({ locale, issueKey }: { locale: Locale; issueKey: string }): JSX.Element {
  const resolver = useResolver(`${issueKey}#${locale}`, issueKey === '' ? null : () => getDebtCase(issueKey, locale));
  return (
    <AsyncView
      state={resolver.state}
      locale={locale}
      retry={resolver.reload}
      render={(view) => <CaseBody locale={locale} view={view} />}
    />
  );
}

/** La page : identité, fourchette, retour, preuves, limites, texte rédigé. */
function CaseBody({ locale, view }: { locale: Locale; view: DebtCaseView }): JSX.Element {
  return (
    <Stack space="space.200">
      <Heading size="medium">{view.issueKey}</Heading>
      <Text>{view.summary}</Text>
      <Text>{pair(locale, t(locale, 'common.zone'), view.zone || t(locale, 'common.unclassified'))}</Text>
      <Text>{t(locale, 'panel.range', { days: formatNumber(locale, view.method.windowDays) })}</Text>
      <RangeBadge locale={locale} lowJp={view.lowJp} highJp={view.highJp} />
      <ReturnBlock locale={locale} bill={view.bill} />
      <Text>{t(locale, 'common.evidenceCount', { count: formatNumber(locale, view.evidence.length) })}</Text>
      {view.hiddenCount > 0 ? (
        <Text>{t(locale, 'panel.hidden', { count: formatNumber(locale, view.hiddenCount) })}</Text>
      ) : null}
      <Heading size="small">{t(locale, 'repay.caveats')}</Heading>
      {view.method.limits.map((limit) => (
        <Text key={limit}>{limit}</Text>
      ))}
      <CaseText locale={locale} view={view} />
    </Stack>
  );
}

/** Le texte rédigé : son origine (modèle ou gabarit), puis la page elle-même. */
function CaseText({ locale, view }: { locale: Locale; view: DebtCaseView }): JSX.Element {
  const fromModel = view.argumentaire.source === 'model';
  const sourceKey = fromModel ? 'phantom.draftSourceModel' : 'phantom.draftSourceTemplate';
  return (
    <Fragment>
      <Badge appearance={fromModel ? 'primary' : 'default'} text={t(locale, sourceKey)} />
      {plainLines(view.argumentaire.markdown).map((line, index) => (
        <Text key={`${index}:${line}`}>{line}</Text>
      ))}
    </Fragment>
  );
}

/** La page rédigée en texte lisible : titres et puces Markdown deviennent des lignes. */
function plainLines(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => line.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s*/, '• ').trim())
    .filter((line) => line !== '');
}
