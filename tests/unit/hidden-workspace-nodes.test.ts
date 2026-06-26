/**
 * Hidden workspace nodes (UX-21).
 *
 * The internal `.keepance` config folder was shown as a user file in the Files
 * grid + tree, inviting confusion ("did I make that? can I delete it?") and
 * dangerous deletes. Dot-prefixed nodes are internal and must be hidden from the
 * rendered listing — the same convention the workspace selector already uses.
 */
import { describe, it, expect } from 'vitest';
import {
  isHiddenNode,
  visibleNodes,
} from '@/features/documents/workspace/hiddenNodes';

describe('hidden workspace nodes', () => {
  it('treats dot-prefixed names (e.g. .keepance) as hidden', () => {
    expect(isHiddenNode({ name: '.keepance' })).toBe(true);
    expect(isHiddenNode({ name: '.git' })).toBe(true);
  });

  it('treats normal names as visible', () => {
    expect(isHiddenNode({ name: 'docs' })).toBe(false);
    expect(isHiddenNode({ name: 'Hendricks Household.docx' })).toBe(false);
  });

  it('filters hidden nodes out of a listing, keeping order and the rest', () => {
    const nodes = [
      { name: 'docs' },
      { name: '.keepance' },
      { name: 'clients' },
    ];
    expect(visibleNodes(nodes).map((n) => n.name)).toEqual(['docs', 'clients']);
  });
});
