import { Fragment, Text } from '@forge/ui';
import type { DataQuality, ProjectSettings } from '../../core/types.ts';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';
import { formatNumber } from '../format.ts';
import { MethodCoefficients } from './MethodCoefficients.tsx';
import { MethodFormulas } from './MethodFormulas.tsx';
import { MethodQuality } from './MethodQuality.tsx';

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
    </Fragment>
  );
}
