#!/usr/bin/env node
/**
 * i18n Locale Completeness Gate
 *
 * WHY: `npm run i18n:check` (i18next-parser) only verifies that every key
 * used via t() in code exists in en.json. It says nothing about whether
 * es.json / de.json actually carry a translation for that key. A feature can
 * add new en.json keys, pass i18n:check, and ship — while es/de silently
 * fall back to English for every one of those new keys because no locale
 * completeness check exists. (This exact miss happened: a Tier B dialog
 * shipped English-only for de/es users.) This script closes that gap: it
 * asserts every leaf key in en.json also exists, as a real non-empty string,
 * in es.json and de.json.
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
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const localesDir = resolve(repoRoot, 'src/locales');

export const SOURCE_LOCALE = 'en';
export const TARGET_LOCALES = ['de', 'es'];
const ALLOWLIST_PATH = resolve(localesDir, 'i18n-completeness-allowlist.json');

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
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
  const en = loadJson(resolve(localesDir, `${SOURCE_LOCALE}.json`));
  const locales = Object.fromEntries(
    TARGET_LOCALES.map((locale) => [locale, loadJson(resolve(localesDir, `${locale}.json`))])
  );

  const { ok, sourceKeyCount, results } = checkCompleteness(en, locales, allowlist);

  for (const [locale, { missing, empty }] of Object.entries(results)) {
    if (missing.length === 0 && empty.length === 0) {
      console.log(`✅ ${locale}.json: complete (${sourceKeyCount} keys checked)`);
      continue;
    }
    if (missing.length > 0) {
      console.error(`\n❌ ${locale}.json is missing ${missing.length} key(s) present in en.json:`);
      for (const key of missing) console.error(`   - ${key}`);
    }
    if (empty.length > 0) {
      console.error(`\n❌ ${locale}.json has ${empty.length} empty/non-string value(s):`);
      for (const key of empty) console.error(`   - ${key}`);
    }
  }

  if (!ok) {
    console.error(
      '\nEvery key in src/locales/en.json must exist with a real translated value in ' +
        'de.json and es.json.\n' +
        'Fix: add the translation (npm run translate-i18n), or if a key is genuinely meant\n' +
        'to stay English in every locale, add it to ' +
        'src/locales/i18n-completeness-allowlist.json\nwith a one-line reason.'
    );
    process.exit(1);
  }

  console.log('\n✅ i18n completeness: de.json and es.json cover every en.json key.');
}

const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
