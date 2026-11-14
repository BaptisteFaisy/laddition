import { Fragment, Text } from '../kit';
import type { DataQuality, ProjectSettings } from '../../core/types';
import type { Locale } from '../../i18n/index';
import { t } from '../../i18n/index';
import { formatNumber } from '../format';
import { MethodCoefficients } from './MethodCoefficients';
import { MethodFormulas } from './MethodFormulas';
import { MethodQuality } from './MethodQuality';

/**
 * Onglet Méthode (§14) : les formules, les coefficients en vigueur et la
 * qualité des données. C'est la réponse à « d'où sort ce chiffre ? ».
 */
export function MethodTab({
  locale,
  settings,
  quality,
}: {
  locale: Locale;
  settings: ProjectSettings;
  quality: DataQuality;
}): JSX.Element {
  return (
    <Fragment>
      <Text>{t(locale, 'method.title')}</Text>
      <Text>{t(locale, 'method.body')}</Text>
      <Text>
        {t(locale, 'method.window', {
          days: formatNumber(locale, settings.windowDays),
          hours: formatNumber(locale, settings.hoursPerDay),
          daysPerWeek: formatNumber(locale, settings.daysPerWeek),
        })}
      </Text>
      <MethodFormulas locale={locale} settings={settings} />
      <MethodCoefficients locale={locale} settings={settings} />
      <MethodQuality locale={locale} quality={quality} />
      {quality.historyTruncated ? <Text>{partialDataNotice(locale, 'history')}</Text> : null}
      {quality.scoresTruncated ? <Text>{partialDataNotice(locale, 'scores')}</Text> : null}
    </Fragment>
  );
}

/**
 * Avertissement de donnée partielle (C41, C44) : affiché sous la qualité,
 * jamais en note de bas de page — une durée calculée sur un historique ou un
 * échantillon partiel doit se voir là où l'on explique la méthode.
 *
 * Les fichiers i18n sont hors de ce lot : les clés `method.partial.*`
 * prendront le relais quand le lot traduction les ajoutera ; en attendant le
 * texte bilingue vit ici, et nulle part ailleurs.
 */
function partialDataNotice(locale: Locale, kind: 'history' | 'scores'): string {
  const messages: Record<'history' | 'scores', Record<Locale, string>> = {
    history: {
      fr: 'Historique tronqué : au moins un ticket a un historique de statuts incomplet, ses durées sont calculées sur une base partielle.',
      en: 'Truncated history: at least one issue has an incomplete status history, so its durations are computed on a partial basis.',
    },
    scores: {
      fr: 'Scores tronqués : le budget du modèle a été atteint, certains couples preuve/dette ne sont pas notés.',
      en: 'Truncated scores: the model budget was reached, so some evidence/debt pairs are unscored.',
    },
  };
  return messages[kind][locale];
}
