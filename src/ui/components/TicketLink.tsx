import { Fragment, Link, Text } from '../kit';
import { canLink, issueUrl } from '../links';
import { useSiteUrl } from '../site-url';

/**
 * Une clé de ticket cliquable (item D50, recette §20 n°6).
 *
 * Partout où une clé de dette, de preuve, de remboursement ou de brouillon
 * apparaît, c'est ce composant qui la rend : une seule façon d'ouvrir un
 * ticket, jamais une adresse composée dans un écran. Sans adresse de site, la
 * clé reste lisible en texte.
 */
export function TicketLink({ issueKey, label }: { issueKey: string; label?: string }): JSX.Element {
  const siteUrl = useSiteUrl();
  const text = label ?? issueKey;
  if (!canLink(siteUrl, issueKey)) return <Text>{text}</Text>;
  return (
    <Fragment>
      <Link href={issueUrl(siteUrl, issueKey)} openNewTab>
        {text}
      </Link>
    </Fragment>
  );
}
