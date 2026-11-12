import type { ProjectSettings } from '../../core/types';
import type { Locale } from '../i18n/index';
import { t } from '../i18n/index';
import { Fragment, TextField } from '../kit';
import { numberFields } from '../settings-form-values';

/** Journée de travail, fenêtre, coefficients et taux journalier : une seule boucle. */
export function SettingsNumbersFields({
  locale,
  values,
  onChange,
}: {
  locale: Locale;
  values: ProjectSettings;
  onChange: (key: string, value: string) => void;
}): JSX.Element {
  return (
    <Fragment>
      {numberFields(values).map((field) => (
        <TextField
          key={field.name}
          name={field.name}
          label={t(locale, field.label)}
          defaultValue={String(field.value)}
          onChange={(value) => onChange(field.name, value)}
        />
      ))}
    </Fragment>
  );
}
