#!/usr/bin/env node
/**
 * scripts/check-untrusted-sink-derivation.mjs
 *
 * ONE checker for three sink classes that all failed the same way:
 *   "we found N; here is the N+1th."
 *
 *   - CSV EMITTERS      (R-16) — five were found by hand; a sixth was hiding.
 *   - HTML/URL SINKS    (R-14) — two sanitizers were "unified"; a third existed.
 *   - ARCHIVE READERS   (R-17) — the native path is bomb-guarded; the renderer
 *                                paths are not.
 *
 * A hand-maintained list of writers is the literal-grep of this class: it
 * DEFAULTS TO GREEN for every file nobody thought of. This checker inverts
 * that. Its scope is derived from ground truth (a filesystem walk that is a
 * proven superset of what every tsconfig compiles), its membership test is
 * multi-signal (so renaming one thing does not blind it), and a member that is
 * neither routed through the sanctioned chokepoint nor carrying an explicit
 * reviewed waiver is an ERROR. THE DEFAULT IS RED.
 *
 * ------------------------------------------------------------------------
 * WHY THE SCOPE IS A FILESYSTEM WALK AND NOT `tsc --listFilesOnly`
 * ------------------------------------------------------------------------
 * The ruling says "derive from ground truth: tsc --listFilesOnly across the
 * tsconfigs, unioned with a filesystem walk for anything outside it". The walk
 * is the union: it is a strict SUPERSET of every tsc file list, and unlike tsc
 * it can see a file that is not yet imported or not yet tracked by git — which
 * is precisely the N+2th-writer case. `--verify-superset` PROVES the
 * superset relation by running tsc for every tsconfig the walk itself finds
 * and asserting each emitted first-party file is inside the walked set. Any
 * file tsc compiles that the walk cannot see is a HARD ERROR, not a warning:
 * it would mean an exclusion below is hiding real source.
 *
 * ------------------------------------------------------------------------
 * WHAT THIS CHECKER IS NOT
 * ------------------------------------------------------------------------
 * It is a SCOPE + ROUTING check, not a proof of correctness. It proves that
 * every file exhibiting a sink signal reaches the sanctioned chokepoint (or is
 * an explicitly reasoned waiver). It does NOT prove the chokepoint's guard is
 * itself correct — that is what the RED-on-flip unit tests in
 * `tests/unit/security/` do, and neither substitutes for the other.
 *
 * Usage:
 *   node scripts/check-untrusted-sink-derivation.mjs            # gate mode
 *   node scripts/check-untrusted-sink-derivation.mjs --list     # print the sets
 *   node scripts/check-untrusted-sink-derivation.mjs --json     # machine output
 *   node scripts/check-untrusted-sink-derivation.mjs --verify-superset
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// ---------------------------------------------------------------------------
// 1. GROUND-TRUTH UNIVERSE
// ---------------------------------------------------------------------------

/**
 * Directories excluded from the walk. Every entry here is a place that holds
 * NO first-party source — vendored packages or build output. The
 * `--verify-superset` mode is what keeps this list honest: if an exclusion
 * ever starts hiding a file that a tsconfig actually compiles, that mode fails.
 */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.worktrees',
  'dist',
  'dist-web-demo',
  'dist-e2e',
  'dist-demo',
  'build',
  'target', // cargo output
  'coverage',
  'test-results',
  'playwright-report',
  '.vite',
  '.turbo',
  '.next',
  'vendor',
]);

const SOURCE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|rs)$/;

function walkSourceFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      // FAIL CLOSED: an unreadable directory is an item we cannot resolve, so
      // it is a hard error, never a silent omission.
      throw new Error(`cannot read directory ${dir}: ${error.message}`);
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        // Symlinks are not followed (node_modules is symlinked in worktrees).
        continue;
      }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        stack.push(full);
      } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
        out.push(relative(root, full).split(sep).join('/'));
      }
    }
  }
  return out.sort();
}

const IS_TEST = /(?:\.test\.|\.spec\.|\/__tests__\/|(?:^|\/)tests\/|(?:^|\/)benches\/)/;

