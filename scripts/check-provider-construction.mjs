#!/usr/bin/env node
/**
 * scripts/check-provider-construction.mjs — fast, blocking gate check that
 * enforces the "one front door" for AI-provider construction (fix F2.2).
 *
 * Background: at least five surfaces used to independently `new ClaudeProvider(…)`
 * / `new OpenAIProvider(…)` / … to decide which AI to talk to. They drifted — a
 * BYOK user with only an OpenAI key once got a dead redline button because one
 * surface fell back to a hardcoded 'anthropic' default. Every such construction
 * is now funnelled through `createProvider()` in
 * `src/platform/providers/providerFactory.ts`, so all surfaces build the SAME
 * provider for the same selection and the egress indicator can never disagree
 * with what actually sends.
 *
 * This check fails the gate if a raw `new <Name>Provider(` appears anywhere in
 * `src/` OUTSIDE the provider layer that legitimately owns construction:
 *   - any file under `src/platform/providers/` (the factory, the per-provider
 *     implementations that define themselves, the local resolver, the mock);
 *   - `src/web-demo/demoAIProvider.ts` (the demo-only provider factory);
 *   - test/spec files (they construct providers under test directly).
 *
 * It intentionally does NOT flag `createProvider(` / `createClaudeProvider(` /
 * other factory-function CALLS — only the `new …Provider(` construction keyword,
 * which is the exact thing surfaces must never do again.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// `new <Upper>…Provider(` — matches ClaudeProvider, OpenAIProvider,
// GeminiProvider, OllamaProvider, AppLocalProvider, MockProvider,
// DemoProxyProvider, etc. Not `createProvider(` (no `new`) — factory-function
// calls are exactly what we WANT surfaces to use.
const CONSTRUCT_RE = /\bnew\s+[A-Z][A-Za-z0-9_]*Provider\s*\(/;

/** Paths (relative to repo root, forward-slashed) that MAY construct providers. */
const ALLOWED_PREFIXES = [
  'src/platform/providers/', // factory + provider impls + local resolver + mock
];
const ALLOWED_FILES = [
  'src/web-demo/demoAIProvider.ts', // demo-only provider factory
];

function toPosix(p) {
  return p.split(sep).join('/');
}

function isTestFile(relPath) {
  return /\.(test|spec)\.(ts|tsx|mts|cts)$/.test(relPath);
}

function isAllowed(relPath) {
  if (isTestFile(relPath)) return true;
  if (ALLOWED_FILES.includes(relPath)) return true;
  return ALLOWED_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

/** Recursively collect .ts/.tsx source files under `dir`. */
function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectSources(full, out);
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * True when the regex match at `idx` on `line` sits inside a `//` line comment.
 * Cheap heuristic — block comments are not stripped, but a `new XProvider(` in a
 * multi-line comment is vanishingly rare and would be caught in review anyway.
 */
function inLineComment(line, idx) {
  const commentAt = line.indexOf('//');
  return commentAt !== -1 && commentAt < idx;
}

/**
 * Scan `src/` and return every `new …Provider(` construction that lives outside
 * the allowed provider layer. Exported so the contract unit test
 * (tests/unit/provider-front-door.test.ts) enforces the same invariant inside
 * `vitest run`, not only in scripts/gate.sh — one source of truth for the rule.
 */
export function findProviderConstructionViolations(root = repoRoot) {
  const srcRoot = join(root, 'src');
  const found = [];
  for (const file of collectSources(srcRoot)) {
    const relPath = toPosix(relative(root, file));
    if (isAllowed(relPath)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = CONSTRUCT_RE.exec(line);
      if (m && !inLineComment(line, m.index)) {
        found.push({ relPath, line: i + 1, text: line.trim() });
      }
    });
  }
  return found;
}

// Run the CLI/gate check only when executed directly (not when imported by the
// contract test).
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const violations = findProviderConstructionViolations();
  if (violations.length > 0) {
    console.error(
      '❌ Provider construction outside the factory (fix F2.2 — the "one front door" rule).\n' +
        '   Every AI provider must be built through createProvider() in\n' +
        '   src/platform/providers/providerFactory.ts, so all surfaces agree on\n' +
        '   which AI they talk to and the egress indicator can never lie.\n' +
        `   Replace each raw \`new …Provider(\` below with createProvider({ … }):\n`,
    );
    for (const v of violations) {
      console.error(`   ${v.relPath}:${v.line}  ${v.text}`);
    }
    console.error(
      `\n   ${violations.length} violation(s). Allowed to construct directly: ` +
        'src/platform/providers/**, src/web-demo/demoAIProvider.ts, and *.test/*.spec files.',
    );
    process.exit(1);
  }

  console.log('✅ Provider construction: one front door (createProvider) — no drift.');
}
