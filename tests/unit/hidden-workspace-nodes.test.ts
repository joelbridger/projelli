/**
 * Hidden workspace nodes (UX-21).
 *
 * The internal `.lantern` config folder was shown as a user file in the Files
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
  it('hides Lantern-internal entries (.lantern)', () => {
    expect(isHiddenNode({ name: '.lantern' })).toBe(true);
  });

  it('hides current vault-metadata files (must not be deletable)', () => {
    expect(isHiddenNode({ name: '.lantern-vault.json' })).toBe(true);
  });

  it('does NOT hide ordinary dotfiles — they keep their Show-Hidden behaviour', () => {
    // Regression guard (Codex review): hiding ALL dotfiles kept .gitignore etc.
    // hidden even with "Show Hidden Files" ON. Only .lantern is unconditional.
    expect(isHiddenNode({ name: '.git' })).toBe(false);
    expect(isHiddenNode({ name: '.gitignore' })).toBe(false);
    expect(isHiddenNode({ name: '.env' })).toBe(false);
  });

  it('treats normal names as visible', () => {
    expect(isHiddenNode({ name: 'docs' })).toBe(false);
    expect(isHiddenNode({ name: 'Hendricks Household.docx' })).toBe(false);
  });

  it('filters ONLY .lantern out of a listing, keeping order and the rest', () => {
    const nodes = [
      { name: 'docs' },
      { name: '.lantern' },
      { name: '.gitignore' },
      { name: 'clients' },
    ];
    expect(visibleNodes(nodes).map((n) => n.name)).toEqual([
      'docs',
      '.gitignore',
      'clients',
    ]);
  });
});