/*
 * A NOTE ON WHAT WAS TRIED AND REJECTED — comment stripping.
 *
 * An earlier version of this checker stripped comments before matching, to
 * silence five files whose only "hit" is prose (two carry the phrase "never
 * `dangerouslySetInnerHTML`" in a doc comment). It cut five waivers, and it
 * was WRONG: a comment scanner that does not understand string literals eats
 * from a `/*` inside a string to the next close, and everything in between
 * becomes invisible to every signal. That is a fail-OPEN heuristic bought to
 * save five lines of reviewed prose, in a checker whose entire purpose is to
 * stop a writer from hiding.
 *
 * So membership is judged on the RAW file, and the five prose-only hits are
 * waivers with reasons. A waiver is visible and reviewed; a lossy text
 * transform is neither.
 *
 * The ROUTING test below is the place a comment could do damage in the other
 * direction — a comment naming the chokepoint would otherwise mark a file
 * "guarded" — so that test is anchored to real import/use statements at the
 * start of a line, which a comment cannot be.
 */

// ---------------------------------------------------------------------------
// 2. THE THREE SETS — multi-signal membership
// ---------------------------------------------------------------------------
//
// Each set is defined by the NECESSARY CONDITIONS of the thing itself, in two
// independent halves:
//
//   DECLARES  — the file says what format it is dealing with (a mime type, an
//               extension literal, a library call, a self-named helper).
//   PRODUCES  — the file actually assembles or ships bytes (a row join, a
//               serializer call, a Blob, a filesystem write, a markup sink).
//
// A `strong` signal is one that can only mean the thing, so it stands alone.
// Everything else must satisfy BOTH halves. This is not a convenience filter:
// a file that never names the format, or never produces bytes, is not a writer
// of that format. Within each half the signals are redundant alternatives, so
// renaming one helper does not blind the set.

/**
 * @type {Record<string, {
 *   label: string,
 *   chokepoints: string[],
 *   strong: {id: string, re: RegExp}[],
 *   declares: {id: string, re: RegExp}[],
 *   produces: {id: string, re: RegExp}[],
 * }>}
 */
