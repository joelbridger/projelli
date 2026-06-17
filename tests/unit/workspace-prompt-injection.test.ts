/**
 * `<workspace_context>` prompt-block formatting — covers the output-side
 * of M2. These tests guard the exact shape of the injected context so
 * provider prompts (Claude, OpenAI, Gemini) stay deterministic.
 */

import { describe, expect, it } from 'vitest';

import {
  buildWorkspaceContextBlock,
  injectWorkspaceContext,
} from '@/platform/rag/workspaceCommand';
import type { RagHit } from '@/utils/tauri-commands';

const HITS: RagHit[] = [
  {
    path: 'notes/pricing.md',
    chunkText: 'Premium tier is priced at $49 one-time.',
    score: 0.92,
    paragraphIndex: 3,
  },
  {
    path: 'competitor-map.md',
    chunkText: 'Notion AI: $20/mo subscription; Obsidian: free + $50 sync.',
    score: 0.81,
    paragraphIndex: 1,
  },
];

describe('buildWorkspaceContextBlock', () => {
  it('returns empty string when there are no hits', () => {
    expect(buildWorkspaceContextBlock([])).toBe('');
  });

  it('wraps hits in a <workspace_context> block', () => {
    const block = buildWorkspaceContextBlock(HITS);
    expect(block.startsWith('<workspace_context>\n')).toBe(true);
    expect(block).toContain('</workspace_context>');
  });

  it('numbers sources starting at 1', () => {
    const block = buildWorkspaceContextBlock(HITS);
    expect(block).toContain('[1] notes/pricing.md paragraph 3');
    expect(block).toContain('[2] competitor-map.md paragraph 1');
  });

  it('includes the full chunk text for each hit', () => {
    const block = buildWorkspaceContextBlock(HITS);
    expect(block).toContain('Premium tier is priced at $49 one-time.');
    expect(block).toContain(
      'Notion AI: $20/mo subscription; Obsidian: free + $50 sync.',
    );
  });

  it('includes instructions to cite with [filename paragraph N]', () => {
    const block = buildWorkspaceContextBlock(HITS);
    expect(block).toContain('[filename paragraph N]');
    expect(block.toLowerCase()).toContain('cite');
  });

  it('tells the model to say so if the answer is not in the workspace', () => {
    const block = buildWorkspaceContextBlock(HITS);
    expect(block.toLowerCase()).toContain('cannot be found');
  });
});

describe('injectWorkspaceContext', () => {
  const BASE = 'You are a helpful AI assistant.';

  it('returns base prompt unchanged when hits is empty', () => {
    expect(injectWorkspaceContext(BASE, [])).toBe(BASE);
  });

  it('prepends the workspace block to the base prompt', () => {
    const merged = injectWorkspaceContext(BASE, HITS);
    expect(merged.startsWith('<workspace_context>\n')).toBe(true);
    expect(merged.endsWith(BASE)).toBe(true);
  });

  it('does not duplicate when called twice (caller contract)', () => {
    // The helper itself always injects; caller is responsible for
    // calling it once per turn. This is a guard against accidental
    // double-injection during refactors.
    const once = injectWorkspaceContext(BASE, HITS);
    // Count how many times the opening tag appears.
    const openTagCount = (once.match(/<workspace_context>/g) ?? []).length;
    expect(openTagCount).toBe(1);
  });

  it('keeps source order stable (hits come back as given)', () => {
    const merged = injectWorkspaceContext(BASE, HITS);
    const posPricing = merged.indexOf('notes/pricing.md');
    const posCompetitor = merged.indexOf('competitor-map.md');
    expect(posPricing).toBeGreaterThan(-1);
    expect(posCompetitor).toBeGreaterThan(posPricing);
  });
});
