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
  it('hides Lantern-internal entries (.keepance)', () => {
    expect(isHiddenNode({ name: '.lantern' })).toBe(true);
  });

  it('also hides a leftover/in-place legacy .keepance folder (data-dir migration)', () => {
    // During the `.keepance` → `.lantern` rename migration, a both-exist leftover
    // or the fail-safe case can leave a live/leftover `.keepance` folder. It must
    // stay hidden exactly like `.lantern`, never surfacing as a user file.
    expect(isHiddenNode({ name: '.keepance' })).toBe(true);
  });

  it('hides current and legacy vault-metadata files (recovery copy must not be deletable)', () => {
    // A preserved `.keepance-vault.json` recovery copy (both-metadata conflict)
    // must never surface as a user file the user could delete.
    expect(isHiddenNode({ name: '.lantern-vault.json' })).toBe(true);
    expect(isHiddenNode({ name: '.keepance-vault.json' })).toBe(true);
  });

  it('does NOT hide ordinary dotfiles — they keep their Show-Hidden behaviour', () => {
    // Regression guard (Codex review): hiding ALL dotfiles kept .gitignore etc.
    // hidden even with "Show Hidden Files" ON. Only .keepance is unconditional.
    expect(isHiddenNode({ name: '.git' })).toBe(false);
    expect(isHiddenNode({ name: '.gitignore' })).toBe(false);
    expect(isHiddenNode({ name: '.env' })).toBe(false);
  });

  it('treats normal names as visible', () => {
    expect(isHiddenNode({ name: 'docs' })).toBe(false);
    expect(isHiddenNode({ name: 'Hendricks Household.docx' })).toBe(false);
  });

  it('filters ONLY .keepance out of a listing, keeping order and the rest', () => {
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
