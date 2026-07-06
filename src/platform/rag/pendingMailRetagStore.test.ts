/**
 * QA-44 (R7-6) — the persisted mail-retag store must VALIDATE its hydrated shape.
 * A corrupt/partial `localStorage` blob keeps its well-formed records (still held),
 * drops malformed ones rather than trusting a garbage hold, and marks the store
 * SUSPECT so the restore surfaces a visible banner — fail closed, not silent open.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  __resetPendingMailRetagHydrationSuspect,
  pendingMailRetagHydrationSuspect,
  sanitizePersistedMailRetag,
  usePendingMailRetagStore,
} from './pendingMailRetagStore';
import { mailFolderKey } from './matterResolver';
import { workspaceScopeId } from '@/platform/state/workspaceScope';

const goodIntent = {
  workspaceRoot: '/wsA',
  provider: 'm365',
  account: 'acct',
  folderId: 'Inbox',
  targetMatter: 'B',
  staleMatters: ['A'],
};

function expectedMailIntentKey(intent: typeof goodIntent): string {
  return `${workspaceScopeId(intent.workspaceRoot)}\u0000${mailFolderKey(
    intent.provider,
    intent.account,
    intent.folderId
  )}`;
}

afterEach(() => {
  usePendingMailRetagStore.setState({ intents: {} });
  __resetPendingMailRetagHydrationSuspect();
});

describe('pendingMailRetagStore workspace identity (QA-93)', () => {
  it('restores a hold when the same workspace is reopened with equivalent spelling', () => {
    const s = usePendingMailRetagStore.getState();
    const firstOpen = 'C:\\Practice\\Acme\\.\\';
    const reopened = 'c:/Practice/Acme';
    const folderKey = mailFolderKey('m365', 'acct', 'Inbox');

    s.record({
      workspaceRoot: firstOpen,
      provider: 'm365',
      account: 'acct',
      folderId: 'Inbox',
      targetMatter: 'B',
      staleMatters: ['A'],
    });

    expect(s.forWorkspace(reopened)).toEqual([
      {
        workspaceRoot: workspaceScopeId(firstOpen),
        provider: 'm365',
        account: 'acct',
        folderId: 'Inbox',
        targetMatter: 'B',
        staleMatters: ['A'],
      },
    ]);

    s.clear(reopened, folderKey);
    expect(s.forWorkspace(firstOpen)).toEqual([]);
  });
});

describe('sanitizePersistedMailRetag (R7-6 shape validation)', () => {
  it('keeps a well-formed intent and does NOT flag suspicion', () => {
    const out = sanitizePersistedMailRetag({ intents: { k: goodIntent } });
    expect(out.intents[expectedMailIntentKey(goodIntent)]).toEqual(goodIntent);
    expect(pendingMailRetagHydrationSuspect()).toBe(false);
  });

  it('drops a malformed record, keeps the good ones, and flags suspicion', () => {
    const out = sanitizePersistedMailRetag({
      intents: {
        good: goodIntent,
        badStale: { ...goodIntent, staleMatters: 'not-an-array' },
        missingField: { workspaceRoot: '/wsA', provider: 'm365' },
        notObject: 42,
      },
    });
    expect(out.intents[expectedMailIntentKey(goodIntent)]).toEqual(goodIntent);
    expect(out.intents['badStale']).toBeUndefined();
    expect(out.intents['missingField']).toBeUndefined();
    expect(out.intents['notObject']).toBeUndefined();
    // A dropped record means the restored hold set may be incomplete → suspect.
    expect(pendingMailRetagHydrationSuspect()).toBe(true);
  });

  it('flags a wholly wrong-shaped blob and yields no intents', () => {
    const out = sanitizePersistedMailRetag({ intents: 'garbage' });
    expect(out.intents).toEqual({});
    expect(pendingMailRetagHydrationSuspect()).toBe(true);
  });

  it('rejects a stale-matters array containing a non-string', () => {
    const out = sanitizePersistedMailRetag({
      intents: { k: { ...goodIntent, staleMatters: ['A', 7] } },
    });
    expect(out.intents['k']).toBeUndefined();
    expect(pendingMailRetagHydrationSuspect()).toBe(true);
  });

  it('treats a legitimately empty / absent store as NOT suspect', () => {
    expect(sanitizePersistedMailRetag(undefined).intents).toEqual({});
    expect(sanitizePersistedMailRetag(null).intents).toEqual({});
    expect(sanitizePersistedMailRetag({ intents: {} }).intents).toEqual({});
    expect(pendingMailRetagHydrationSuspect()).toBe(false);
  });

  it('rekeys a legacy raw workspace root during hydration without marking suspicion', () => {
    const rawRoot = 'C:\\Practice\\Acme\\.\\';
    const canonicalRoot = workspaceScopeId(rawRoot);
    const folderKey = mailFolderKey('m365', 'acct', 'Inbox');
    const out = sanitizePersistedMailRetag({
      intents: {
        [`${rawRoot}\u0000${folderKey}`]: {
          ...goodIntent,
          workspaceRoot: rawRoot,
        },
      },
    });

    expect(Object.keys(out.intents)).toEqual([
      `${canonicalRoot}\u0000${folderKey}`,
    ]);
    expect(
      out.intents[`${canonicalRoot}\u0000${folderKey}`]?.workspaceRoot
    ).toBe(canonicalRoot);
    expect(pendingMailRetagHydrationSuspect()).toBe(false);
  });

  it('merges equivalent legacy raw roots into the same hydrated bucket', () => {
    const rawRoot = 'C:\\Practice\\Acme\\.\\';
    const reopened = 'c:/Practice/Acme';
    const canonicalRoot = workspaceScopeId(rawRoot);
    const folderKey = mailFolderKey('m365', 'acct', 'Inbox');
    const out = sanitizePersistedMailRetag({
      intents: {
        [`${rawRoot}\u0000${folderKey}`]: {
          ...goodIntent,
          workspaceRoot: rawRoot,
        },
        [`${reopened}\u0000${folderKey}`]: {
          ...goodIntent,
          workspaceRoot: reopened,
          staleMatters: ['C'],
        },
      },
    });

    expect(Object.keys(out.intents)).toEqual([
      `${canonicalRoot}\u0000${folderKey}`,
    ]);
    expect(
      out.intents[`${canonicalRoot}\u0000${folderKey}`]?.staleMatters.sort()
    ).toEqual(['A', 'C']);
    expect(pendingMailRetagHydrationSuspect()).toBe(false);
  });
});
