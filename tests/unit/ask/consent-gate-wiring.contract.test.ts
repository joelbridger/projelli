/**
 * F2.5b — the consent-gate wiring contract, enforced inside `vitest run` (not
 * only scripts/gate.sh) from ONE source of truth: the scanner in
 * scripts/check-consent-gate-wiring.mjs.
 *
 * The rule (see that script's header): every module that BOTH pulls client file
 * content from the local index (MemoryService.retrieve) AND sends it onward to
 * an AI provider must be consciously classified — an ambient conversational
 * surface MUST reference the consent gate (resolveWorkspaceRetrieval /
 * fileToolsAllowed); an explicit one-shot user action is exempt with a reason.
 * A new, unclassified file-content cloud sender FAILS — which is exactly what
 * would have caught the F2.5 gap (the redesigned Ask surface shipped as a new
 * ungated sender). This makes that class of confidentiality regression
 * impossible to reintroduce silently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findConsentGateViolations } from '../../../scripts/check-consent-gate-wiring.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('F2.5b consent-gate wiring contract', () => {
  it('every file-content cloud sender is gated or explicitly vetted (no violations)', () => {
    expect(findConsentGateViolations(repoRoot)).toEqual([]);
  });

  it('both ambient send paths reference the consent gate', () => {
    // The two conversational surfaces whose retrieval is ambient — the exact
    // shape of the F2.5 bug — must import/reference the gate decision function.
    for (const rel of [
      'src/features/ask/useAsk.ts',
      'src/features/ask/hooks/useChatSending.ts',
    ]) {
      const text = readFileSync(join(repoRoot, rel), 'utf8');
      expect(text).toMatch(/resolveWorkspaceRetrieval|fileToolsAllowed/);
    }
  });
});
