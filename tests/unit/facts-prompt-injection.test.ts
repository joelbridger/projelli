/**
 * `<memory>` prompt-block formatting (M3). These tests pin the exact
 * shape of the facts block so provider prompts stay deterministic,
 * and verify ordering + omission rules relative to the M2 workspace
 * context block.
 */

import { describe, expect, it } from 'vitest';

import {
  buildFactsMemoryBlock,
  injectFactsMemory,
  type Fact,
} from '@/modules/memory/FactsService';
import { buildWorkspaceContextBlock } from '@/modules/memory/workspaceCommand';

const FACTS: Fact[] = [
  {
    id: 'f1',
    text: 'The user is a Senior Product Designer at Wheel Health.',
    created: '2026-04-10T12:00:00.000Z',
    approved_by: 'user',
  },
  {
    id: 'f2',
    text: 'The user ships commercial software using Keepance.',
    created: '2026-04-12T12:00:00.000Z',
    approved_by: 'user',
  },
];

describe('buildFactsMemoryBlock', () => {
  it('returns empty string when there are no facts (omission rule)', () => {
    expect(buildFactsMemoryBlock([])).toBe('');
  });

  it('wraps facts in a <memory> block', () => {
    const block = buildFactsMemoryBlock(FACTS);
    expect(block.startsWith('<memory>\n')).toBe(true);
    expect(block.endsWith('</memory>')).toBe(true);
  });

  it('renders facts as plain-text bullets', () => {
    const block = buildFactsMemoryBlock(FACTS);
    expect(block).toContain('- The user is a Senior Product Designer at Wheel Health.');
    expect(block).toContain('- The user ships commercial software using Keepance.');
  });

  it('includes a human-readable label so the model knows what the block is', () => {
    const block = buildFactsMemoryBlock(FACTS);
    expect(block.toLowerCase()).toContain('facts about the user');
    expect(block.toLowerCase()).toContain('durable');
  });

  it('trims whitespace from fact text', () => {
    const block = buildFactsMemoryBlock([
      { ...FACTS[0]!, text: '   padded fact   ' },
    ]);
    expect(block).toContain('- padded fact');
    expect(block).not.toContain('-    padded fact');
  });
});

describe('injectFactsMemory', () => {
  const BASE = 'You are a helpful AI assistant.';

  it('returns the base prompt unchanged when facts is empty', () => {
    expect(injectFactsMemory(BASE, [])).toBe(BASE);
  });

  it('prepends the memory block to the base prompt', () => {
    const merged = injectFactsMemory(BASE, FACTS);
    expect(merged.startsWith('<memory>\n')).toBe(true);
    expect(merged.endsWith(BASE)).toBe(true);
  });

  it('opens the <memory> tag exactly once per call', () => {
    const once = injectFactsMemory(BASE, FACTS);
    const openTagCount = (once.match(/<memory>/g) ?? []).length;
    expect(openTagCount).toBe(1);
  });
});

describe('ordering: memory before workspace_context', () => {
  it('memory block comes BEFORE workspace_context when both are injected', () => {
    // Simulate the exact concatenation AIChatViewer does: facts prefix,
    // then workspace prefix, then base role.
    const factsBlock = buildFactsMemoryBlock(FACTS);
    const workspaceBlock = buildWorkspaceContextBlock([
      {
        path: 'pricing.md',
        chunkText: 'Premium is $49.',
        score: 0.9,
        paragraphIndex: 1,
      },
    ]);
    const combined = `${factsBlock}\n\n${workspaceBlock}\n\nYou are a helpful AI assistant.`;
    const memoryPos = combined.indexOf('<memory>');
    const workspacePos = combined.indexOf('<workspace_context>');
    expect(memoryPos).toBeGreaterThanOrEqual(0);
    expect(workspacePos).toBeGreaterThan(memoryPos);
  });

  it('omits <memory> entirely when facts is empty but keeps workspace_context', () => {
    const factsBlock = buildFactsMemoryBlock([]);
    const workspaceBlock = buildWorkspaceContextBlock([
      {
        path: 'pricing.md',
        chunkText: 'Premium is $49.',
        score: 0.9,
        paragraphIndex: 1,
      },
    ]);
    const factsPrefix = factsBlock ? `${factsBlock}\n\n` : '';
    const workspacePrefix = workspaceBlock ? `${workspaceBlock}\n\n` : '';
    const combined = `${factsPrefix}${workspacePrefix}You are a helpful AI assistant.`;
    expect(combined).not.toContain('<memory>');
    expect(combined).toContain('<workspace_context>');
  });
});
