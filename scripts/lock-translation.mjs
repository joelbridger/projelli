#!/usr/bin/env node
// Mark a translation key as human-reviewed so the LLM script will not
// overwrite it on the next `npm run translate-i18n` run.
//
// Usage:
//   node scripts/lock-translation.mjs <locale> <key>
//
// Example:
//   node scripts/lock-translation.mjs es common.actions.save
//
// The locale file is rewritten in place. The key must already exist in the
// locale file (run translate-i18n first if missing). A `__locked` sibling
// is added at the same nesting level using the double-underscore convention
// documented in src/locales/README.md.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), '..');

const SUPPORTED_LOCALES = ['es', 'de'];

function usage(message) {
  if (message) process.stderr.write(`error: ${message}\n\n`);
  process.stderr.write(
    'Usage: node scripts/lock-translation.mjs <locale> <key>\n' +
      `  locale: one of ${SUPPORTED_LOCALES.join(', ')}\n` +
      '  key:    dotted path, e.g. common.actions.save\n',
  );
  process.exit(message ? 1 : 0);
}

const [, , locale, key] = process.argv;

if (!locale || !key) usage('missing arguments');
if (!SUPPORTED_LOCALES.includes(locale)) usage(`unsupported locale: ${locale}`);
if (!key.includes('.')) usage(`key must be dotted, got: ${key}`);

function hasLeaf(data, dottedKey) {
  return dottedKey.split('.').reduce(
    (value, segment) => value && typeof value === 'object' ? value[segment] : undefined,
    data,
  ) !== undefined;
}

function discoverLocalePaths(targetLocale) {
  const paths = [join(ROOT, 'src/locales', `${targetLocale}.json`)];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.isFile() && entry.name === `${targetLocale}.json` && entryPath.includes('/locales/')) paths.push(entryPath);
    }
  };
  walk(join(ROOT, 'src/features'));
  return paths.sort();
}

const matches = discoverLocalePaths(locale).filter((path) => {
  if (!existsSync(path)) return false;
  return hasLeaf(JSON.parse(readFileSync(path, 'utf8')), key);
});
if (matches.length === 0) usage(`key not found in ${locale} locale catalogs: ${key}`);
if (matches.length > 1) usage(`key is duplicated across ${locale} locale catalogs: ${key}`);

const localePath = matches[0];
const data = JSON.parse(readFileSync(localePath, 'utf8'));

// Walk the nested object to the parent of the leaf, validating along the way.
const parts = key.split('.');
const leaf = parts[parts.length - 1];
let cursor = data;
for (let i = 0; i < parts.length - 1; i++) {
  const seg = parts[i];
  if (!cursor || typeof cursor !== 'object' || !(seg in cursor)) {
    usage(`key not found in ${localePath}: ${key} (missing segment "${seg}")`);
  }
  cursor = cursor[seg];
}

if (!cursor || typeof cursor !== 'object' || !(leaf in cursor)) {
  usage(`key not found in ${localePath}: ${key}`);
}

if (typeof cursor[leaf] !== 'string') {
  usage(`key is not a leaf string in ${localePath}: ${key}`);
}

const lockedKey = `${leaf}__locked`;
if (cursor[lockedKey] === true) {
  process.stdout.write(`already locked: ${locale}/${key}\n`);
  process.exit(0);
}

cursor[lockedKey] = true;

writeFileSync(localePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
process.stdout.write(`locked: ${locale}/${key} (${localePath})\n`);
