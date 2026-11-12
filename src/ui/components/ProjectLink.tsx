import { Fragment, Link, Text } from '../kit';
import { canLink, projectUrl } from '../links';
import { useSiteUrl } from '../site-url';

/**
 * Lien vers un projet, pour les écrans qui n'ont pas de contexte de projet
 * (le gadget, item D49). Sans adresse de site, le libellé reste lisible.
 */
export function ProjectLink({ projectKey, label }: { projectKey: string; label: string }): JSX.Element {
  const siteUrl = useSiteUrl();
  if (!canLink(siteUrl, projectKey)) return <Text>{label}</Text>;
  return (
    <Fragment>
      <Link href={projectUrl(siteUrl, projectKey)} openNewTab>
        {label}
      </Link>
    </Fragment>
  );
}
