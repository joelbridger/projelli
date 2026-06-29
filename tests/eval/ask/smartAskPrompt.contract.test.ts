/**
 * Contract test for the Ask-smart (source-aware advisor agent) system prompt.
 *
 * `buildSmartAskSystemPrompt` is the smart-mode counterpart to the strict
 * files-only `buildAskSystemPrompt`. This test locks the smart contract: the
 * block protocol + per-block contracts are present and ordered, the staleness
 * guardrails are stated, the no-live-internet line is the only refusal, and the
 * retrieved context + history are appended after the instructions. If the smart
 * prompt changes, this test changes with it — deliberately.
 */

import { describe, it, expect } from 'vitest';
import {
  SMART_ASK_INSTRUCTIONS,
  buildSmartAskSystemPrompt,
  scopeHintForMatter,
} from '@/features/ask/askPrompt';
import { BLOCK_MARKERS } from '@/features/ask/answerBlockMarkers';

describe('buildSmartAskSystemPrompt', () => {
  it('emits scope → role → blocks → files → general → draft → nothing-found → no-internet → context, in order', () => {
    const prompt = buildSmartAskSystemPrompt({
      scopeHint: scopeHintForMatter('Webb Household'),
      workspaceBlock: '<workspace_context>\nDATA\n</workspace_context>',
      historyBlock: 'Earlier: hello',
      hasEvidence: true,
    });
    const order = [
      'scoped to this client or matter: "Webb Household"',
      SMART_ASK_INSTRUCTIONS.role,
      SMART_ASK_INSTRUCTIONS.blocks,
      SMART_ASK_INSTRUCTIONS.files,
      SMART_ASK_INSTRUCTIONS.general,
      SMART_ASK_INSTRUCTIONS.draft,
      SMART_ASK_INSTRUCTIONS.nothingFound,
      SMART_ASK_INSTRUCTIONS.noInternet,
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

  it('names all four block markers in the block protocol', () => {
    expect(SMART_ASK_INSTRUCTIONS.blocks).toContain(BLOCK_MARKERS.files);
    expect(SMART_ASK_INSTRUCTIONS.blocks).toContain(BLOCK_MARKERS.general);
    expect(SMART_ASK_INSTRUCTIONS.blocks).toContain(BLOCK_MARKERS.draft);
    expect(SMART_ASK_INSTRUCTIONS.blocks).toContain(BLOCK_MARKERS.nothingFound);
  });

  it('states the staleness guardrails in the general contract', () => {
    expect(SMART_ASK_INSTRUCTIONS.general).toMatch(/concepts over numbers/i);
    expect(SMART_ASK_INSTRUCTIONS.general).toMatch(/not a live source|current source/i);
    expect(SMART_ASK_INSTRUCTIONS.general).toMatch(/never cite/i);
  });

  it('keeps the files-block citation discipline (never invent a citation)', () => {
    expect(SMART_ASK_INSTRUCTIONS.files).toMatch(/never invent/i);
    expect(SMART_ASK_INSTRUCTIONS.files).toMatch(/\[agreement\.docx paragraph 3\]/);
  });

  it('declines only the live internet', () => {
    expect(SMART_ASK_INSTRUCTIONS.noInternet).toMatch(/cannot browse the web|live data/i);
    expect(SMART_ASK_INSTRUCTIONS.noInternet).toMatch(/only kind of request you decline/i);
  });

  it('steers to nothing-found / general when no evidence was retrieved', () => {
    const prompt = buildSmartAskSystemPrompt({
      scopeHint: scopeHintForMatter('Webb Household'),
      hasEvidence: false,
    });
    expect(prompt).toMatch(/No file context was retrieved/i);
    expect(prompt).toMatch(/lead with a nothing-found block/i);
    // No workspace block appended when none was provided.
    expect(prompt).not.toContain('<workspace_context>');
  });

  it('cardinal rule: never mix a cited file-claim and a general claim in one block', () => {
    expect(SMART_ASK_INSTRUCTIONS.blocks).toMatch(/never put a cited file-claim and an uncited general statement in the same block/i);
  });
});
