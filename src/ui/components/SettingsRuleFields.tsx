import { Fragment, Option, Radio, RadioGroup, Select, TextField } from '@forge/ui';
import type { ProjectSettings } from '../../core/types.ts';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';
import { DEBT_RULE_KINDS, KIND_LABELS, ZONE_MODES, ZONE_MODE_LABELS } from '../settings-form-values.ts';

/** Définition de la dette, mode de zone, projets JSM (§14 écran 6). */
export function SettingsRuleFields({
  locale,
  settings,
}: {
  locale: Locale;
  settings: ProjectSettings;
}): JSX.Element {
  return (
    <Fragment>
      <Select name="debtRuleKind" label={t(locale, 'settings.debtRuleKind')}>
        {DEBT_RULE_KINDS.map((kind) => (
          <Option
            key={kind}
            label={t(locale, KIND_LABELS[kind])}
            value={kind}
            defaultSelected={settings.debtRule.kind === kind}
          />
        ))}
      </Select>
      <TextField
        name="debtRuleValue"
        label={t(locale, 'settings.debtRuleValue')}
        defaultValue={settings.debtRule.value}
      />
      <RadioGroup name="zoneMode" label={t(locale, 'settings.zoneMode')}>
        {ZONE_MODES.map((mode) => (
          <Radio key={mode} value={mode} label={t(locale, ZONE_MODE_LABELS[mode])} defaultChecked={settings.zoneMode === mode} />
        ))}
      </RadioGroup>
      <TextField
        name="zoneLabelField"
        label={t(locale, 'settings.zoneLabelField')}
        defaultValue={settings.zoneLabelField ?? ''}
      />
      <TextField
        name="jsmProjectKeys"
        label={t(locale, 'settings.jsmProjects')}
        defaultValue={settings.jsmProjectKeys.join(', ')}
      />
    </Fragment>
  );
}
