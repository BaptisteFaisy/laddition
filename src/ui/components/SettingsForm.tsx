import { useState } from 'react';
import type { ProjectSettings } from '../../core/types';
import { mergeSettings } from '../../core/settings';
import { saveSettings } from '../api';
import type { Locale } from '../../i18n/index';
import { t } from '../../i18n/index';
import { formatNumber } from '../format';
import { Banner, Form, Fragment, Text, TextField } from '../kit';
import type { FieldProblem } from '../settings-form-values';
import { fieldLabel, patchFromForm, teamByZoneText, validatePatch } from '../settings-form-values';
import { useAction } from '../use-action';
import { ErrorState } from './ErrorState';
import { SettingsNumbersFields } from './SettingsNumbersFields';
import { SettingsRuleFields } from './SettingsRuleFields';
import type { FieldChange } from './SettingsRuleFields';

/**
 * Les réglages, en un seul formulaire (écran 6).
 *
 * La saisie est vérifiée **avant** l'envoi (item D59) : un champ invalide est
 * nommé et rien n'est enregistré, donc « Enregistré » n'est jamais un mensonge.
 * Le bouton est verrouillé pendant l'appel réseau.
 */
export function SettingsForm({
  locale,
  settings,
  onSaved,
}: {
  locale: Locale;
  settings: ProjectSettings;
  onSaved: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const action = useAction(
    async () => {
      await saveSettings(mergeSettings(settings, patchFromForm(draft)));
    },
    onSaved,
  );

  const update = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setProblems([]);
  };

  const submit = () => {
    const found = validatePatch(draft);
    setProblems(found);
    if (found.length > 0) return;
    action.start();
  };

  return (
    <Fragment>
      <Text>{t(locale, 'settings.body')}</Text>
      <Form onSubmit={submit} submitButtonText={t(locale, 'settings.save')} isDisabled={action.busy}>
        <SettingsRuleFields locale={locale} values={settings} onChange={update} />
        <TeamByZoneField locale={locale} values={settings} onChange={update} />
        <SettingsNumbersFields locale={locale} values={settings} onChange={update} />
      </Form>
      {action.busy ? <Text>{t(locale, 'settings.saving')}</Text> : null}
      {problems.length > 0 ? <InvalidList locale={locale} problems={problems} /> : null}
      {action.done && problems.length === 0 ? (
        <Banner appearance="success">
          <Text>{t(locale, 'settings.saved')}</Text>
        </Banner>
      ) : null}
      {action.failure ? <ErrorState locale={locale} message={action.failure} /> : null}
    </Fragment>
  );
}

/** Ce qui refuse la saisie, champ par champ : l'utilisateur sait quoi corriger. */
function InvalidList({ locale, problems }: { locale: Locale; problems: FieldProblem[] }): JSX.Element {
  return (
    <Banner appearance="error" title={t(locale, 'settings.invalid')}>
      {problems.map((problem) => (
        <Text key={`${problem.field}:${problem.kind}`}>{problemText(locale, problem)}</Text>
      ))}
    </Banner>
  );
}

/**
 * Quelle équipe porte chaque zone (item 8) : sans cette saisie, le « coût par
 * équipe » du gadget restait vide hors jeu d'exemple (DT-18).
 */
function TeamByZoneField({
  locale,
  values,
  onChange,
}: {
  locale: Locale;
  values: ProjectSettings;
  onChange: FieldChange;
}): JSX.Element {
  return (
    <TextField
      name="teamByZone"
      label={t(locale, 'settings.teamByZone')}
      defaultValue={teamByZoneText(values.teamByZone)}
      onChange={(value) => onChange('teamByZone', value)}
    />
  );
}

/** Phrase de refus d'un champ, dans la langue de l'écran. */
function problemText(locale: Locale, problem: FieldProblem): string {
  const field = t(locale, fieldLabel(problem.field));
  if (problem.kind === 'number') return t(locale, 'settings.invalidNumber', { field });
  if (problem.kind === 'required') return t(locale, 'settings.invalidRequired', { field });
  return t(locale, 'settings.invalidRange', {
    field,
    min: formatNumber(locale, problem.min),
    max: formatNumber(locale, problem.max),
  });
}
