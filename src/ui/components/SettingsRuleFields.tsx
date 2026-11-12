import type { ProjectSettings } from '../../core/types';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { Fragment, Heading, RadioField, SelectField, TextField } from '../kit';
import { DEBT_RULE_KINDS, KIND_LABELS, ZONE_MODES, ZONE_MODE_LABELS } from '../settings-form-values';

export type FieldChange = (key: string, value: string) => void;

/** Définition de la dette, mode de zone, projets JSM (§14 écran 6). */
export function SettingsRuleFields({
  locale,
  values,
  onChange,
}: {
  locale: Locale;
  values: ProjectSettings;
  onChange: FieldChange;
}): JSX.Element {
  return (
    <Fragment>
      <Heading size="small">{t(locale, 'settings.debtRule')}</Heading>
      <DebtRuleFields locale={locale} values={values} onChange={onChange} />
      <ZoneModeFields locale={locale} values={values} onChange={onChange} />
    </Fragment>
  );
}

/** Comment un ticket devient une dette : type, étiquette ou requête JQL (DT-01). */
function DebtRuleFields({
  locale,
  values,
  onChange,
}: {
  locale: Locale;
  values: ProjectSettings;
  onChange: FieldChange;
}): JSX.Element {
  const options = DEBT_RULE_KINDS.map((kind) => ({
    label: t(locale, KIND_LABELS[kind]),
    value: kind,
  }));
  return (
    <Fragment>
      <SelectField
        name="debtRuleKind"
        label={t(locale, 'settings.debtRuleKind')}
        options={options}
        value={values.debtRule.kind}
        onChange={(value) => onChange('debtRuleKind', value)}
      />
      <TextField
        name="debtRuleValue"
        label={t(locale, 'settings.debtRuleValue')}
        defaultValue={values.debtRule.value}
        onChange={(value) => onChange('debtRuleValue', value)}
      />
    </Fragment>
  );
}

/** Comment un ticket est rattaché à une zone (§8), et les projets JSM suivis. */
function ZoneModeFields({
  locale,
  values,
  onChange,
}: {
  locale: Locale;
  values: ProjectSettings;
  onChange: FieldChange;
}): JSX.Element {
  const options = ZONE_MODES.map((mode) => ({
    name: 'zoneMode',
    label: t(locale, ZONE_MODE_LABELS[mode]),
    value: mode,
  }));
  return (
    <Fragment>
      <RadioField
        name="zoneMode"
        label={t(locale, 'settings.zoneMode')}
        options={options}
        value={values.zoneMode}
        onChange={(value) => onChange('zoneMode', value)}
      />
      <TextField
        name="zoneLabelField"
        label={t(locale, 'settings.zoneLabelField')}
        defaultValue={values.zoneLabelField ?? ''}
        onChange={(value) => onChange('zoneLabelField', value)}
      />
      <TextField
        name="jsmProjectKeys"
        label={t(locale, 'settings.jsmProjects')}
        defaultValue={values.jsmProjectKeys.join(', ')}
        onChange={(value) => onChange('jsmProjectKeys', value)}
      />
    </Fragment>
  );
}