const SETS = {
  csv: {
    label: 'CSV-emitting paths',
    chokepoints: ['src/platform/export/csvSafe.ts', 'src-tauri/src/safe_csv.rs'],
    strong: [
      // A CSV mime type is only ever asserted about bytes you are handing out.
      { id: 'mime-text-csv', re: /['"`]text\/csv/ },
      // Library CSV serializers.
      { id: 'papaparse-unparse', re: /\bPapa\s*\.\s*unparse\s*\(|\bunparse\s*\(/ },
      { id: 'sheetjs-to-csv', re: /\bsheet_to_csv\s*\(|bookType\s*:\s*['"`]csv['"`]/ },
      { id: 'rust-csv-crate', re: /\bcsv\s*::\s*Writer|\bWriterBuilder\b/ },
      // A helper that names itself a CSV cell/row/document builder.
      { id: 'csv-helper-name', re: /\b(?:csv_cell|csvCell|csvRow|csvDocument|csvGuardedRow|csvFormulaCell|csvVerbatimCell|quoteCsvCell|escapeCsvField|toCsvRow|buildCsv|serializeCsv|createHouseholdCsv|entriesToCSV|write_rollback_csv)\b/ },
    ],
    declares: [
      { id: 'csv-filename-literal', re: /["'`][^"'`\n]*\.csv["'`]/ },
      { id: 'csv-format-literal', re: /\bcsv\b/i },
    ],
    produces: [
      // The hand-rolled shape: comma-joined fields assembled into rows.
      { id: 'comma-row-join', re: /\.join\(\s*['"`],['"`]\s*\)/ },
      { id: 'crlf-row-join', re: /\.join\(\s*['"`]\\r?\\n['"`]\s*\)/ },
      // Shipping bytes out: download, blob, or a filesystem/native write.
      { id: 'blob-or-download', re: /\bnew\s+Blob\s*\(|triggerDownload\s*\(|\.download\s*=/ },
      { id: 'fs-write', re: /\bwriteTextFile\s*\(|\bwriteFile\s*\(|\bwrite_all\s*\(|\bfs\s*::\s*write\s*\(|\bfs\.writeFileSync\s*\(|\bwriteFileSync\s*\(/ },
    ],
  },

  html: {
    label: 'raw-markup sinks and the URL/HTML sanitizers that feed them',
    chokepoints: ['src/platform/render/htmlSanitize.ts'],
    strong: [
      { id: 'react-danger', re: /dangerouslySetInnerHTML/ },
      { id: 'dom-innerhtml-write', re: /\.(?:innerHTML|outerHTML)\s*=(?!=)/ },
      { id: 'insert-adjacent-html', re: /insertAdjacentHTML\s*\(/ },
      { id: 'document-write', re: /\bdocument\s*\.\s*write(?:ln)?\s*\(/ },
      // Building an anchor/img/iframe with an interpolated URL is the sink
      // that BOTH previously-known sanitizers exist to close.
      { id: 'interpolated-href', re: /<(?:a|img|iframe|area|source|embed|object)\b[^>]*(?:href|src|data)\s*=\s*["'`]?\s*(?:\$\{|\$\d|["'`]\s*\+)/ },
      // A hand-rolled URL-scheme allowlist IS a sanitizer. This is the signal
      // that makes the "third sanitizer" class visible instead of anecdotal.
      { id: 'scheme-allowlist', re: /\^\(\?:?https?\||https?\|mailto|\bjavascript\s*:/ },
      // A file that already routes stays IN its set. If routing erased the
      // signal, guarded members would vanish and the derived count would
      // silently shrink every time something was fixed — a metric that moves
      // the wrong way when the thing it measures improves.
      { id: 'routed-html', re: /\b(?:safeUrlAttribute|sanitizeHtmlIntoDocument|sanitizeHtmlString|sanitizeInertDocument|escapeHtmlText)\s*\(/ },
    ],
    declares: [],
    produces: [],
  },

  archive: {
    label: 'archive-reading paths (zip/OOXML decompression of untrusted bytes)',
    chokepoints: [
      'src/platform/archive/safeZip.ts',
      'src-tauri/src/commands/rag/office.rs',
      'src-tauri/crates/lantern-docx/src/package.rs',
    ],
    strong: [
      { id: 'jszip-import', re: /from\s+['"`]jszip['"`]|require\(\s*['"`]jszip['"`]/ },
      { id: 'jszip-load', re: /\bJSZip\s*\.\s*loadAsync\s*\(/ },
      // Libraries that unzip INTERNALLY. These are archive readers even though
      // the word "zip" never appears in the calling file — this is the signal a
      // JSZip-shaped search cannot see, and it is where the real set grew.
      { id: 'mammoth-read', re: /\bmammoth\s*\.\s*(?:convertToHtml|extractRawText|convertToMarkdown)\s*\(/ },
      { id: 'docx-preview-render', re: /\brenderAsync\s*\(/ },
      { id: 'sheetjs-read', re: /\bXLSX\s*\.\s*read\s*\(/ },
      { id: 'rust-zip-archive', re: /\bZipArchive\s*::\s*new|\bzip\s*::\s*read\b/ },
      { id: 'unzip-word', re: /\bunzip\s*\(|\bdecompress(?:ion)?[-_ ]?bomb\b/i },
      // Same reason as `routed-html`: routing must not erase membership.
      { id: 'routed-archive', re: /\b(?:readGuardedZip|assertArchiveWithinBudget|assertInputBytesWithinCap)\s*\(/ },
    ],
    declares: [],
    produces: [],
  },
};

// ---------------------------------------------------------------------------
// 3. WAIVERS — the ONLY way to be a member and not route through a chokepoint
// ---------------------------------------------------------------------------
//
// A waiver is a DECISION with a reason attached, reviewed in the diff that
// added it. It is not the same object as the hand-maintained writer list this
// checker replaces: that list decided who was IN SCOPE (so an unknown file was
// silently out); this one decides only that a KNOWN member is safe (so an
// unknown file is still an error).
//
// Format: 'relative/path' -> 'reason'
/** @type {Record<string, Record<string, string>>} */
const WAIVERS = {
  csv: {
    'scripts/check-untrusted-sink-derivation.mjs':
      'this checker — the signal patterns are the literal text it matches on',
    'src/platform/export/csvSafe.ts':
      'IS the chokepoint',
    'src-tauri/src/safe_csv.rs':
      'IS the chokepoint',
    'src/platform/utils/spreadsheet-io.ts':
      'routes CSV emission through csvSafe; the comma-join signal also fires on non-CSV code paths in the same file',
    'src-tauri/src/commands/calendar/engine.rs':
      'joins matter ids with "," into a SQLite column, never a file; the value never reaches a spreadsheet',
    'src-tauri/src/commands/calendar/store.rs':
      'reads/splits the same SQLite column; read-only, emits no file',
    'src-tauri/src/commands/crm/migration_commands.rs':
      'dispatcher — names write_rollback_csv and calls it; the encoding happens in export.rs, which is routed',
    'src/app/shell/layout/mainPanelHelpers.ts':
      'builds the OS save-dialog accept filter; declares the mime and extension, writes no bytes',
    'src/features/crm-clients/extensions/bulk-export/BulkExportDirectoryAction.tsx':
      'calls createHouseholdCsv; the encoding lives in bulk-export/csv.ts, which is routed',
    'src/features/crm-clients/extensions/bulk-export/index.ts':
      're-export barrel; contains no encoding',
    'src/features/documents/media/PDFViewer.tsx':
      'lists "csv" among viewable extensions and Blobs a PDF; emits no CSV',
    'scripts/demo-videos/record.mjs':
      'the "csv" hit is the ffmpeg filter option `csv=p=0`, not a comma-separated-values file',
  },
  html: {
    'scripts/check-untrusted-sink-derivation.mjs':
      'this checker — the signal patterns are the literal text it matches on',
    'src/platform/render/htmlSanitize.ts':
      'IS the chokepoint',
    'src/features/documents/editor/MarkdownEditor.tsx':
      'sets container.innerHTML = "" (a clear, no untrusted value can reach it)',
    'src/features/workflows/BrowserPanel.tsx':
      'assigns a hard-coded literal SVG with no interpolation',
    'src/features/email/EmailViewer.tsx':
      'PROSE ONLY — the doc comment says the body is rendered as React TEXT content, "never dangerouslySetInnerHTML". Verified: the file contains no markup sink.',
    'src/platform/utils/mail-commands.ts':
      'PROSE ONLY — same doc comment as EmailViewer.tsx. Verified: no markup sink.',
    'src-tauri/src/commands/notice_card/mod.rs':
      'a FIFTH scheme allowlist, and correctly out of scope for the HTML chokepoint: it decides whether the native companion window may OPEN a meeting URL (https-only, host required), it never builds markup. Listed rather than hidden because it is the same class — if the allowlist ever needs to change, both places have to be found.',
    'marketing-demo/render/askScene.mjs':
      'build-time marketing video renderer; the innerHTML values are first-party script literals and never reach a shipped surface',
    'marketing-demo/render/record.mjs':
      'build-time marketing video renderer; first-party literals only',
    'marketing-demo/render/scenes.mjs':
      'build-time marketing video renderer; first-party literals only',
    'marketing-demo/render/stage.js':
      'build-time marketing video renderer; first-party literals only',
  },
  archive: {
    'scripts/check-untrusted-sink-derivation.mjs':
      'this checker — the signal patterns are the literal text it matches on',
    'src/platform/archive/safeZip.ts':
      'IS the chokepoint',
    'src-tauri/src/commands/rag/office.rs':
      'IS the native chokepoint (entry-count + per-part + total budget; header sizes never trusted)',
    'src/platform/utils/docx-table-utils.ts':
      'comment-only mention of JSZip; performs no archive read',
    'src/platform/utils/docx-commands.ts':
      'comment-only mention of JSZip; performs no archive read',
    'src/app/fileOps/useFileOperations.ts':
      'comment-only mention of a JSZip error string; performs no archive read',
    'scripts/build-mcpb.mjs':
      'build-time packer over first-party build output, not user input',
    'src-tauri/src/commands/rag/extractor.rs':
      'PROSE ONLY — a doc comment noting that downstream readers "have their own decompression-bomb budgets past this gate". It dispatches by file kind and reads no archive itself.',
  },
};

// ---------------------------------------------------------------------------
// 4. ROUTING TEST
// ---------------------------------------------------------------------------

function routesThroughChokepoint(text, relPath, set) {
  for (const chokepoint of set.chokepoints) {
    if (relPath === chokepoint) return true;
    const moduleStem = chokepoint.replace(/^src\//, '').replace(/\.tsx?$/, '');
    const baseName = chokepoint.split('/').pop().replace(/\.(?:tsx?|rs)$/, '');
    if (chokepoint.endsWith('.rs')) {
      // A real `use` at the start of a line. A comment line begins with `//`
      // or ` *`, so it cannot satisfy this.
      if (new RegExp(`^\\s*(?:pub\\s+)?use\\s+(?:crate|super)::${baseName}\\b`, 'm').test(text)) {
        return true;
      }
    } else {
      const spec = `['"\`][^'"\`]*(?:${escapeRe(moduleStem)}|/${escapeRe(baseName)})['"\`]`;
      if (new RegExp(`^\\s*(?:import|export)\\b[^\\n]*from\\s+${spec}`, 'm').test(text)) return true;
      // Multi-line import lists: `import {\n  a,\n} from '…';`
      if (new RegExp(`^\\s*\\}\\s*from\\s+${spec}`, 'm').test(text)) return true;
      if (new RegExp(`\\bawait\\s+import\\(\\s*${spec}`).test(text)) return true;
    }
  }
  return false;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// 5. DERIVE + JUDGE
// ---------------------------------------------------------------------------

function derive({ includeTests = false } = {}) {
  const universe = walkSourceFiles(repoRoot);
  const results = {};
  for (const [key, set] of Object.entries(SETS)) {
    const members = [];
    for (const rel of universe) {
      if (!includeTests && IS_TEST.test(rel)) continue;
      let raw;
      try {
        raw = readFileSync(join(repoRoot, rel), 'utf8');
      } catch (error) {
        throw new Error(`cannot read ${rel}: ${error.message}`); // FAIL CLOSED
      }
      const text = raw;
      const strongHits = set.strong.filter((s) => s.re.test(text)).map((s) => s.id);
      const declareHits = set.declares.filter((s) => s.re.test(text)).map((s) => s.id);
      const produceHits = set.produces.filter((s) => s.re.test(text)).map((s) => s.id);
      const isMember =
        strongHits.length > 0 || (declareHits.length > 0 && produceHits.length > 0);
      if (!isMember) continue;
      const hits = [...strongHits, ...declareHits, ...produceHits];
      const waiver = WAIVERS[key]?.[rel];
      const guarded = routesThroughChokepoint(raw, rel, set);
      members.push({
        path: rel,
        signals: hits,
        verdict: guarded ? 'GUARDED' : waiver ? 'WAIVED' : 'UNGUARDED',
        ...(waiver ? { waiver } : {}),
      });
    }
    results[key] = { label: set.label, universeSize: universe.length, members };
  }
  return { universe, results };
}

// ---------------------------------------------------------------------------
// 6. SUPERSET PROOF (the guard-of-guards for the SCOPE half)
// ---------------------------------------------------------------------------

function verifySuperset() {
  const universe = new Set(walkSourceFiles(repoRoot));
  // The tsconfigs are found BY THE WALK, not hard-coded — a new tsconfig is
  // picked up automatically.
  const tsconfigs = [];
  const stack = [repoRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        stack.push(full);
      } else if (/^tsconfig(?:\..+)?\.json$/.test(entry.name)) {
        tsconfigs.push(relative(repoRoot, full).split(sep).join('/'));
      }
    }
  }
  tsconfigs.sort();

  const tscBin = join(repoRoot, 'node_modules', '.bin', 'tsc');
  if (!existsSync(tscBin)) {
    // FAIL CLOSED: "I could not check" is not "it checked out".
    console.error('FAIL: tsc not found — cannot prove the walk is a superset.');
    process.exit(1);
  }

  let missing = 0;
  let checked = 0;
  for (const cfg of tsconfigs) {
    let out;
    try {
      out = execFileSync(tscBin, ['-p', cfg, '--listFilesOnly'], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      // tsc exits non-zero on config errors; its stdout may still be usable,
      // but we refuse to guess. Report and keep going only if we got a list.
      out = error.stdout ?? '';
      if (!out.trim()) {
        console.error(`FAIL: tsc -p ${cfg} --listFilesOnly produced no list (exit ${error.status}).`);
        console.error(String(error.stderr ?? '').slice(0, 2000));
        process.exit(1);
      }
    }
    for (const line of out.split('\n')) {
      const abs = line.trim();
      if (!abs) continue;
      if (abs.includes('/node_modules/')) continue;
      const rel = relative(repoRoot, abs).split(sep).join('/');
      if (rel.startsWith('..')) continue; // outside the repo (typings elsewhere)
      if (!SOURCE_EXT.test(rel)) continue; // .d.ts handled below
      if (rel.endsWith('.d.ts')) continue;
      checked += 1;
      if (!universe.has(rel)) {
        console.error(`MISSING FROM WALK: ${rel}  (compiled by ${cfg})`);
        missing += 1;
      }
    }
  }
  console.log(`tsconfigs found by the walk: ${tsconfigs.length}`);
  console.log(`  ${tsconfigs.join('\n  ')}`);
  console.log(`first-party files tsc compiles: ${checked}`);
  console.log(`walked universe size: ${universe.size}`);
  console.log(`compiled files NOT in the walk: ${missing}`);
  if (missing > 0) {
    console.error('FAIL: the walk is NOT a superset of what tsc compiles.');
    process.exit(1);
  }
  console.log('OK: the walk is a proven superset of every tsconfig file list.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 7. MAIN
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv.includes('--verify-superset')) verifySuperset();

const includeTests = argv.includes('--include-tests');
const { results } = derive({ includeTests });

if (argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
  const bad = Object.values(results).some((r) => r.members.some((m) => m.verdict === 'UNGUARDED'));
  process.exit(bad ? 1 : 0);
}

let failures = 0;
for (const [key, res] of Object.entries(results)) {
  const unguarded = res.members.filter((m) => m.verdict === 'UNGUARDED');
  const guarded = res.members.filter((m) => m.verdict === 'GUARDED');
  const waived = res.members.filter((m) => m.verdict === 'WAIVED');
  console.log(
    `\n[${key}] ${res.label}: ${res.members.length} derived ` +
      `(${guarded.length} routed, ${waived.length} waived, ${unguarded.length} UNGUARDED)`
  );
  if (argv.includes('--list')) {
    for (const m of res.members) {
      console.log(`  ${m.verdict.padEnd(9)} ${m.path}  [${m.signals.join(',')}]`);
      if (m.waiver) console.log(`            reason: ${m.waiver}`);
    }
  } else {
    for (const m of unguarded) {
      console.log(`  UNGUARDED ${m.path}  [${m.signals.join(',')}]`);
    }
  }
  failures += unguarded.length;
}

if (failures > 0) {
  console.error(
    `\n❌ ${failures} sink(s) neither route through their chokepoint nor carry a reviewed waiver.\n` +
      `   Route it through the chokepoint, or add a WAIVERS entry WITH A REASON in\n` +
      `   scripts/check-untrusted-sink-derivation.mjs and get that reason reviewed.`
  );
  process.exit(1);
}
console.log('\n✅ every derived sink routes through its chokepoint or carries a reviewed waiver.');
