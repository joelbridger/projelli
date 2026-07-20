/**
 * brand-sync.mjs — apply the brand to every surface from one source of truth.
 * Invoked via `node scripts/brand-sync.mjs` (see package.json brand:sync/brand:check).
 *
 * The single source of truth is  brand/brand.config.json.  This script reads it
 * and pushes the values out to everywhere brand lives:
 *
 *   • src/config/brand.ts            (generated — the app's typed view)
 *   • src/styles/globals.css         (the @brand:colors block — app colour tokens)
 *   • website/styles/brand.css       (generated — the website's :root colours)
 *   • src-tauri/tauri.conf.json      (display fields only: productName, title, …)
 *   • package.json, index.html       (display name / <title>)
 *   • brand/assets/* → public/, website/, src-tauri/icons/  (logo, favicon, OG)
 *
 * It NEVER touches the load-bearing identifiers listed in the config's
 * `lockedIdentifiers` (bundle id, keychain services, update/license URLs, tier
 * codes, the storage-key prefix, the data dir). It only *reads* those to assert
 * they are still present and unchanged — changing one is a founder + ops job that
 * needs a migration release. See HOW-TO-REBRAND.md.
 *
 * Usage:
 *   node scripts/brand-sync.mjs            # apply (safe parts) and report
 *   node scripts/brand-sync.mjs --check    # verify generated files are in sync (CI/gate); no writes
 *   node scripts/brand-sync.mjs --rename   # also swap the display NAME in static prose (website/email/README) — DRY RUN
 *   node scripts/brand-sync.mjs --rename --apply   # actually write the prose name swap
 *   node scripts/brand-sync.mjs --icons    # also regenerate the app icon set from the source PNG (slow)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(ROOT, p) || '.';
const args = process.argv.slice(2);
const FLAGS = {
  check: args.includes('--check'),
  rename: args.includes('--rename'),
  apply: args.includes('--apply'),
  icons: args.includes('--icons'),
};

// ── tiny logger ──────────────────────────────────────────────────────────────
const C = { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', cyn: '\x1b[36m', bold: '\x1b[1m' };
const changes = [];
const warnings = [];
const lockedDrift = []; // locked-identifier drift collected by assertLocked(); makes --check fail
const log = (m) => console.log(m);
const ok = (m) => { changes.push(m); log(`  ${C.grn}✓${C.reset} ${m}`); };
const skip = (m) => log(`  ${C.dim}·${C.reset} ${C.dim}${m}${C.reset}`);
const warn = (m) => { warnings.push(m); log(`  ${C.yel}!${C.reset} ${m}`); };
const die = (m) => { console.error(`\n${C.red}${C.bold}brand-sync failed:${C.reset} ${m}\n`); process.exit(1); };

// ── helpers ──────────────────────────────────────────────────────────────────
const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);
function write(p, content) {
  if (FLAGS.check) return; // check mode never writes
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function hexTriple(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) die(`colour "${hex}" is not a 6-digit hex like #0a2540`);
  const n = m[1];
  return `${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)}`;
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Replace exactly one occurrence of `find` (string). Reports via changes/warnings. No-op if equal. */
function replaceExactlyOnce(file, find, repl, label) {
  if (find === repl) { return; } // unchanged → nothing to do
  let text = read(file);
  const count = text.split(find).length - 1;
  if (count === 0) { warn(`${label}: expected text not found in ${rel(file)} (already renamed, or structure changed) — skipped`); return; }
  if (count > 1) { warn(`${label}: found ${count}× in ${rel(file)} (ambiguous) — skipped for safety`); return; }
  text = text.replace(find, repl);
  write(file, text);
  ok(`${label} → "${repl}" in ${rel(file)}`);
}

// ── load + validate config ───────────────────────────────────────────────────
const CONFIG_PATH = path.join(ROOT, 'brand', 'brand.config.json');
// cfg/NAME/col are populated by loadConfig() inside main(), so this module can be
// imported (e.g. by tests for its pure helpers like detectLockedDrift) WITHOUT
// running a sync. They're assigned before any function that reads them is called.
let cfg, NAME, col;
function loadConfig() {
  if (!exists(CONFIG_PATH)) die(`missing ${rel(CONFIG_PATH)}`);
  try { cfg = JSON.parse(read(CONFIG_PATH)); } catch (e) { die(`brand.config.json is not valid JSON: ${e.message}`); }
  validate(cfg);
  NAME = cfg.name;
  col = cfg.colors;
}

