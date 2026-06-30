#!/usr/bin/env node
/**
 * identity-check.mjs — Phase 1 gate: verify both identity SoT modules exist
 * and export the minimum set of required constants.
 *
 * Run: node scripts/identity-check.mjs
 * Exit 0 = pass, non-zero = fail (with details printed).
 *
 * This script does STATIC analysis only — it reads the source files and greps
 * for the expected exports. It does not import/eval the modules.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Required TypeScript exports ───────────────────────────────────────────────

const TS_PATH = resolve(ROOT, 'src/config/identity.ts');

const REQUIRED_TS_EXPORTS = [
  // Keychain
  'KC_FIRM_NS',
  'kcUserService',
  'kcMatterService',
  'KC_DEVICE_PREFIX',
  'KC_DEVICE_META_SERVICE',
  // Storage keys
  'SK_SETTINGS',
  'SK_MATTERS',
  'SK_FIRM_SESSION',
  'SK_PRIVILEGE',
  'SK_PROFILE',
  // Events
  'EV_OPEN_EMAIL',
  'EV_OPEN_MATTER_MANAGER',
  'EV_MATTER_LAUNCH',
  'EV_TRASH_CHANGED',
  'EV_DEMO_LIMIT_HIT',
];

// ── Required Rust exports ─────────────────────────────────────────────────────

const RS_PATH = resolve(ROOT, 'src-tauri/src/identity.rs');

const REQUIRED_RS_EXPORTS = [
  // Core
  'APP_NS',
  'KC_FIRM_NS',
  'DEFAULT_KEYCHAIN_SERVICE',
  'VAULT_KEYCHAIN_PREFIX',
  // Audit / mail / vectors
  'AUDIT_ENC_SERVICE',
  'MAIL_ENC_SERVICE',
  'VECTORS_ENC_SERVICE',
  // Mail connectors
  'MAIL_MS_SERVICE',
  'MAIL_IMAP_SERVICE',
  'MAIL_GMAIL_SERVICE',
  // OneDrive
  'DOCS_MS_SERVICE',
  'ONEDRIVE_ENC_SERVICE',
  // CRM
  'CRM_ENC_SERVICE',
  'CRM_SERVICE_PREFIX',
  'WEALTHBOX_LEGACY_SERVICE',
  // Data dirs
  'WORKSPACE_DATA_DIR',
  'VAULT_META_FILE',
  'OS_DATA_SUBDIR',
  // MCP
  'MCP_SERVER_NAME',
  'MCP_APPROVAL_TEMP_PREFIX',
  'MCP_APPROVAL_MARKER',
];

// ── Verify single APP_NS value drives all constants ───────────────────────────

function checkAppNsConsistency(tsContent, rsContent) {
  const errors = [];

  // TS: APP_NS must be a single const, not repeated inline in the exports
  const tsAppNsMatch = tsContent.match(/const APP_NS\s*=\s*'([^']+)'/);
  if (!tsAppNsMatch) {
    errors.push('TS: cannot find `const APP_NS = \'...\';`');
  }

  // RS: APP_NS must be a single source of truth.
  // Accept either a direct literal (`pub const APP_NS: &str = "value"`) or
  // the macro form (`macro_rules! app_ns { () => { "value" } }` + `app_ns!()`).
  let rsAppNsValue = null;
  // Form 1: direct const literal
  const rsConstMatch = rsContent.match(/pub const APP_NS:\s*&str\s*=\s*"([^"]+)"/);
  if (rsConstMatch) rsAppNsValue = rsConstMatch[1];
  // Form 2: macro_rules! app_ns { () => { "value" } } + pub const APP_NS: &str = app_ns!()
  const rsMacroMatch = rsContent.match(/macro_rules!\s+app_ns\s*\{[^}]*\(\s*\)\s*=>\s*\{\s*"([^"]+)"\s*\}/s);
  const rsMacroConstMatch = rsContent.match(/pub const APP_NS:\s*&str\s*=\s*app_ns!\s*\(\s*\)/);
  if (rsMacroMatch && rsMacroConstMatch) rsAppNsValue = rsMacroMatch[1];
  if (!rsAppNsValue) {
    errors.push('RS: cannot find APP_NS as a literal const or as `macro_rules! app_ns + pub const APP_NS = app_ns!()`');
  }

  if (tsAppNsMatch && rsAppNsValue && tsAppNsMatch[1] !== rsAppNsValue) {
    errors.push(
      `APP_NS mismatch: TS has '${tsAppNsMatch[1]}', RS has '${rsAppNsValue}'`
    );
  }

  return errors;
}

// ── Main ──────────────────────────────────────────────────────────────────────

let failed = false;

function fail(msg) {
  console.error(`  FAIL  ${msg}`);
  failed = true;
}

function pass(msg) {
  console.log(`  pass  ${msg}`);
}

// --- TypeScript identity module ---
console.log('\nChecking src/config/identity.ts …');
if (!existsSync(TS_PATH)) {
  fail('File does not exist: src/config/identity.ts');
} else {
  const ts = readFileSync(TS_PATH, 'utf8');
  for (const name of REQUIRED_TS_EXPORTS) {
    // Match `export const NAME` or `export const NAME =` or the function form
    const pattern = new RegExp(`export (const|function) ${name}[\\s(=]`);
    if (pattern.test(ts)) {
      pass(`export ${name}`);
    } else {
      fail(`missing export: ${name}`);
    }
  }
}

// --- Rust identity module ---
console.log('\nChecking src-tauri/src/identity.rs …');
if (!existsSync(RS_PATH)) {
  fail('File does not exist: src-tauri/src/identity.rs');
} else {
  const rs = readFileSync(RS_PATH, 'utf8');
  for (const name of REQUIRED_RS_EXPORTS) {
    // Match `pub const NAME` or `pub fn name`
    const pattern = new RegExp(`pub (const|fn) ${name}[\\s:<(]`);
    if (pattern.test(rs)) {
      pass(`pub const/fn ${name}`);
    } else {
      fail(`missing: ${name}`);
    }
  }

  // --- Consistency check ---
  const tsContent = existsSync(TS_PATH) ? readFileSync(TS_PATH, 'utf8') : '';
  const consistencyErrors = checkAppNsConsistency(tsContent, rs);
  for (const err of consistencyErrors) {
    fail(`consistency: ${err}`);
  }
  if (consistencyErrors.length === 0) {
    pass('APP_NS is consistent between TS and RS');
  }
}

// --- Inline-literal guard: both files must NOT have stray keepance: prefixes
//     added after the SoT block (would mean a call site missed the refactor)
// NOTE: this is intentionally a light check; the full audit is brand:check.

console.log('\nChecking for stray inline identity strings in call sites …');
import { readdirSync, statSync } from 'fs';

function findTsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = resolve(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) findTsFiles(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const SRC_DIR = resolve(ROOT, 'src');
// Strip comment lines before checking for stray literals, to avoid false
// positives from doc-comment examples (// uses `keepance:…`) and JSX comments.
function stripTsComments(src) {
  // Remove single-line comments (// …) and block comments (/* … */), then
  // also strip JSX comments ({/* … */}).
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}
// Pattern: a string literal that starts with keepance: (storage/event prefix)
// but is NOT in the identity.ts SoT file itself.
const STRAY_TS_PATTERN = /['"`]keepance:/g;
let strayCount = 0;
for (const f of findTsFiles(SRC_DIR)) {
  if (f === TS_PATH) continue; // SoT itself is expected to have these
  const raw = readFileSync(f, 'utf8');
  const content = stripTsComments(raw);
  const matches = content.match(STRAY_TS_PATTERN);
  if (matches) {
    const relPath = f.replace(ROOT + '/', '');
    fail(`stray inline 'keepance:' literal in ${relPath} (${matches.length} occurrence(s))`);
    strayCount += matches.length;
  }
}
if (strayCount === 0) {
  pass('no stray inline keepance: literals in src/ TS files');
}

// --- Summary ---
console.log('');
if (failed) {
  console.error('identity:check FAILED — fix the issues above before proceeding.');
  process.exit(1);
} else {
  console.log('identity:check PASSED');
  process.exit(0);
}
