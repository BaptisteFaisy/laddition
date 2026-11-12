import { Fragment, Text } from '../kit';
import type { ProjectSettings, ZoneCost } from '../../core/types';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { FamilyCostLines } from './FamilyCostLines';
import { FormulaList } from './FormulaList';

/**
 * La ventilation d'une zone : une ligne par famille, puis les formules.
 *
 * Une famille non chiffrable affiche « données insuffisantes » au lieu d'un
 * zéro (item D56), et chaque famille donne sa formule (item D55).
 */
export function ZoneFamilies({
  locale,
  zone,
  settings,
}: {
  locale: Locale;
  zone: ZoneCost;
  settings: ProjectSettings;
}): JSX.Element {
  return (
    <Fragment>
      <FamilyCostLines locale={locale} byFamily={zone.byFamily} insufficientByFamily={zone.insufficientByFamily} />
      <Text>{t(locale, 'family.note.C5')}</Text>
      <Text>{t(locale, 'family.note.C3', { count: settings.minBaselineSample })}</Text>
      <FormulaList locale={locale} />
    </Fragment>
  );
}