function validate(c) {
  const errs = [];
  if (!c.name) errs.push('name is required');
  if (!c.tagline) errs.push('tagline is required');
  for (const k of ['navy', 'pink', 'blue', 'accent']) {
    if (!c.colors?.[k]) errs.push(`colors.${k} is required`);
    else if (!/^#[0-9a-fA-F]{6}$/.test(c.colors[k])) errs.push(`colors.${k} must be 6-digit hex (#rrggbb), got "${c.colors[k]}"`);
  }
  const requiredAssets = ['faviconSvg', 'logoSvg', 'logoSvgDark', 'logoSvgWhite', 'ogImage'];
  if (!c.assets) {
    errs.push('assets block is required');
  } else {
    for (const key of requiredAssets) {
      if (!c.assets[key]) errs.push(`assets.${key} is required`);
    }
    for (const [key, p] of Object.entries(c.assets)) {
      if (key.startsWith('_')) continue;
      const ap = path.join(ROOT, 'brand', p);
      if (!exists(ap)) errs.push(`assets.${key} points at brand/${p} which does not exist — drop the file there`);
    }
  }
  if (!c.lockedIdentifiers) errs.push('lockedIdentifiers block is required (the safety list)');
  if (errs.length) die(`config invalid:\n   - ${errs.join('\n   - ')}`);
}

// Source-asset → distributed-destination map. Used by BOTH the copy step and the
// drift check, so `brand:check` fails if a shipped asset is stale vs brand/assets.
// Matches a <link> to the shared nav stylesheet (which references the brand vars).
const NAV_LINK_RE = /^([ \t]*)(<link\b[^>]*keepance-nav\.v2\.css[^>]*>)/im;
// Matches an ACTUAL enabled <link> to brand.css (not a bare substring, so a
// commented-out link doesn't count). Test it against comment-stripped HTML.
const BRAND_CSS_LINK_RE = /<link\b[^>]*href=["']\/styles\/brand\.css["'][^>]*>/i;
const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

// Strip Rust // line and /* */ block comments (good enough for substring scans;
// keychain service literals never contain comment markers).
const stripRustComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

// Remove `#[cfg(test)] mod … { … }` blocks so a stale service string lingering in
// a unit-test module can't mask a real change at the definition site. Brace match
// is double-quote-aware so `"{}"` etc. inside test code don't throw off depth.
function stripRustTestModules(src) {
  let out = '', i = 0;
  for (;;) {
    const idx = src.indexOf('#[cfg(test)]', i);
    if (idx === -1) { out += src.slice(i); break; }
    const open = src.indexOf('{', idx);
    // Only treat it as a test MODULE (the common container) — leave other cfg(test) items alone.
    if (open === -1 || !/\bmod\b/.test(src.slice(idx, open))) { out += src.slice(i, idx + 12); i = idx + 12; continue; }
    out += src.slice(i, idx);
    let depth = 0, k = open, inStr = false, esc = false;
    for (; k < src.length; k++) {
      const c = src[k];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
      else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { k++; break; } }
    }
    i = k;
  }
  return out;
}

const ASSET_COPIES = [
  ['faviconSvg', 'public/favicon.svg'],
  ['faviconSvg', 'website/favicon.svg'],
  ['logoSvg', 'public/logo.svg'],
  ['logoSvgDark', 'public/logo-dark.svg'],
  ['logoSvgWhite', 'public/logo-white.svg'],
  ['logoSvgWhite', 'website/logo-white.svg'],
  ['ogImage', 'website/og-image.png'],
  ['iconSource', 'src-tauri/icons/icon.png'],
];

// ── locked-identifier safety assertions (read-only) ───────────────────────────
// Pure + exported so tests can verify drift detection without running a sync.
// Returns { ok, drift } for the load-bearing identifiers a rebrand must NEVER
// change (a drift here breaks auto-update / keychains / encrypted data / payments
// for existing users). Reads only; never writes.
export function detectLockedDrift(root, locked = {}) {
  const ok = [], drift = [];
  const tauriConf = path.join(root, 'src-tauri', 'tauri.conf.json');
  if (fs.existsSync(tauriConf)) {
    const raw = fs.readFileSync(tauriConf, 'utf8');
    let t = {};
    try { t = JSON.parse(raw); } catch { /* malformed → bundle-id check below will flag it */ }
    if (locked.tauriBundleId) {
      if (t.identifier !== locked.tauriBundleId) drift.push(`tauri bundle identifier is "${t.identifier}" but config locks it to "${locked.tauriBundleId}" — DO NOT rebrand this; investigate the drift`);
      else ok.push(`bundle id "${t.identifier}" intact`);
    }
    if (locked.updaterEndpoint) {
      if (!raw.includes(locked.updaterEndpoint)) drift.push('updater endpoint not found / changed in tauri.conf.json — auto-update relies on it staying constant');
      else ok.push('updater endpoint intact');
    }
  }
  const cargo = path.join(root, 'src-tauri', 'Cargo.toml');
  if (fs.existsSync(cargo) && locked.cargoBinaryName) {
    if (!new RegExp(`name\\s*=\\s*"${locked.cargoBinaryName}"`).test(fs.readFileSync(cargo, 'utf8'))) drift.push(`Cargo binary name "${locked.cargoBinaryName}" not found — it is load-bearing for the build/release pipeline`);
    else ok.push(`Cargo binary name "${locked.cargoBinaryName}" intact`);
  }
  const kcRoot = path.join(root, 'src-tauri', 'src');
  const services = locked.keychainServices || [];
  if (fs.existsSync(kcRoot) && services.length) {
    // Scan only REAL code: drop test files, then strip comments + #[cfg(test)]
    // modules. Then require each service to appear in a DEFINITION/GENERATOR
    // context — a string literal preceded by `=` (const/static/let) or `(`
    // (format!/Entry::new/…). This deliberately ignores the central allowlist
    // array (bare `"svc",` elements aren't preceded by `=`/`(`), comments, and
    // tests — so a genuine change at the call site fails even if a stale copy
    // lingers in the allowlist/a comment/a test.
    //
    // concat!() expansion: identity.rs may define constants as
    //   pub const X: &str = concat!(app_ns!(), "-suffix");
    // rather than literal strings.  Read the macro value from identity.rs and
    // inline it before pattern-matching so the check remains meaningful.
    const identityRsPath = path.join(kcRoot, 'identity.rs');
    let realCode;
    {
      const isTestFile = (f) => { const p = f.replace(/\\/g, '/'); return /\/tests?\//.test(p) || /(^|\/)(test|tests)\.rs$/.test(p) || /_tests?\.rs$/.test(p); };
      const rawCode = walk(kcRoot, (f) => f.endsWith('.rs'))
        .filter((f) => !isTestFile(f))
        .map((f) => stripRustTestModules(stripRustComments(fs.readFileSync(f, 'utf8'))))
        .join('\n');
      // Expand app_ns!() to the literal it holds so concat!() patterns resolve.
      let appNsValue = 'keepance'; // default; overridden if identity.rs uses macro form
      if (fs.existsSync(identityRsPath)) {
        // Strip comments before searching — a stale doc comment containing the old
        // macro form would fool the lazy regex and cause a false pass.
        const identityRaw = stripRustComments(fs.readFileSync(identityRsPath, 'utf8'));
        // Match: macro_rules! app_ns { () => { "value" } }
        // Use lazy [\s\S]*? to skip the outer brace and find the arm body.
        const macroMatch = identityRaw.match(/macro_rules!\s+app_ns[\s\S]*?\(\s*\)\s*=>\s*\{\s*"([^"]+)"/);
        // Also match: pub const APP_NS: &str = "value";
        const constMatch = identityRaw.match(/pub const APP_NS:\s*&str\s*=\s*"([^"]+)"/);
        appNsValue = (macroMatch && macroMatch[1]) || (constMatch && constMatch[1]) || appNsValue;
      }
      // Expand identity macros so the brand:check can find the assembled
      // service strings as simple literals (= "...").
      // Step 1: replace every app_ns!() call with the quoted literal value.
      // Step 2: collapse concat!("a", "b", "c") → "abc".
      // After step 1, concat!() no longer has nested parens, so [^)]+ works.
      const step1 = rawCode.replace(/app_ns!\s*\(\s*\)/g, `"${appNsValue}"`);
      realCode = step1.replace(
        /concat!\s*\(([^)]+)\)/g,
        (_, args) => {
          const strs = args.split(',').map((p) => { const m = p.trim().match(/^"([^"]*)"$/); return m ? m[1] : ''; });
          return `"${strs.join('')}"`;
        }
      );
    }
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const missing = services.filter((s) => {
      // A service ending in `.` or `-` is a PREFIX (used like `"<prefix>{id}"`),
      // so allow continuation. A full service must match the EXACT literal
      // (closing quote right after) — otherwise renaming `x` → `x-v2` would
      // sneak through because the old value is a prefix of the new one.
      const re = /[.-]$/.test(s)
        ? new RegExp(`[=(]\\s*"[^"]*${esc(s)}`)
        : new RegExp(`[=(]\\s*"${esc(s)}"`);
      return !re.test(realCode);
    });
    if (missing.length) drift.push(`keychain service name(s) not found at a real definition/use site in src-tauri/src (only in comments/tests/allowlist, if anywhere): ${missing.join(', ')} — load-bearing (a change here orphans saved keys/tokens)`);
    else ok.push('keychain service names intact');
  }
  return { ok, drift };
}

function assertLocked() {
  log(`\n${C.bold}Locked identifiers (read-only safety check)${C.reset}`);
  const { ok: okItems, drift } = detectLockedDrift(ROOT, cfg.lockedIdentifiers || {});
  okItems.forEach(skip);
  // Keep the friendly warning wording, but RECORD drift so --check mode fails on
  // it: the locked layer is the whole safety guarantee.
  drift.forEach((m) => { warn(m); lockedDrift.push(m); });
}

// ── generated artifacts ──────────────────────────────────────────────────────
function brandTs() {
  const view = {
    name: cfg.name,
    nameShort: cfg.nameShort ?? cfg.name,
    legalName: cfg.legalName ?? cfg.name,
    possessive: cfg.possessive ?? `${cfg.name}'s`,
    tagline: cfg.tagline,
    taglineShort: cfg.taglineShort ?? '',
    positioning: cfg.positioning ?? '',
    descriptions: {
      store: cfg.descriptions?.store ?? '',
      shortStore: cfg.descriptions?.shortStore ?? '',
      meta: cfg.descriptions?.meta ?? '',
    },
    colors: { navy: col.navy, pink: col.pink, blue: col.blue, accent: col.accent },
    assets: {
      favicon: '/favicon.svg',
      logo: '/logo.svg',
      logoDark: '/logo-dark.svg',
      logoWhite: '/logo-white.svg',
    },
    messaging: {
      onboardingHeadline: cfg.messaging?.onboardingHeadline ?? '',
      redlineAuthor: cfg.messaging?.redlineAuthor ?? `${cfg.name} AI`,
      exportWatermark: cfg.messaging?.exportWatermark ?? `Prepared with ${cfg.name}`,
    },
    urls: {
      domain: cfg.urls?.domain ?? '',
      site: cfg.urls?.site ?? '',
      repository: cfg.urls?.repository ?? '',
      docsBase: cfg.urls?.docsBase ?? '',
      supportEmail: cfg.urls?.supportEmail ?? '',
      developersEmail: cfg.urls?.developersEmail ?? '',
      pricing: cfg.urls?.pricing ?? '',
      licenseUrl: cfg.urls?.licenseUrl ?? cfg.urls?.pricing ?? '',
      supportUrl: cfg.urls?.supportUrl ?? '',
      download: cfg.urls?.download ?? '',
      privacy: cfg.urls?.privacy ?? '',
      terms: cfg.urls?.terms ?? '',
      gettingStarted: cfg.urls?.gettingStarted ?? '',
      mobileDocsBase: cfg.urls?.mobileDocsBase ?? '',
      voices: cfg.urls?.voices ?? '',
      formsBugReport: cfg.urls?.formsBugReport ?? '',
      formsAiSetupHelp: cfg.urls?.formsAiSetupHelp ?? '',
      formsTelemetry: cfg.urls?.formsTelemetry ?? '',
      formsDiagnostics: cfg.urls?.formsDiagnostics ?? '',
      licenseApi: cfg.urls?.licenseApi ?? '',
      firmApi: cfg.urls?.firmApi ?? '',
    },
  };
  const header = `/**
 * brand.ts — the app's typed view of the brand.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  GENERATED FILE — do not edit by hand.                                ║
 * ║  Source of truth:  brand/brand.config.json                           ║
 * ║  Regenerate with:  npm run brand:sync   (verify with brand:check)    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Every user-facing place the app names itself, states its tagline, or paints a
 * brand colour reads from \`BRAND\` here — so a rebrand is one edit to the config
 * plus one command, never a hunt-and-replace.
 *
 * Intentionally absent: the LOAD-BEARING identifiers (bundle id, keychain
 * service names, update/license URLs, tier codes, storage-key prefix). Those
 * live in brand/brand.config.json → lockedIdentifiers and must never be rebranded
 * automatically — changing one breaks updates, saved keys, or payments for
 * existing users. They stay as literal constants where they're used.
 */

`;
  return header +
    `export const BRAND = ${JSON.stringify(view, null, 2)} as const;\n\n` +
    `export type Brand = typeof BRAND;\n\n` +
    `/** The four primitive brand colours, as a convenience for inline SVG fills etc. */\n` +
    `export const BRAND_COLORS = BRAND.colors;\n`;
}

function colorsBlock() {
  return `/* @brand:colors:start — GENERATED from brand/brand.config.json by \`npm run brand:sync\`.
     Do not edit these lines by hand; change the config and re-run sync. The -rgb
     triples let every alpha tint below derive from one source, so a colour change
     here propagates across the whole app. ---- */
  --kp-navy: ${col.navy};
  --kp-navy-rgb: ${hexTriple(col.navy)};
  --kp-pink: ${col.pink};
  --kp-pink-rgb: ${hexTriple(col.pink)};
  --kp-blue: ${col.blue};
  --kp-blue-rgb: ${hexTriple(col.blue)};
  --kp-accent: ${col.accent};
  --kp-accent-rgb: ${hexTriple(col.accent)};
  --kp-grad: linear-gradient(135deg, var(--kp-pink), var(--kp-blue));
  /* @brand:colors:end */`;
}

function websiteBrandCss() {
  return `/* GENERATED from brand/brand.config.json by \`npm run brand:sync\`. Do not edit by hand.
   The website's brand colours. Pages reference these via var(--kp-…) so a rebrand
   is one config edit + one command instead of a find-replace across 85 HTML files. */
:root {
  --kp-navy: ${col.navy};
  --kp-navy-rgb: ${hexTriple(col.navy)};
  --kp-pink: ${col.pink};
  --kp-pink-rgb: ${hexTriple(col.pink)};
  --kp-blue: ${col.blue};
  --kp-blue-rgb: ${hexTriple(col.blue)};
  --kp-accent: ${col.accent};
  --kp-accent-rgb: ${hexTriple(col.accent)};
  --kp-grad: linear-gradient(135deg, var(--kp-pink), var(--kp-blue));
}
`;
}

// ── --check mode: verify generated files match the config, no writes ──────────
function runCheck() {
  log(`${C.bold}brand:check${C.reset} — verifying generated files match brand/brand.config.json\n`);
  const targets = [
    { path: path.join(ROOT, 'src', 'config', 'brand.ts'), want: brandTs(), name: 'src/config/brand.ts' },
    { path: path.join(ROOT, 'website', 'styles', 'brand.css'), want: websiteBrandCss(), name: 'website/styles/brand.css' },
  ];
  const drift = [];
  for (const t of targets) {
    if (!exists(t.path)) { drift.push(`${t.name} is missing`); continue; }
    if (read(t.path) !== t.want) drift.push(`${t.name} is out of date`);
    else skip(`${t.name} up to date`);
  }
  // globals.css @brand:colors block
  const globals = path.join(ROOT, 'src', 'styles', 'globals.css');
  if (exists(globals)) {
    const cur = (/\/\* @brand:colors:start[\s\S]*?@brand:colors:end \*\//.exec(read(globals)) || [])[0];
    const want = colorsBlock();
    if (!cur) drift.push('globals.css @brand:colors block is missing');
    else if (cur.trim() !== want.trim()) drift.push('globals.css @brand:colors block is out of date');
    else skip('globals.css @brand:colors block up to date');
  }
  // copied assets: a shipped logo/favicon/OG must match its source in brand/assets
  for (const [k, dest] of ASSET_COPIES) {
    const src = cfg.assets?.[k];
    if (!src) continue;
    const s = path.join(ROOT, 'brand', src);
    const d = path.join(ROOT, dest);
    if (!exists(s)) { drift.push(`source asset brand/${src} is missing`); continue; }
    if (!exists(d)) drift.push(`${dest} has not been synced from brand/${src}`);
    else if (!fs.readFileSync(s).equals(fs.readFileSync(d))) drift.push(`${dest} is stale vs brand/${src}`);
    else skip(`${dest} matches brand/${src}`);
  }
  // every shared-nav page must link brand.css (so the nav's brand vars are defined)
  const navPagesMissing = walk(path.join(ROOT, 'website'), (f) => f.endsWith('.html'))
    .filter((f) => { const v = stripHtmlComments(read(f)); return NAV_LINK_RE.test(v) && !BRAND_CSS_LINK_RE.test(v); });
  if (navPagesMissing.length) drift.push(`${navPagesMissing.length} shared-nav page(s) don't link brand.css (run brand:sync): ${navPagesMissing.slice(0, 3).map(rel).join(', ')}${navPagesMissing.length > 3 ? ', …' : ''}`);
  else skip('all shared-nav pages link brand.css');
  // Locked-identifier drift is a HARD failure too — but it is NOT fixed by
  // re-syncing (sync never writes these), so report it separately.
  if (lockedDrift.length) {
    console.error(`\n${C.red}✗ LOCKED IDENTIFIER DRIFT — the load-bearing safety layer changed:${C.reset}\n   - ${lockedDrift.join('\n   - ')}\n\nThese must NEVER change in a rebrand (they break auto-update / keychains / data / payments). Investigate before merging — do NOT just re-run sync.\n`);
  }
  if (drift.length) {
    console.error(`\n${C.red}✗ generated brand files are out of sync:${C.reset}\n   - ${drift.join('\n   - ')}\n\nRun  ${C.cyn}npm run brand:sync${C.reset}  to regenerate them.\n`);
  }
  if (lockedDrift.length || drift.length) process.exit(1);
  log(`\n${C.grn}✓ all generated brand files are in sync, and the locked identifiers are intact.${C.reset}`);
}

// ── apply mode ───────────────────────────────────────────────────────────────
function regenerateArtifacts() {
  log(`\n${C.bold}Generated files${C.reset}`);
  // brand.ts
  const tsPath = path.join(ROOT, 'src', 'config', 'brand.ts');
  const ts = brandTs();
  if (!exists(tsPath) || read(tsPath) !== ts) { write(tsPath, ts); ok('regenerated src/config/brand.ts'); } else skip('src/config/brand.ts already current');
  // globals.css colour block
  const globals = path.join(ROOT, 'src', 'styles', 'globals.css');
  if (exists(globals)) {
    const text = read(globals);
    const re = /\/\* @brand:colors:start[\s\S]*?@brand:colors:end \*\//;
    if (!re.test(text)) warn('globals.css has no @brand:colors block — add the sentinel markers to manage colours');
    else {
      const next = text.replace(re, colorsBlock());
      if (next !== text) { write(globals, next); ok('updated @brand:colors block in src/styles/globals.css'); } else skip('globals.css @brand:colors block already current');
    }
  }
  // website/styles/brand.css
  const webCss = path.join(ROOT, 'website', 'styles', 'brand.css');
  const wcss = websiteBrandCss();
  if (!exists(webCss) || read(webCss) !== wcss) { write(webCss, wcss); ok('regenerated website/styles/brand.css'); } else skip('website/styles/brand.css already current');
}

async function distributeAssets() {
  log(`\n${C.bold}Assets${C.reset}`);
  const A = cfg.assets || {};
  const src = (k) => path.join(ROOT, 'brand', A[k]);
  const copy = (k, dest) => {
    if (!A[k]) return;
    const s = src(k);
    if (!exists(s)) { warn(`assets.${k} missing at ${rel(s)}`); return; }
    const d = path.join(ROOT, dest);
    const changed = !exists(d) || !fs.readFileSync(s).equals(fs.readFileSync(d));
    if (!changed) { skip(`${dest} already current`); return; }
    if (!FLAGS.check) { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); }
    ok(`copied ${A[k]} → ${dest}`);
  };
  for (const [k, dest] of ASSET_COPIES) copy(k, dest);

  // Derived raster favicons + app icons (optional / best-effort).
  log(`\n${C.bold}Derived images${C.reset}`);
  let sharp = null;
  try { sharp = (await importSharp()); } catch { /* not installed */ }
  if (sharp && A.faviconSvg) {
    skip('(sharp available — raster favicon regen could run here; SVG favicon already covers modern browsers)');
  } else {
    skip('raster favicons (favicon-16/32, apple-touch, .ico): SVG favicon is primary; to refresh rasters install `sharp` (npm i -D sharp) or run an image tool — see HOW-TO-REBRAND.md');
  }
  if (FLAGS.icons && A.iconSource) {
    try {
      log('  running `tauri icon` to regenerate the app icon set…');
      if (!FLAGS.check) execFileSync('npx', ['--no-install', '@tauri-apps/cli', 'icon', path.join('brand', A.iconSource)], { cwd: ROOT, stdio: 'inherit' });
      ok('regenerated src-tauri/icons/* from the source PNG');
    } catch (e) { warn(`could not run tauri icon (${e.message.split('\n')[0]}); run \`npx tauri icon brand/${A.iconSource}\` manually`); }
  } else if (A.iconSource) {
    skip('app icon set (taskbar/installer): re-run with --icons, or `npx tauri icon brand/' + A.iconSource + '`');
  }
}
// sharp is optional; import lazily so the script has zero hard deps. The variable
// specifier + @vite-ignore keeps bundlers (e.g. Vitest importing this module for
// its exported helpers) from trying to statically resolve an uninstalled package.
async function importSharp() { const mod = 'sharp'; return (await import(/* @vite-ignore */ mod)).default; }

/**
 * Ensure every website page that uses the shared nav (keepance-nav.v2.css, which
 * references the brand colour vars) also links the generated brand.css BEFORE it,
 * so the vars are defined when the nav uses them. Self-healing: new pages get the
 * link on the next sync. (The nav CSS also carries a hardcoded fallback, so a page
 * is never broken even if this hasn't run.)
 */
function linkWebsiteBrandCss() {
  log(`\n${C.bold}Website brand.css links${C.reset}`);
  const pages = walk(path.join(ROOT, 'website'), (f) => f.endsWith('.html'));
  let linked = 0, already = 0;
  for (const f of pages) {
    const text = read(f);
    const visible = stripHtmlComments(text);
    if (!NAV_LINK_RE.test(visible)) continue; // page doesn't use the shared nav
    if (BRAND_CSS_LINK_RE.test(visible)) { already++; continue; } // already has a real brand.css link
    const next = text.replace(NAV_LINK_RE, (_m, indent, navLink) =>
      `${indent}<link rel="stylesheet" href="/styles/brand.css" />\n${indent}${navLink}`);
    write(f, next);
    linked++;
  }
  if (linked) ok(`linked brand.css into ${linked} nav page(s)`);
  if (already) skip(`${already} nav page(s) already link brand.css`);
  if (!linked && !already) skip('no shared-nav pages found');
}

function updateDisplayMetadata() {
  log(`\n${C.bold}Display metadata (load-bearing ids untouched)${C.reset}`);
  // tauri.conf.json
  const tauri = path.join(ROOT, 'src-tauri', 'tauri.conf.json');
  if (exists(tauri)) {
    const t = JSON.parse(read(tauri));
    const oldName = t.productName;
    replaceExactlyOnce(tauri, `"productName": "${oldName}"`, `"productName": "${NAME}"`, 'productName');
    const oldTitle = t.app?.windows?.[0]?.title;
    if (oldTitle) replaceExactlyOnce(tauri, `"title": "${oldTitle}"`, `"title": "${NAME}"`, 'window title');
    const oldPub = t.bundle?.publisher;
    if (oldPub) replaceExactlyOnce(tauri, `"publisher": "${oldPub}"`, `"publisher": "${NAME}"`, 'publisher');
    const oldShort = t.bundle?.shortDescription;
    if (oldShort && cfg.descriptions?.shortStore) replaceExactlyOnce(tauri, `"shortDescription": ${JSON.stringify(oldShort)}`, `"shortDescription": ${JSON.stringify(cfg.descriptions.shortStore)}`, 'shortDescription');
    const oldLong = t.bundle?.longDescription;
    if (oldLong && cfg.descriptions?.store) replaceExactlyOnce(tauri, `"longDescription": ${JSON.stringify(oldLong)}`, `"longDescription": ${JSON.stringify(cfg.descriptions.store)}`, 'longDescription');
    const oldCopy = t.bundle?.copyright;
    if (oldCopy && oldName && oldName !== NAME) replaceExactlyOnce(tauri, `"copyright": ${JSON.stringify(oldCopy)}`, `"copyright": ${JSON.stringify(oldCopy.split(oldName).join(NAME))}`, 'copyright');
  }
  // package.json — npm display name (a slug). Cargo binary name is LOCKED, not touched.
  const pkg = path.join(ROOT, 'package.json');
  if (exists(pkg)) {
    const p = JSON.parse(read(pkg));
    const want = slug(NAME);
    if (p.name !== want) replaceExactlyOnce(pkg, `"name": ${JSON.stringify(p.name)}`, `"name": ${JSON.stringify(want)}`, 'package.json name');
    else skip('package.json name already current');
  }
  // index.html <title>
  const indexHtml = path.join(ROOT, 'index.html');
  if (exists(indexHtml)) {
    const m = /<title>([^<]*)<\/title>/.exec(read(indexHtml));
    if (m && m[1] !== NAME) replaceExactlyOnce(indexHtml, `<title>${m[1]}</title>`, `<title>${NAME}</title>`, 'index.html <title>');
    else skip('index.html <title> already current');
  }
}

/** --rename: swap the capitalised display name across static prose (DRY RUN unless --apply). */
function renameProse() {
  const statePath = path.join(ROOT, 'brand', '.applied.json');
  let prev = 'Keepance';
  if (exists(statePath)) { try { prev = JSON.parse(read(statePath)).name || prev; } catch { /* ignore */ } }
  if (prev === NAME) { log(`\n${C.dim}--rename: display name unchanged ("${NAME}") — nothing to swap in prose.${C.reset}`); return; }
  log(`\n${C.bold}Prose name swap${C.reset}  "${prev}" → "${NAME}"  ${FLAGS.apply ? C.red + '(APPLYING)' + C.reset : C.dim + '(dry run — add --apply to write)' + C.reset}`);
  // Files where the capitalised display name appears as prose. Locked tokens are lowercase
  // (com.keepance.app, keepance:, .keepance, *.keepance.com) so a \bCapitalised\b match avoids them,
  // but we also guard the few capitalised exceptions below.
  const globs = [
    ...walk(path.join(ROOT, 'website'), (f) => /\.(html|css|txt)$/.test(f)),
    path.join(ROOT, 'docs', 'marketing', 'playbook', 'EMAIL_SEQUENCES.md'),
    path.join(ROOT, 'README.md'),
  ].filter(exists);
  const re = new RegExp(`\\b${prev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  let totalFiles = 0, totalHits = 0;
  for (const f of globs) {
    const text = read(f);
    // protect URLs/emails that embed the name (domain rename is a separate founder step)
    const hits = (text.match(re) || []).length;
    if (!hits) continue;
    totalFiles++; totalHits += hits;
    if (FLAGS.apply) { write(f, text.replace(re, NAME)); ok(`${hits}× in ${rel(f)}`); }
    else log(`  ${C.dim}·${C.reset} ${hits}× in ${rel(f)}`);
  }
  log(`  ${totalHits} occurrence(s) across ${totalFiles} file(s).`);
  if (FLAGS.apply) warn('Review the prose diff: taglines/longer copy that changed meaning (not just the name) are a founder rewrite. Domains/emails were NOT changed — see the founder checklist.');
}

function walk(dir, filter, out = []) {
  if (!exists(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, filter, out);
    else if (filter(p)) out.push(p);
  }
  return out;
}

function writeAppliedState() {
  // Only advance the recorded "previous name" when --rename --apply actually
  // swapped the static prose. A plain `brand:sync` must NOT advance it, or a
  // later separate `brand:sync --rename` would see prev === new and skip the swap.
  if (!(FLAGS.rename && FLAGS.apply)) return;
  write(path.join(ROOT, 'brand', '.applied.json'), JSON.stringify({ name: NAME, syncedColors: col }, null, 2) + '\n');
}

function summary() {
  log(`\n${C.bold}${'─'.repeat(64)}${C.reset}`);
  log(`${C.bold}Done.${C.reset} ${changes.length} change(s), ${warnings.length} warning(s).`);
  log(`\n${C.bold}Founder checklist — steps a script cannot do for you${C.reset} (only if the name/domain changed):`);
  for (const line of [
    'Own the new domain + DNS, and decide whether to migrate keepance.com.',
    'Rename the LemonSqueezy store + update checkout links (payments).',
    'Plan a migration release for the load-bearing ids (bundle id, keychain, update/license URLs) — existing users keep working only if these are migrated, not just changed.',
    'Get a designer to redraw the social PNG cards (Assets/marketing/og-*.png) and, for a NAME change, the wordmark (brand/assets/wordmark.svg).',
    'Re-read the hero + meta copy on the website: --rename swaps the name, but new positioning is yours to write.',
  ]) log(`  ${C.cyn}•${C.reset} ${line}`);
  log('');
}

// ── run ──────────────────────────────────────────────────────────────────────
async function main() {
  loadConfig();
  log(`${C.bold}brand-sync${C.reset} — source: ${rel(CONFIG_PATH)}   name: "${NAME}"\n`);
  assertLocked();
  if (FLAGS.check) { log(''); runCheck(); return; }
  regenerateArtifacts();
  await distributeAssets();
  linkWebsiteBrandCss();
  updateDisplayMetadata();
  if (FLAGS.rename) renameProse();
  writeAppliedState();
  summary();
}

// Run only when invoked directly (node scripts/brand-sync.mjs), NOT when imported
// (e.g. tests importing the exported helpers like detectLockedDrift).
const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
