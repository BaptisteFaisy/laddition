import { Badge } from '../kit';
import type { Locale } from '../../i18n/index';
import { t } from '../../i18n/index';
import { formatRange } from '../format';

/**
 * La fourchette, telle qu'elle doit apparaître partout : deux bornes, ou
 * « données insuffisantes » quand la famille ne peut pas être chiffrée.
 */
export function RangeBadge({
  locale,
  lowJp,
  highJp,
  insufficient,
}: {
  locale: Locale;
  lowJp: number;
  highJp: number;
  insufficient?: boolean | undefined;
}): JSX.Element {
  if (insufficient) return <Badge appearance="removed" text={t(locale, 'common.insufficient')} />;
  const appearance = lowJp === highJp ? 'default' : 'primary';
  return <Badge appearance={appearance} text={formatRange(locale, lowJp, highJp)} />;
}
