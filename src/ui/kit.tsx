import React, { Children, isValidElement } from 'react';
import { createTableParser, markTableRow } from './table-parse';
import {
  Badge as ForgeBadge,
  Box,
  Button as ForgeButton,
  DynamicTable,
  Form as ForgeForm,
  FormFooter,
  FormSection,
  Heading,
  Label,
  Link as ForgeLink,
  ProgressBar as ForgeProgressBar,
  RadioGroup as ForgeRadioGroup,
  SectionMessage,
  Select as ForgeSelect,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs as ForgeTabs,
  Text,
  Textfield,
} from '@forge/react';

/**
 * Façade UI Kit 2 (`@forge/react`).
 *
 * Les écrans et les sous-composants n'importent jamais `@forge/ui` (UI Kit 1) :
 * `kit.tsx` fournit les briques à grain constant (`Table`, `Tabs`, `TextField`,
 * `Select`, `RadioGroup`, `Form`) au-dessus des primitives natives Atlassian.
 */

export { Box, Heading, Spinner, Stack, Text };

export const Fragment = React.Fragment;

/**
 * Lien cliquable vers un ticket ou un projet (item D50).
 *
 * Toute clé de ticket affichée passe par là : une adresse Jira n'est jamais
 * composée dans un écran. En UI Kit 2, le libellé d'un `Link` est du texte.
 */
export function Link({
  href,
  children,
  openNewTab,
}: {
  href: string;
  children: string;
  openNewTab?: boolean;
}): JSX.Element {
  return (
    <ForgeLink href={href} openNewTab={openNewTab}>
      {children}
    </ForgeLink>
  );
}

/** Barre de progression : l'initialisation se lit d'un coup d'œil (item D46). */
export function ProgressBar({
  value,
  ariaLabel,
  isIndeterminate,
}: {
  value?: number;
  ariaLabel?: string;
  isIndeterminate?: boolean;
}): JSX.Element {
  return <ForgeProgressBar value={value} ariaLabel={ariaLabel} isIndeterminate={isIndeterminate} />;
}

/** En UI Kit 2, `Badge` porte un nombre ; pour un texte, `Lozenge` est natif. */
export function Badge({
  appearance = 'default',
  text,
  children,
}: {
  appearance?: 'added' | 'default' | 'important' | 'primary' | 'primaryInverted' | 'removed';
  text?: string;
  children?: React.ReactNode;
}): JSX.Element {
  return <ForgeBadge appearance={appearance}>{children ?? text}</ForgeBadge>;
}

/**
 * Bouton compatible UI Kit 1 (`text`/`disabled`) et UI Kit 2 (`children`/`isDisabled`),
 * pour garder des composants concis sans réécrire chaque appelant.
 */
export function Button({
  text,
  children,
  disabled,
  isDisabled,
  appearance,
  onClick,
}: {
  text?: string;
  children?: React.ReactNode;
  disabled?: boolean;
  isDisabled?: boolean;
  appearance?: 'default' | 'primary' | 'subtle' | 'warning' | 'danger' | 'link' | 'subtle-link';
  onClick?: () => void;
}): JSX.Element {
  const mapped = appearance === 'link' || appearance === 'subtle-link' ? 'subtle' : appearance;
  return (
    <ForgeButton appearance={mapped} isDisabled={isDisabled ?? disabled} onClick={onClick}>
      {children ?? text}
    </ForgeButton>
  );
}

/** Enveloppes de module : en UI Kit 2, le conteneur est fourni par Jira. */
export function ProjectPage({ children }: { children: React.ReactNode }): JSX.Element {
  return <Stack space="space.200">{children}</Stack>;
}
export const IssuePanel = ProjectPage;
export const IssueContext = ProjectPage;
export const CustomField = ProjectPage;
export const DashboardGadget = ProjectPage;
export const ProjectSettingsPage = ProjectPage;

/** Bandeau d'alerte ou d'information. */
export function Banner({
  appearance = 'information',
  title,
  children,
}: {
  appearance?: 'information' | 'warning' | 'error' | 'success' | 'discovery';
  title?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <SectionMessage appearance={appearance} title={title}>
      {children}
    </SectionMessage>
  );
}

/* ------------------------------------------------------------------ Table */

export function Head({ children }: { children: React.ReactNode }): JSX.Element {
  return <Fragment>{children}</Fragment>;
}

export function Row({ children }: { children: React.ReactNode }): JSX.Element {
  return <Fragment>{children}</Fragment>;
}

export function Cell({ children }: { children: React.ReactNode }): JSX.Element {
  return <Fragment>{children}</Fragment>;
}

/** Le parseur de tableaux : il connaît les composants `Head` et `Row` ci-dessus. */
const { parseTable } = createTableParser({ Head, Row });

