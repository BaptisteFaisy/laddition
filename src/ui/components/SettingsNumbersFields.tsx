import { Fragment, TextField } from '@forge/ui';
import type { ProjectSettings } from '../../core/types.ts';
import type { Locale } from '../i18n/index.ts';
import { t } from '../i18n/index.ts';
import { numberFields } from '../settings-form-values.ts';

/** Journée de travail, fenêtre et coefficients : douze nombres, une seule boucle. */
export function SettingsNumbersFields({
  locale,
  settings,
}: {
  locale: Locale;
  settings: ProjectSettings;
}): JSX.Element {
  return (
    <Fragment>
      {numberFields(settings).map((field) => (
        <TextField
          key={field.name}
          type="number"
          name={field.name}
          label={t(locale, field.label)}
          defaultValue={field.value}
        />
      ))}
    </Fragment>
  );
}
