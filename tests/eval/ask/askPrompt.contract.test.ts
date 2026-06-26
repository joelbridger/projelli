/**
 * Contract test for the shared Ask system-prompt builder.
 *
 * `buildAskSystemPrompt` is the single source of truth for the answer prompt,
 * used by both the app (`useAsk.ts`) and this eval. This test locks the prompt
 * contract: the grounding/decline/cite instructions are present and in order,
 * the retrieved context and history are appended after them, and empty sections
 * are dropped. If the prompt changes, this test changes with it — deliberately.
 */

import { describe, it, expect } from 'vitest';
import {
  ASK_INSTRUCTIONS,
  NO_EVIDENCE_DECLINE,
  buildAskSystemPrompt,
  scopeHintForMatter,
} from '@/features/ask/askPrompt';

describe('buildAskSystemPrompt', () => {
  it('emits scope → role → decline → cite → length → context → history, in order', () => {
    const prompt = buildAskSystemPrompt({
      scopeHint: scopeHintForMatter('Johnson v. Nexus'),
      workspaceBlock: '<workspace_context>\nDATA\n</workspace_context>',
      historyBlock: 'Earlier: hello',
    });
    const order = [
      'scoped to this client or matter: "Johnson v. Nexus"',
      ASK_INSTRUCTIONS.role,
      ASK_INSTRUCTIONS.decline,
      ASK_INSTRUCTIONS.cite,
      ASK_INSTRUCTIONS.length,
      '<workspace_context>',
      'Earlier: hello',
    ];
    let cursor = -1;
    for (const piece of order) {
      const at = prompt.indexOf(piece);
      expect(at, `missing or out-of-order: ${piece.slice(0, 40)}`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('embeds the exact decline sentence in the decline instruction', () => {
    expect(ASK_INSTRUCTIONS.decline).toContain(NO_EVIDENCE_DECLINE);
  });

  it('drops empty context and history sections', () => {
    const prompt = buildAskSystemPrompt({ scopeHint: scopeHintForMatter(null) });
    expect(prompt).toContain('across all of your clients and matters');
    expect(prompt).toContain(ASK_INSTRUCTIONS.cite);
    expect(prompt.endsWith(ASK_INSTRUCTIONS.length)).toBe(true); // nothing after length
    expect(prompt).not.toContain('\n\n\n'); // no gaps from empty sections
  });

  it('uses the all-matters hint when no matter label is given', () => {
    expect(scopeHintForMatter(null)).toMatch(/across all of your clients/);
    expect(scopeHintForMatter('Acme')).toMatch(/scoped to this client or matter: "Acme"/);
  });
});
