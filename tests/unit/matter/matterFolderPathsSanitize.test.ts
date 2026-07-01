/**
 * Matter `folderPaths` sanitisation (2026-07-01 QA re-fix — SEVERE).
 *
 * `Matter.folderPaths` is TYPED `string[]`, but persisted localStorage
 * (`lantern:matters`) is hydrated by casting the saved JSON straight to
 * `Matter[]` — no runtime re-validation. Every prior `migrate()` step only
 * ADDED fields; none re-checked `folderPaths`. So a persisted matter carrying a
 * NON-STRING entry (a folder-picker `{path,name}` object, or a corrupted write)
 * survived into `folderPaths[0]` and later stringified to the literal
 * `"[object Object]"` when used as a create target — the exact real-Windows bug
 * where scoped "New document" wrote to a garbage folder named `[object Object]`
 * and the scoped Grid/Tree showed empty.
 *
 * These tests pin the two guards that close that hole:
 *   1. the v8 -> v9 migration re-validates `folderPaths` on hydrate;
 *   2. `createMatter` / `setFolderPaths` / `addFolderPath` coerce at runtime too.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMatterStore } from '@/platform/matter/matterStore';

const MATTERS_KEY = 'lantern:matters';

function seed(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

beforeEach(() => {
  localStorage.clear();
  useMatterStore.setState({
    matters: [],
    activeMatterId: null,
    snapshots: {},
    cache: {},
    statusByMatterId: {},
  });
});

describe('matter folderPaths — persisted-store migration sanitises non-string entries', () => {
  it('coerces an OBJECT folderPaths entry ({path,name}) to its .path string on hydrate', async () => {
    // A v8 persisted matter whose folderPaths[0] is a folder-picker object.
    seed(MATTERS_KEY, {
      state: {
        matters: [
          {
            id: 'm1',
            name: 'Acme',
            client: 'Acme',
            // Corrupted shape: an object where a string path belongs.
            folderPaths: [{ path: '/ws/Acme', name: 'Acme' }],
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        activeMatterId: 'm1',
      },
      version: 8,
    });
    await useMatterStore.persist.rehydrate();
    const m = useMatterStore.getState().matters[0]!;
    // Every entry is now a real string; nothing stringifies to "[object Object]".
    expect(m.folderPaths).toEqual(['/ws/Acme']);
    expect(m.folderPaths.every((p) => typeof p === 'string')).toBe(true);
    expect(m.folderPaths.join('')).not.toContain('[object Object]');
  });

  it('drops an unusable object (no path/folderPath) rather than keeping garbage', async () => {
    seed(MATTERS_KEY, {
      state: {
        matters: [
          {
            id: 'm1',
            name: 'Acme',
            client: 'Acme',
            folderPaths: ['/ws/Good', { nope: true }, 42, null],
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        activeMatterId: null,
      },
      version: 8,
    });
    await useMatterStore.persist.rehydrate();
    const m = useMatterStore.getState().matters[0]!;
    expect(m.folderPaths).toEqual(['/ws/Good']);
  });

  it('leaves an already-clean folderPaths untouched (idempotent)', async () => {
    seed(MATTERS_KEY, {
      state: {
        matters: [
          { id: 'm1', name: 'Acme', client: 'Acme', folderPaths: ['/ws/Acme'], createdAt: '2026-01-01T00:00:00.000Z' },
        ],
        activeMatterId: null,
      },
      version: 8,
    });
    await useMatterStore.persist.rehydrate();
    expect(useMatterStore.getState().matters[0]!.folderPaths).toEqual(['/ws/Acme']);
  });
});

describe('matter folderPaths — runtime writes coerce non-string entries', () => {
  it('createMatter coerces an object folderPaths entry to a string', () => {
    // An untyped caller (JS at runtime) can slip an object past the string[] type.
    const m = useMatterStore.getState().createMatter({
      name: 'Acme',
      client: 'Acme',
      folderPaths: [{ path: '/ws/Acme' } as unknown as string],
    });
    expect(m.folderPaths).toEqual(['/ws/Acme']);
  });

  it('setFolderPaths coerces a mixed array to clean strings', () => {
    const m = useMatterStore.getState().createMatter({ name: 'A', client: 'A', folderPaths: ['/ws/A'] });
    useMatterStore.getState().setFolderPaths(m.id, [
      { path: '/ws/B' } as unknown as string,
      '/ws/C',
      { junk: 1 } as unknown as string,
    ]);
    const updated = useMatterStore.getState().matters.find((x) => x.id === m.id)!;
    expect(updated.folderPaths).toEqual(['/ws/B', '/ws/C']);
  });
});
