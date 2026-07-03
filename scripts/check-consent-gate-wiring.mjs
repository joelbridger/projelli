#!/usr/bin/env node
/**
 * scripts/check-consent-gate-wiring.mjs — fast, blocking gate check that makes
 * the F2.5 confidentiality gap impossible to reintroduce by construction.
 *
 * THE BUG THIS PREVENTS (bench R21, HIGH): the file-access consent gate
 * (`fileAccessConsent.ts` — "reading is sending" with a cloud model) was wired
 * into ONLY the legacy chat send path. The redesigned PRIMARY Ask surface
 * (`useAsk.ts`) shipped client file content to the cloud provider on message
 * one, with no banner and no way to refuse — because a NEW sender was added on a
 * code path that never inherited the gate. A wiring gap, not a logic bug.
 *
 * THE CONTRACT: any module that BOTH pulls client file content from the local
 * index (`MemoryService.retrieve(`) AND sends onward to an AI provider
 * (`sendMessageStreaming` / `.sendMessage(`) is a "file-content sender". Every
 * such module must be CONSCIOUSLY CLASSIFIED here as exactly one of:
 *
 *   - AMBIENT_MUST_GATE — a free-form conversational surface whose retrieval is
 *     ambient (runs on every message with no explicit per-message @workspace
 *     intent). For a cloud provider this is the silent-exfiltration surface, so
 *     it MUST reference the consent gate (`resolveWorkspaceRetrieval` /
 *     `fileToolsAllowed`). A listed file missing that reference FAILS the gate.
 *
 *   - EXPLICIT_ACTION_EXEMPT — a one-shot generation the user explicitly
 *     triggered right now (generate the Client Map, open a client's at-a-glance),
 *     analogous to a typed `@workspace`: per-action intent, not ambient. Exempt,
 *     but only with a documented reason recorded below.
 *
 * A file-content sender that is in NEITHER list FAILS the gate: a human must
 * classify it (wire the consent gate for an ambient surface, or add it to the
 * exempt list with a reason). That is the whole point — a new cloud sender of
 * file content can never slip in unreviewed. This mirrors the "one front door"
 * check in scripts/check-provider-construction.mjs.
 *
 * NOTE (2026-07-02): the EXPLICIT_ACTION_EXEMPT surfaces (Client Map generator,
 * custom sections, at-a-glance) auto-send matter-scoped file content to a cloud
 * provider without a per-conversation consent prompt. That is a deliberate,
 * SEPARATE product question flagged for the board — not silently ungated: it is
 * recorded here so the trade-off is visible, not invisible.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

/** A module is a "file-content sender" when it BOTH retrieves file content AND
 *  sends to a provider. Both must be present in the same module. */
const RETRIEVE_RE = /MemoryService\.retrieve\s*\(/;
const SEND_RE = /sendMessageStreaming|\.sendMessage\s*\(/;
/** Presence of the consent gate: the ambient-retrieval decision function or the
 *  core predicate, imported from the shared fileAccessConsent module. */
const GATE_RE = /resolveWorkspaceRetrieval|fileToolsAllowed/;

/** Ambient conversational senders — MUST reference the consent gate. */
const AMBIENT_MUST_GATE = [
  'src/features/ask/useAsk.ts', // the PRIMARY 3-tab-IA Ask surface (F2.5b fix)
  'src/features/ask/hooks/useChatSending.ts', // the legacy .aichat chat send path
];

/** Explicit, user-triggered one-shot generations — exempt WITH a reason. Each
 *  key must remain an accurate description of why the surface is not ambient. */
const EXPLICIT_ACTION_EXEMPT = {
  'src/features/matters/clientMap/generator.ts':
    'user explicitly runs "generate Client Map"; matter-scoped one-shot, not a chat',
  'src/features/matters/clientMap/customSection.ts':
    'user explicitly adds a custom Client Map section; matter-scoped one-shot',
  'src/platform/matter/matterAtAGlance.ts':
    'at-a-glance summary of the client the user just opened; fixed matter-scoped summarization, not free-form chat',
};

function toPosix(p) {
  return p.split(sep).join('/');
}

function isTestFile(relPath) {
  return /\.(test|spec)\.(ts|tsx|mts|cts)$/.test(relPath);
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
 * Scan `src/` and return every consent-gate contract violation. Exported so the
 * contract unit test enforces the SAME rule inside `vitest run`, not only in
 * scripts/gate.sh — one source of truth for the rule.
 *
 * Violation kinds:
 *   - 'ungated-ambient'   — an AMBIENT_MUST_GATE file no longer references the gate;
 *   - 'unclassified'      — a NEW file-content sender in neither list;
 *   - 'stale-list-entry'  — a listed path that no longer exists or is no longer a sender.
 */
export function findConsentGateViolations(root = repoRoot) {
  const srcRoot = join(root, 'src');
  const violations = [];
  const seenSenders = new Set();

  for (const file of collectSources(srcRoot)) {
    const relPath = toPosix(relative(root, file));
    if (isTestFile(relPath)) continue;
    const text = readFileSync(file, 'utf8');
    if (!(RETRIEVE_RE.test(text) && SEND_RE.test(text))) continue; // not a sender
    seenSenders.add(relPath);

    if (AMBIENT_MUST_GATE.includes(relPath)) {
      if (!GATE_RE.test(text)) {
        violations.push({
          kind: 'ungated-ambient',
          relPath,
          detail:
            'ambient file-content cloud sender does NOT reference the consent gate ' +
            '(resolveWorkspaceRetrieval / fileToolsAllowed from @/platform/ai/fileAccessConsent)',
        });
      }
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(EXPLICIT_ACTION_EXEMPT, relPath)) continue;

    violations.push({
      kind: 'unclassified',
      relPath,
      detail:
        'NEW module that retrieves client file content AND sends it to an AI provider, ' +
        'but is not classified for F2.5 consent. Classify it: if it is a free-form/ambient ' +
        'surface, wire the consent gate (resolveWorkspaceRetrieval) and add it to ' +
        'AMBIENT_MUST_GATE; if it is an explicit one-shot user action, add it to ' +
        'EXPLICIT_ACTION_EXEMPT with a reason.',
    });
  }

  // Stale-list detection: a listed path that no longer exists, or exists but is
  // no longer a sender (so the list rots quietly). Keeps the allow-list honest.
  for (const relPath of [...AMBIENT_MUST_GATE, ...Object.keys(EXPLICIT_ACTION_EXEMPT)]) {
    const abs = join(root, relPath);
    if (!existsSync(abs)) {
      violations.push({ kind: 'stale-list-entry', relPath, detail: 'listed path does not exist' });
      continue;
    }
    if (!seenSenders.has(relPath)) {
      violations.push({
        kind: 'stale-list-entry',
        relPath,
        detail: 'listed path is no longer a file-content sender (retrieve + send) — remove it',
      });
    }
  }

  return violations;
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const violations = findConsentGateViolations();
  if (violations.length > 0) {
    console.error(
      '❌ F2.5 consent-gate wiring contract (every cloud sender of file content must be gated or vetted).\n' +
        '   A module that pulls client file content (MemoryService.retrieve) AND sends it to an\n' +
        '   AI provider must be classified in scripts/check-consent-gate-wiring.mjs.\n',
    );
    for (const v of violations) {
      console.error(`   [${v.kind}] ${v.relPath}\n       ${v.detail}`);
    }
    console.error(`\n   ${violations.length} violation(s).`);
    process.exit(1);
  }
  console.log('✅ Consent-gate wiring: every file-content cloud sender is gated or explicitly vetted.');
}
