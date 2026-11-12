#!/usr/bin/env node
/**
 * Contrôle de cohérence manifest ↔ code, sans connexion Atlassian (item F81/F82).
 *
 * `forge lint` et `forge build` exigent un login ; ce garde tourne en CI hors
 * ligne et échoue si :
 *   1. un `handler: index.X` du manifest ne correspond pas à un export réel
 *      de `src/index.tsx` (une régression casse le déploiement SANS erreur de
 *      compilation — d'où ce garde) ;
 *   2. le `path` d'une ressource déclarée n'existe pas sur disque ;
 *   3. un module d'écran UI Kit 2 (tout module portant une `resource`) ne
 *      porte pas `render: native` ;
 *   4. une clé de `modules.action` est absente de `rovo:mcp` (un outil MCP
 *      déclaré mais non exposé, ou l'inverse, est une régression).
 *
 * La validation contre le schéma JSON officiel reste dans
 * `tools/validate_manifest.mjs` ; les deux sont joués par la couche 0.
 *
 * Usage : node tools/check_manifest_exports.mjs [manifest.yml] [src/index.tsx]
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const manifestPath = path.resolve(process.argv[2] ?? 'manifest.yml');
const entryPath = process.argv[3] ?? 'src/index.tsx';

const problems = [];

function fail(message) {
  problems.push(message);
}

/** Types de modules dont chaque entrée porte une `resource` d'écran UI Kit 2. */
const SCREEN_MODULES = new Set([
  'jira:projectPage',
  'jira:issuePanel',
  'jira:issueContext',
  'jira:customField',
  'jira:dashboardGadget',
  'jira:projectSettingsPage',
  'jira:globalPage',
]);

function loadManifest() {
  if (!fs.existsSync(manifestPath)) {
    console.error(`KO — manifest introuvable : ${manifestPath}`);
    process.exit(1);
  }
  return yaml.load(fs.readFileSync(manifestPath, 'utf8'));
}

/** Noms exportés par le point d'entrée : `export const/function X` et `export { … }`. */
function exportedNames(source) {
  const names = new Set();
  const declared = /export\s+(?:declare\s+)?(?:const|let|var|function|async\s+function|class)\s+(\w+)/g;
  for (const match of source.matchAll(declared)) names.add(match[1]);
  const blocks = /export\s*\{([^}]*)\}/g;
  for (const block of source.matchAll(blocks)) {
    for (const raw of block[1].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const renamed = part.split(/\s+as\s+/);
      names.add((renamed[1] ?? renamed[0]).trim());
    }
  }
  return names;
}

/** 1. Chaque `handler: index.X` du manifest doit être un export de src/index.tsx. */
function checkHandlers(manifest, exports) {
  for (const entry of manifest.modules?.function ?? []) {
    const handler = entry?.handler ?? '';
    if (!handler.startsWith('index.')) {
      fail(`fonction « ${entry?.key} » : handler « ${handler} » ne pointe pas vers index.*`);
      continue;
    }
    const name = handler.slice('index.'.length);
    if (!exports.has(name)) {
      fail(`fonction « ${entry?.key} » : handler « ${handler} » sans export « ${name} » dans ${entryPath}`);
    }
  }
}

/** 2. Chaque ressource déclarée doit exister sur disque. */
function checkResourcePaths(manifest) {
  for (const resource of manifest.resources ?? []) {
    if (!resource?.path) continue;
    if (!fs.existsSync(path.resolve(path.dirname(manifestPath), resource.path))) {
      fail(`ressource « ${resource.key} » : chemin « ${resource.path} » absent du disque`);
    }
  }
}

/** 3. Chaque module d'écran UI Kit 2 doit porter `render: native`. */
function checkNativeRendering(manifest) {
  for (const [type, entries] of Object.entries(manifest.modules ?? {})) {
    if (!SCREEN_MODULES.has(type) || !Array.isArray(entries)) continue;
    for (const entry of entries) {
      // jira:customField porte l'écran sous `view` ; les autres directement.
      const screen = entry?.view ?? entry;
      if (!screen?.resource) continue;
      if (screen.render !== 'native') {
        fail(`${type} « ${entry?.key} » : écran sans \`render: native\` (trouvé : ${screen.render ?? 'rien'})`);
      }
    }
  }
}

/** 4. Chaque clé d'action doit être exposée dans rovo:mcp. */
function checkActionsInMcp(manifest) {
  const mcpTools = new Set(
    (manifest.modules?.['rovo:mcp'] ?? []).flatMap((item) => item.tools ?? []),
  );
  for (const action of manifest.modules?.action ?? []) {
    if (!mcpTools.has(action?.key)) {
      fail(`action « ${action?.key} » absente de rovo:mcp.tools`);
    }
  }
}

const manifest = loadManifest();
if (!fs.existsSync(entryPath)) {
  console.error(`KO — point d'entrée introuvable : ${entryPath}`);
  process.exit(1);
}
const exports = exportedNames(fs.readFileSync(entryPath, 'utf8'));

checkHandlers(manifest, exports);
checkResourcePaths(manifest);
checkNativeRendering(manifest);
checkActionsInMcp(manifest);

if (problems.length > 0) {
  for (const problem of problems) console.error('KO — ' + problem);
  console.error(`\n${problems.length} incohérence(s) manifest ↔ code.`);
  process.exit(1);
}
const actionCount = (manifest.modules?.action ?? []).length;
const functionCount = (manifest.modules?.function ?? []).length;
console.log(
  `OK — manifest ↔ code cohérent (${functionCount} handlers, ${actionCount} actions dans rovo:mcp, ressources présentes, render: native partout).`,
);
