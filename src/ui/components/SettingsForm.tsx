import { useState } from 'react';
import type { ProjectSettings } from '../../core/types';
import { mergeSettings } from '../../core/settings';
import { saveSettings } from '../api';
import { errorMessage } from '../async';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { Banner, Form, Fragment, Text } from '../kit';
import { patchFromForm } from '../settings-form-values';
import { ErrorState } from './ErrorState';
import { SettingsNumbersFields } from './SettingsNumbersFields';
import { SettingsRuleFields } from './SettingsRuleFields';

/**
 * Les réglages, en un seul formulaire. Les valeurs saisies passent par
 * `mergeSettings`, qui borne tout : un réglage absurde ne casse aucun calcul.
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
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [failure, setFailure] = useState<string | null>(null);

  const update = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const submit = async () => {
    setStatus('saving');
    setFailure(null);
    try {
      await saveSettings(mergeSettings(settings, patchFromForm(draft)));
      setStatus('saved');
      onSaved();
    } catch (error) {
      setFailure(errorMessage(error));
      setStatus('failed');
    }
  };

  return (
    <Fragment>
      <Text>{t(locale, 'settings.body')}</Text>
      <Form onSubmit={submit} submitButtonText={t(locale, 'settings.save')}>
        <SettingsRuleFields locale={locale} values={settings} onChange={update} />
        <SettingsNumbersFields locale={locale} values={settings} onChange={update} />
      </Form>
      {status === 'saving' ? <Text>{t(locale, 'settings.saving')}</Text> : null}
      {status === 'saved' ? (
        <Banner appearance="success">
          <Text>{t(locale, 'settings.saved')}</Text>
        </Banner>
      ) : null}
      {status === 'failed' ? <ErrorState locale={locale} message={failure ?? ''} /> : null}
    </Fragment>
  );
}