export { markTableRow };

function cellsOf(node: React.ReactNode): Array<{ content: React.ReactNode; key: string }> {
  const cells: Array<{ content: React.ReactNode; key: string }> = [];
  Children.forEach(node, (child, index) => {
    if (!isValidElement(child)) return;
    const content = (child.props as { children?: React.ReactNode }).children ?? null;
    cells.push({ key: `c-${index}`, content });
  });
  return cells;
}

/**
 * Tableau UI Kit 2 à partir des balises déclaratives `<Head>` / `<Row>` / `<Cell>`.
 * Convertit l'arbre JSX en `{ head, rows }` attendus par `DynamicTable`.
 *
 * `caption`, `label` et `empty` donnent au tableau sa sémantique accessible et
 * son état vide (item D61) : un chiffre doit dire ce qu'il liste.
 */
export function Table({
  children,
  caption,
  label,
  empty,
}: {
  children: React.ReactNode;
  caption?: string;
  label?: string;
  empty?: string;
}): JSX.Element {
  const parsed = parseTable(children);
  return (
    <DynamicTable
      head={parsed.head}
      rows={parsed.rows}
      caption={caption}
      label={label ?? caption}
      emptyView={empty ? <Text>{empty}</Text> : undefined}
    />
  );
}

type ParsedTable = {
  head: { cells: Array<{ content: React.ReactNode; key: string }> } | undefined;
  rows: Array<{ key: string; cells: Array<{ content: React.ReactNode; key: string }> }>;
};

/** Lit l'arbre JSX du tableau : un `Head`, puis autant de `Row` que déclarés. */
/* ------------------------------------------------------------------- Tabs */

export function TabEntry({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return <Fragment>{children}</Fragment>;
}

/** Onglets UI Kit 2 : accepte des enfants `<TabEntry label="...">...</TabEntry>`. */
export function Tabs({ id, children }: { id: string; children: React.ReactNode }): JSX.Element {
  const entries: Array<{ label: string; body: React.ReactNode }> = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { label?: string; children?: React.ReactNode };
    entries.push({ label: props.label ?? '', body: props.children });
  });
  return (
    <ForgeTabs id={id}>
      <TabList>
        {entries.map((entry, idx) => (
          <Tab key={`t-${idx}`}>{entry.label}</Tab>
        ))}
      </TabList>
      {entries.map((entry, idx) => (
        <TabPanel key={`p-${idx}`}>{entry.body}</TabPanel>
      ))}
    </ForgeTabs>
  );
}

/* ------------------------------------------------------------------- Form */

export type SelectOption = { label: string; value: string };

export function TextField({
  name,
  label,
  defaultValue = '',
  onChange,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <Stack space="space.050">
      <Label labelFor={name}>{label}</Label>
      <Textfield
        id={name}
        name={name}
        defaultValue={defaultValue}
        onChange={(event) => onChange(event.target.value)}
      />
    </Stack>
  );
}

export function SelectField({
  name,
  label,
  options,
  value,
  onChange,
}: {
  name: string;
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const current = options.find((item) => item.value === value) ?? options[0];
  return (
    <Stack space="space.050">
      <Label labelFor={name}>{label}</Label>
      <ForgeSelect
        id={name}
        name={name}
        options={options}
        value={current}
        onChange={(picked) => {
          const next = picked as SelectOption | null;
          if (next?.value) onChange(next.value);
        }}
      />
    </Stack>
  );
}

export function RadioField({
  name,
  label,
  options,
  value,
  onChange,
}: {
  name: string;
  label: string;
  options: Array<{ name: string; label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <Stack space="space.050">
      <Label labelFor={name}>{label}</Label>
      <ForgeRadioGroup
        name={name}
        options={options}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Stack>
  );
}

/**
 * Formulaire UI Kit 2 (`Form` + `FormSection` + `FormFooter`) : la sémantique
 * de formulaire vient du composant natif, pas d'un bouton posé à côté (item D60).
 * `isDisabled` verrouille l'envoi pendant l'appel réseau (item D59).
 */
export function Form({
  submitButtonText,
  onSubmit,
  children,
  isDisabled,
}: {
  submitButtonText: string;
  onSubmit: () => void | Promise<void>;
  children: React.ReactNode;
  isDisabled?: boolean;
}): JSX.Element {
  return (
    <ForgeForm
      onSubmit={async () => {
        await onSubmit();
      }}
    >
      <FormSection>
        <Stack space="space.150">{children}</Stack>
      </FormSection>
      <FormFooter>
        <ForgeButton type="submit" appearance="primary" isDisabled={isDisabled}>
          {submitButtonText}
        </ForgeButton>
      </FormFooter>
    </ForgeForm>
  );
}
