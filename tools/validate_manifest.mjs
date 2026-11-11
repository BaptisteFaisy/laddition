#!/usr/bin/env node
/**
 * Valide manifest.yml contre le schéma JSON officiel de Forge.
 *
 * `forge lint` demande une connexion Atlassian ; ce validateur-ci tourne
 * hors ligne et couvre exactement ce qui casse le plus souvent : un module
 * mal nommé, un champ requis manquant, une action sans `title`.
 *
 * Usage : node tools/validate_manifest.mjs [manifest.yml]
 */
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import yaml from 'js-yaml';

const manifestPath = path.resolve(process.argv[2] ?? 'manifest.yml');
const schemaPath = path.resolve(
  'node_modules/@forge/manifest/out/schema/manifest-schema.json',
);

function fail(message) {
  console.error('KO — ' + message);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) fail(`manifest introuvable : ${manifestPath}`);
if (!fs.existsSync(schemaPath)) fail(`schéma Forge introuvable : ${schemaPath} (npm ci ?)`);

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

if (!validate(manifest)) {
  const errors = (validate.errors ?? []).slice(0, 30);
  console.error(`KO — ${validate.errors?.length ?? 0} erreur(s) de schéma :`);
  for (const error of errors) {
    console.error(`  - ${error.instancePath || '(racine)'} : ${error.message}`);
  }
  process.exit(1);
}

const modules = Object.keys(manifest.modules ?? {});
const actionKeys = new Set((manifest.modules?.action ?? []).map((item) => item.key));
const mcpTools = (manifest.modules?.['rovo:mcp'] ?? []).flatMap((item) => item.tools ?? []);
const unknownTools = mcpTools.filter((tool) => !actionKeys.has(tool));

if (unknownTools.length > 0) {
  fail(`outils MCP sans action correspondante : ${unknownTools.join(', ')}`);
}

const resourceKeys = new Set((manifest.resources ?? []).map((item) => item.key));
const missingResources = [];
for (const module of Object.values(manifest.modules ?? {})) {
  if (!Array.isArray(module)) continue;
  for (const entry of module) {
    if (entry?.resource && !resourceKeys.has(entry.resource)) missingResources.push(entry.resource);
  }
}
if (missingResources.length > 0) {
  fail(`ressources déclarées mais absentes de la section resources : ${missingResources.join(', ')}`);
}

console.log(`OK — manifest valide (${modules.length} modules, ${actionKeys.size} actions, ${mcpTools.length} outils MCP).`);
