import { useState } from 'react';
import { Button, Fragment, Heading, RadioField, SelectField, Text, TextField } from '../kit';
import type { DebtRuleKind, ProjectSettings, ZoneMode } from '../../core/types';
import { mergeSettings } from '../../core/settings';
import { saveSettings } from '../api';
import type { Locale } from '../../i18n/index';
import { t } from '../../i18n/index';
import { useAction } from '../use-action';
import {
  DEBT_RULE_KINDS,
  KIND_LABELS,
  ZONE_MODES,
  ZONE_MODE_LABELS,
  debtRuleKindOf,
  zoneModeOf,
} from '../settings-form-values';
import { BootstrapRun } from './BootstrapRun';
import { ErrorState } from './ErrorState';

/**
 * Assistant d'initialisation (§22 « données réelles du site », item D46).
 *
 * Trois étapes : désigner la dette, choisir le mode de zone, lancer la lecture
 * de l'historique. Chaque étape enregistre ses réglages avant de passer à la
 * suivante, et la dernière montre l'avancement réel.
 */
export function BootstrapWizard({
  locale,
  projectId,
  settings,
  onSaved,
}: {
  locale: Locale;
  projectId: string;
  settings: ProjectSettings;
  onSaved: () => void;
}): JSX.Element {
  const [step, setStep] = useState(1);
  return (
    <Fragment>
      <Heading size="medium">{t(locale, 'setup.title')}</Heading>
      <Text>{t(locale, 'setup.body')}</Text>
      <Text>{t(locale, 'setup.note')}</Text>
      <Text>{t(locale, 'setup.step', { current: step, total: 3 })}</Text>
      {step === 1 ? (
        <StepDebtRule
          locale={locale}
          settings={settings}
          onDone={() => {
            onSaved();
            setStep(2);
          }}
        />
      ) : null}
      {step === 2 ? (
        <StepZoneMode
          locale={locale}
          settings={settings}
          onBack={() => setStep(1)}
          onDone={() => {
            onSaved();
            setStep(3);
          }}
        />
      ) : null}
      {step === 3 ? <BootstrapRun locale={locale} projectId={projectId} onBack={() => setStep(2)} /> : null}
    </Fragment>
  );
}

/** Étape 1 : désigner la dette (règle du projet, DT-01). */
function StepDebtRule({
  locale,
  settings,
  onDone,
}: {
  locale: Locale;
  settings: ProjectSettings;
  onDone: () => void;
}): JSX.Element {
  const [kind, setKind] = useState<DebtRuleKind>(settings.debtRule.kind);
  const [value, setValue] = useState(settings.debtRule.value);
  const invalid = value.trim() === '';
  const action = useAction(
    async () => {
      await saveSettings(mergeSettings(settings, { debtRule: { kind, value: value.trim() } }));
    },
    onDone,
  );
  const options = debtRuleOptions(locale);
  return (
    <Fragment>
      <Heading size="small">{t(locale, 'setup.step1')}</Heading>
      <Text>{t(locale, 'settings.debtRule')}</Text>
      <SelectField
        name="setupDebtRuleKind"
        label={t(locale, 'settings.debtRuleKind')}
        options={options}
        value={kind}
        onChange={(next) => setKind(debtRuleKindOf(next))}
      />
      <TextField
        name="setupDebtRuleValue"
        label={t(locale, 'settings.debtRuleValue')}
        defaultValue={value}
        onChange={setValue}
      />
      {invalid ? (
        <Text>{t(locale, 'settings.invalidRequired', { field: t(locale, 'settings.debtRuleValue') })}</Text>
      ) : null}
      {action.failure ? <ErrorState locale={locale} message={action.failure} /> : null}
      <Button
        text={action.busy ? t(locale, 'setup.saving') : t(locale, 'setup.saveAndNext')}
        disabled={action.busy || invalid}
        onClick={action.start}
      />
    </Fragment>
  );
}

/** Étape 2 : choisir le mode de zone (§8). */
function StepZoneMode({
  locale,
  settings,
  onBack,
  onDone,
}: {
  locale: Locale;
  settings: ProjectSettings;
  onBack: () => void;
  onDone: () => void;
}): JSX.Element {
  const [mode, setMode] = useState<ZoneMode>(settings.zoneMode);
  const [labelField, setLabelField] = useState(settings.zoneLabelField ?? '');
  const action = useAction(
    async () => {
      await saveSettings(mergeSettings(settings, { zoneMode: mode, zoneLabelField: labelField }));
    },
    onDone,
  );
  const options = zoneModeOptions(locale);
  return (
    <Fragment>
      <Heading size="small">{t(locale, 'setup.step2')}</Heading>
      <RadioField
        name="setupZoneMode"
        label={t(locale, 'settings.zoneMode')}
        options={options}
        value={mode}
        onChange={(next) => setMode(zoneModeOf(next))}
      />
      {mode === 'label' ? (
        <TextField
          name="setupZoneLabelField"
          label={t(locale, 'settings.zoneLabelField')}
          defaultValue={labelField}
          onChange={setLabelField}
        />
      ) : null}
      {action.failure ? <ErrorState locale={locale} message={action.failure} /> : null}
      <Button
        text={action.busy ? t(locale, 'setup.saving') : t(locale, 'setup.saveAndNext')}
        disabled={action.busy}
        onClick={action.start}
      />
      <Button appearance="subtle" text={t(locale, 'setup.back')} onClick={onBack} />
    </Fragment>
  );
}

/** Options de la règle de dette : les mêmes que sur l'écran de réglages. */
function debtRuleOptions(locale: Locale): Array<{ label: string; value: string }> {
  return DEBT_RULE_KINDS.map((kind) => ({ label: t(locale, KIND_LABELS[kind]), value: kind }));
}

/** Options du mode de zone : les mêmes que sur l'écran de réglages. */
function zoneModeOptions(locale: Locale): Array<{ name: string; label: string; value: string }> {
  return ZONE_MODES.map((mode) => ({
    name: 'setupZoneMode',
    label: t(locale, ZONE_MODE_LABELS[mode]),
    value: mode,
  }));
}
