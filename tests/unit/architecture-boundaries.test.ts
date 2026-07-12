/**
 * Architecture boundary guard (added in the 3.0 feature-first reorg).
 *
 * Enforces the 5-layer dependency DAG documented in ARCHITECTURE.md:
 *
 *     lib  <-  ui  <-  platform  <-  features  <-  app
 *
 * A layer may import only itself and layers to its LEFT. Concretely:
 *   - lib       imports: lib
 *   - ui        imports: ui, lib
 *   - platform  imports: platform, ui, lib
 *   - features  imports: platform, ui, lib, and OTHER features only via the
 *                        documented allowlist below (real cross-surface couplings)
 *   - app       imports: anything (it composes the features into a shell)
 *
 * Unlayered leaves (config, content, styles, locales, i18n, dev, web-demo, the
 * root App.tsx/main.tsx entry) are outside the DAG and ignored here.
 *
 * The allowlist captures the intentional cross-feature couplings that exist
 * today. It is a ratchet: NEW cross-feature imports fail this test until the
 * shared code is promoted to platform or the coupling is consciously accepted
 * (by adding it here with a reason).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../../src');
const RANK = { lib: 0, ui: 1, platform: 2, features: 3, app: 4 } as const;
type Layer = keyof typeof RANK;

// Intentional cross-feature couplings (importer -> imported). Each is a real
// product surface that legitimately references another (e.g. Settings hosts the
// templates marketplace; Ask is matter-scoped). Keep this list short and justified.
const ALLOWED_FEATURE_EDGES = new Set<string>([
  'account->firm',        // account/licensing surfaces firm seat state
  'account->settings',    // account window opens settings sections
  'ask->matters',         // Ask is matter-scoped (active matter context)
  'crm-connectors->crm-views', // Broadcast uses the saved-view query language to define its recipient list
  'crm-connectors->email', // Broadcast reuses the hardened mail AI provider resolver; delivery still uses the platform mail connector
  'documents->firm',      // file navigator shows privilege/vault affordances
  'matters->documents',   // Client Map export reuses the documents feature's PDF pipeline (R4)
  'documents->meetings',  // TabBar's dictation voice-note context menu (Task 10b) opens
                          // FileAsMeetingDialog to file the note into a client's Meetings/
  'firm->matters',        // solo-to-firm bridge reuses the matters promote-to-shared routine
  'matters->ask',         // Client Map reuses Ask's Sources column (SourcePanel + AnswerCitation) so the cited-sources card design is identical across both surfaces
  'matters->meetings',    // MattersHome/MatterHub host the Today's-meetings and Before-you-meet strips (Lantern-Plus Wave 1) — per-client meeting context lives on the Client Map surfaces, not a standalone tab
  'meetings->dictation',  // MeetingEntry (Wave 3c) reuses the existing AudioPlayer for the meeting audio scrubber instead of building a second audio player
  'meetings->documents',  // MeetingEntry (Wave 3c) reuses the existing DocxEditor to show notes.docx inline instead of a second docx renderer
  'meetings->workflows',  // generateBrief.ts runs the existing MeetingPrepAndSuitabilityNotes template headlessly via the workflow engine, instead of duplicating template-execution logic in the meetings feature
  'onboarding->firm',     // onboarding explains firm/SSO setup
  'onboarding->settings', // onboarding hands off to settings sections
  'privacy->firm',        // Privacy Center hosts the vault enable/disable control
  'settings->ask',        // AI/model settings touch Ask config
  'settings->dictation',  // voice-output settings
  'settings->meetings',   // RecordingNoticeSettings (Recording Notice Kit) configures the meetings notice policy + spoken-script, reusing meetings/noticeSettings' pure readers (mirrors settings->ask / settings->dictation config edges)
  'settings->onboarding', // settings can relaunch onboarding flows
  'settings->workflows',  // settings hosts the templates marketplace tab
]);

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e) && !/\.d\.ts$/.test(e)) acc.push(p);
  }
  return acc;
}
function layerOf(rel: string): Layer | null {
  const top = rel.split('/')[0] ?? '';
  return top in RANK ? (top as Layer) : null;
}
function featureOf(rel: string): string {
  return rel.split('/')[1] ?? '';
}
const SPEC_RE =
  /(?:import|export)[^'"`]*?from\s*['"`](@\/[^'"`]+)['"`]|import\s*\(\s*['"`](@\/[^'"`]+)['"`]\s*\)/g;

describe('architecture layer boundaries (ARCHITECTURE.md DAG)', () => {
  const files = walk(SRC);
  const violations: string[] = [];

  for (const abs of files) {
    const rel = path.relative(SRC, abs);
    const fromLayer = layerOf(rel);
    if (!fromLayer) continue; // unlayered leaf (config/content/entry) — skip as importer
    const txt = readFileSync(abs, 'utf8');
    let m: RegExpExecArray | null;
    SPEC_RE.lastIndex = 0;
    while ((m = SPEC_RE.exec(txt))) {
      const spec = (m[1] ?? m[2] ?? '').slice(2); // strip '@/'
      const toLayer = layerOf(spec);
      if (!toLayer) continue; // importing an unlayered leaf — fine
      if (fromLayer === 'app') continue; // app composes everything
      // Same-layer: only 'features' is restricted (no cross-feature beyond allowlist)
      if (fromLayer === toLayer) {
        if (fromLayer === 'features') {
          const a = featureOf(rel);
          const b = featureOf(spec);
          if (a && b && a !== b && !ALLOWED_FEATURE_EDGES.has(`${a}->${b}`)) {
            violations.push(`${rel}  ->  @/${spec}   (undeclared feature edge ${a}->${b})`);
          }
        }
        continue;
      }
      // Cross-layer: importing a HIGHER layer is forbidden (upward dependency)
      if (RANK[toLayer] > RANK[fromLayer]) {
        violations.push(`${rel}  ->  @/${spec}   (${fromLayer} must not import ${toLayer})`);
      }
    }
  }

  it('has no upward layer imports and no undeclared cross-feature edges', () => {
    expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
  });
});
