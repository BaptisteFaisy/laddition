import { Form, Fragment, SectionMessage, Text, useState } from '@forge/ui';
import type { ProjectSettings } from '../../core/types.ts';
import { mergeSettings } from '../../core/settings.ts';
import { saveSettings } from '../api.ts';
import { errorMessage } from '../async.ts';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';
import { patchFromForm } from '../settings-form-values.ts';
import { ErrorState } from './ErrorState.tsx';
import { SettingsNumbersFields } from './SettingsNumbersFields.tsx';
import { SettingsRuleFields } from './SettingsRuleFields.tsx';

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
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (data: Record<string, unknown>) => {
    setStatus('saving');
    setFailure(null);
    try {
      await saveSettings(mergeSettings(settings, patchFromForm(data)));
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
        <SettingsRuleFields locale={locale} settings={settings} />
        <SettingsNumbersFields locale={locale} settings={settings} />
      </Form>
      {status === 'saving' ? <Text>{t(locale, 'settings.saving')}</Text> : null}
      {status === 'saved' ? (
        <SectionMessage appearance="confirmation">
          <Text>{t(locale, 'settings.saved')}</Text>
        </SectionMessage>
      ) : null}
      {status === 'failed' ? <ErrorState locale={locale} message={failure ?? ''} /> : null}
    </Fragment>
  );
}
