/**
 * M5 — AI attribution in version history.
 *
 * Verifies that `VersionService.saveVersion` correctly records the
 * extended M5 fields (`author`, `aiMetadata` — prompt, model,
 * hunkIndex, hunkRange) on AI-authored changes, and that legacy
 * callers that pass only a message string still get a clean version
 * record (backward-compatible).
 *
 * We test the service directly rather than driving it through the
 * inline-edit hook — the hook's behaviour is covered by the
 * hunk-accept-reject test — because this is the contract for every
 * future surface (AI edit, AI rewrite, future "AI completion") that
 * will write to the version history.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VersionService } from '@/features/documents/versioning/VersionService';

describe('VersionService AI attribution (M5)', () => {
  beforeEach(() => {
    // Isolate each test — localStorage is shared by default.
    localStorage.clear();
  });

  it('records author=ai and aiMetadata when saving an AI-authored version', async () => {
    const svc = new VersionService(50);
    const version = await svc.saveVersion(
      '/ws/notes.md',
      'New content after AI edit',
      'AI edit',
      {
        author: 'ai',
        aiMetadata: {
          prompt: 'tighten this to 3 sentences',
          model: 'anthropic/claude-haiku-4-5',
          hunkIndex: 0,
          hunkRange: { start: 42, end: 128 },
        },
      }
    );

    expect(version.author).toBe('ai');
    expect(version.aiMetadata).toBeDefined();
    expect(version.aiMetadata!.prompt).toBe('tighten this to 3 sentences');
    expect(version.aiMetadata!.model).toBe('anthropic/claude-haiku-4-5');
    expect(version.aiMetadata!.hunkIndex).toBe(0);
    expect(version.aiMetadata!.hunkRange).toEqual({ start: 42, end: 128 });
    expect(version.message).toBe('AI edit');
  });

  it('omits author and aiMetadata when legacy callers pass only message', async () => {
    const svc = new VersionService(50);
    const version = await svc.saveVersion(
      '/ws/notes.md',
      'New content after manual save',
      'Auto-saved version'
    );
    expect(version.author).toBeUndefined();
    expect(version.aiMetadata).toBeUndefined();
    expect(version.message).toBe('Auto-saved version');
  });

  it('round-trips AI attribution through localStorage persistence', async () => {
    const svc = new VersionService(50);
    await svc.saveVersion('/ws/a.md', 'v1 content', 'AI edit', {
      author: 'ai',
      aiMetadata: {
        prompt: 'make it punchier',
        model: 'openai/gpt-4o-mini',
        hunkIndex: 2,
        hunkRange: { start: 0, end: 50 },
      },
    });
    // New instance reads from the same localStorage.
    const svc2 = new VersionService(50);
    const versions = svc2.getVersions('/ws/a.md');
    expect(versions).toHaveLength(1);
    expect(versions[0]!.author).toBe('ai');
    expect(versions[0]!.aiMetadata?.prompt).toBe('make it punchier');
    expect(versions[0]!.aiMetadata?.hunkIndex).toBe(2);
  });

  it('allows multiple AI versions for the same file with distinct hunk indices', async () => {
    const svc = new VersionService(50);
    await svc.saveVersion('/ws/b.md', 'after hunk 0', 'AI edit', {
      author: 'ai',
      aiMetadata: {
        prompt: 'fix spelling',
        model: 'anthropic/claude-haiku-4-5',
        hunkIndex: 0,
        hunkRange: { start: 0, end: 20 },
      },
    });
    await svc.saveVersion('/ws/b.md', 'after hunk 1', 'AI edit', {
      author: 'ai',
      aiMetadata: {
        prompt: 'fix spelling',
        model: 'anthropic/claude-haiku-4-5',
        hunkIndex: 1,
        hunkRange: { start: 20, end: 40 },
      },
    });
    const versions = svc.getVersions('/ws/b.md');
    expect(versions).toHaveLength(2);
    // Newest first (unshifted).
    expect(versions[0]!.aiMetadata?.hunkIndex).toBe(1);
    expect(versions[1]!.aiMetadata?.hunkIndex).toBe(0);
  });

  it('supports mixed user+ai history on the same file', async () => {
    const svc = new VersionService(50);
    await svc.saveVersion('/ws/c.md', 'manual v1', 'manual save');
    await svc.saveVersion('/ws/c.md', 'ai v1', 'AI edit', {
      author: 'ai',
      aiMetadata: {
        prompt: 'tighten this',
        model: 'anthropic/claude-haiku-4-5',
        hunkIndex: 0,
        hunkRange: { start: 0, end: 10 },
      },
    });
    await svc.saveVersion('/ws/c.md', 'manual v2', 'manual save', {
      author: 'user',
    });
    const versions = svc.getVersions('/ws/c.md');
    expect(versions).toHaveLength(3);
    const authors = versions.map((v) => v.author);
    expect(authors).toEqual(['user', 'ai', undefined]);
  });
});
