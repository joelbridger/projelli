#!/usr/bin/env node
/**
 * i18n Locale Completeness Gate
 *
 * WHY: `npm run i18n:check` (i18next-parser) only verifies that every key
 * used via t() in code exists in the English catalog. It says nothing about
 * whether the matching es.json / de.json catalog carries a translation. A
 * feature can add a key, pass i18n:check, and ship — while es/de silently
 * fall back to English for every one of those new keys because no locale
 * completeness check exists. (This exact miss happened: a Tier B dialog
 * shipped English-only for de/es users.) This script closes that gap: it
 * asserts every leaf key in each English catalog also exists, as a real
 * non-empty string, in its es.json and de.json counterparts.
 *
 * Usage:
 *   node scripts/i18n-completeness-check.mjs
 *
 * Escape hatch: a key that is genuinely meant to stay English in every
 * locale (a fixed brand name, a legal term that must not be translated,
 * etc.) can be listed in src/locales/i18n-completeness-allowlist.json, an
 * object mapping the dotted key path to a one-line reason:
 *   { "some.namespace.brand-name": "Product name; never translated." }
 * Default: no allowlist file, i.e. every key must exist in every locale.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const localesDir = resolve(repoRoot, 'src/locales');
const featuresDir = resolve(repoRoot, 'src/features');

export const SOURCE_LOCALE = 'en';
export const TARGET_LOCALES = ['de', 'es'];
const ALLOWLIST_PATH = resolve(localesDir, 'i18n-completeness-allowlist.json');

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function discoverEnglishCatalogPaths() {
  const paths = [resolve(localesDir, 'en.json')];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.isFile() && entry.name === 'en.json' && entryPath.includes('/locales/')) {
        paths.push(entryPath);
      }
    }
  };
  walk(featuresDir);
  return [paths[0], ...paths.slice(1).sort()];
}

export function localePathFor(englishPath, locale) {
  return englishPath.replace(/\/en\.json$/, `/${locale}.json`);
}

export function parseAllowlist(raw, sourcePath = '<allowlist>') {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `${sourcePath} must be a JSON object mapping dotted key paths to a reason string.`
    );
  }
  return new Set(Object.keys(raw));
}

function loadAllowlist() {
  let raw;
  try {
    raw = loadJson(ALLOWLIST_PATH);
  } catch (e) {
    if (e.code === 'ENOENT') return new Set();
    throw new Error(`Failed to parse ${ALLOWLIST_PATH}: ${e.message}`);
  }
  return parseAllowlist(raw, ALLOWLIST_PATH);
}

// Flatten a nested locale object into dotted leaf-key paths. Keys containing
// a double underscore are translation-pipeline metadata siblings
// (`title__sourceHash`, `title__locked`) written by scripts/translate-i18n.mjs,
// not real catalog entries — skip them so they never count as keys needing
// their own translation. Real keys never contain a double underscore
// (kebab-case; CLDR plural suffixes use a single underscore, e.g. `_one`).
export function flatten(obj, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    if (key.includes('__')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      out.push(...flatten(value, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

export function getAtPath(obj, dottedPath) {
  const parts = dottedPath.split('.');
  let node = obj;
  for (const part of parts) {
    if (node === null || typeof node !== 'object' || !(part in node)) {
      return undefined;
    }
    node = node[part];
  }
  return node;
}

/**
 * Compare one target locale against the flattened source key list.
 * Returns { missing, empty } — dotted-path arrays, both empty when complete.
 */
export function diffLocale(sourceKeys, localeData) {
  const missing = [];
  const empty = [];
  for (const key of sourceKeys) {
    const value = getAtPath(localeData, key);
    if (value === undefined) {
      missing.push(key);
    } else if (typeof value !== 'string' || value.trim().length === 0) {
      empty.push(key);
    }
  }
  return { missing, empty };
}

/**
 * Run the full completeness check across all target locales.
 * Returns { ok, results } where results is { [locale]: { missing, empty } }.
 * Pure — takes data in, returns a verdict, no I/O or process.exit.
 */
export function checkCompleteness(en, locales, allowlist = new Set()) {
  const sourceKeys = flatten(en).filter((key) => !allowlist.has(key));
  const results = {};
  let ok = true;
  for (const [locale, localeData] of Object.entries(locales)) {
    const diff = diffLocale(sourceKeys, localeData);
    results[locale] = diff;
    if (diff.missing.length > 0 || diff.empty.length > 0) ok = false;
  }
  return { ok, sourceKeyCount: sourceKeys.length, results };
}

export function main() {
  const allowlist = loadAllowlist();
  const englishPaths = discoverEnglishCatalogPaths();
  let ok = true;
  let sourceKeyCount = 0;

  for (const englishPath of englishPaths) {
    const relativePath = relative(repoRoot, englishPath);
    const en = loadJson(englishPath);
    const locales = Object.fromEntries(
      TARGET_LOCALES.map((locale) => [locale, loadJson(localePathFor(englishPath, locale))])
    );
    const result = checkCompleteness(en, locales, allowlist);
    sourceKeyCount += result.sourceKeyCount;
    ok &&= result.ok;

    for (const [locale, { missing, empty }] of Object.entries(result.results)) {
      if (missing.length === 0 && empty.length === 0) continue;
      if (missing.length > 0) {
        console.error(`\n❌ ${relativePath} is missing ${missing.length} ${locale} key(s):`);
        for (const key of missing) console.error(`   - ${key}`);
      }
      if (empty.length > 0) {
        console.error(`\n❌ ${relativePath} has ${empty.length} empty/non-string ${locale} value(s):`);
        for (const key of empty) console.error(`   - ${key}`);
      }
    }
  }

  if (!ok) {
    console.error(
      '\nEvery key in the base and feature-owned English catalogs must exist with a real translated value in ' +
        'the matching de.json and es.json shard.\n' +
        'Fix: add the translation (npm run translate-i18n), or if a key is genuinely meant\n' +
        'to stay English in every locale, add it to ' +
        'src/locales/i18n-completeness-allowlist.json\nwith a one-line reason.'
    );
    process.exit(1);
  }

  console.log(`\n✅ i18n completeness: ${englishPaths.length} catalog(s), ${sourceKeyCount} keys, all target shards complete.`);
}

const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
