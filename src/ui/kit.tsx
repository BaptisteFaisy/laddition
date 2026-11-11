import React, { Children, isValidElement } from 'react';
import {
  Badge as ForgeBadge,
  Box,
  Button as ForgeButton,
  DynamicTable,
  Heading,
  Label,
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
 */
export function Table({ children }: { children: React.ReactNode }): JSX.Element {
  let head: { cells: Array<{ content: React.ReactNode; key: string }> } | undefined;
  const rows: Array<{ key: string; cells: Array<{ content: React.ReactNode; key: string }> }> = [];
  let rowIndex = 0;

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { children?: React.ReactNode };
    if (child.type === Head) {
      head = { cells: cellsOf(props.children) };
    } else if (child.type === Row) {
      rows.push({ key: `r-${rowIndex}`, cells: cellsOf(props.children) });
      rowIndex += 1;
    } else if (child.type === Fragment) {
      Children.forEach(props.children, (nested) => {
        if (!isValidElement(nested) || nested.type !== Row) return;
        const nProps = nested.props as { children?: React.ReactNode };
        rows.push({ key: `r-${rowIndex}`, cells: cellsOf(nProps.children) });
        rowIndex += 1;
      });
    }
  });

  return <DynamicTable head={head} rows={rows} />;
}

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

export function Form({
  submitButtonText,
  onSubmit,
  children,
}: {
  submitButtonText: string;
  onSubmit: () => void | Promise<void>;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Stack space="space.150">
      {children}
      <Box>
        <ForgeButton appearance="primary" onClick={() => void onSubmit()}>
          {submitButtonText}
        </ForgeButton>
      </Box>
    </Stack>
  );
}
