/**
 * WS-B/C — mail -> matter mapping.
 *
 * Verifies the pure resolver helpers (mailFolderKey / parseMailFolderKey /
 * resolveMailMatter / buildMailMatterMap) and the matter-store actions that hold
 * a matter's mail-folder mappings. These mirror the backend `resolve_mail_matter`
 * so the two indexers agree on which matter a synced email lands in.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  mailFolderKey,
  parseMailFolderKey,
  resolveMailMatter,
  buildMailMatterMap,
} from '@/platform/rag/matterResolver';
import { UNASSIGNED_MATTER_ID, type Matter } from '@/types/matter';
import { useMatterStore } from '@/platform/matter/matterStore';

function matter(id: string, mailFolderPaths: string[]): Matter {
  return { id, name: id, client: '', folderPaths: [], mailFolderPaths, createdAt: '' };
}

describe('mail folder key helpers', () => {
  it('builds an account-level key when no folder is given', () => {
    expect(mailFolderKey('m365', 'default')).toBe('m365/default');
    expect(mailFolderKey('m365', 'default', '')).toBe('m365/default');
  });

  it('builds a folder-level key when a folder id is given', () => {
    expect(mailFolderKey('m365', 'default', 'inbox')).toBe('m365/default/inbox');
  });

  it('round-trips account-level and folder-level keys', () => {
    expect(parseMailFolderKey('m365/default')).toEqual({
      provider: 'm365',
      account: 'default',
      folderId: '',
    });
    expect(parseMailFolderKey('m365/default/inbox')).toEqual({
      provider: 'm365',
      account: 'default',
      folderId: 'inbox',
    });
  });

  it('keeps a folder id that itself contains slashes', () => {
    // Gmail-style nested labels can contain slashes; only the first two
    // segments are provider + account.
    expect(parseMailFolderKey('imap/me@x.com/Work/2026')).toEqual({
      provider: 'imap',
      account: 'me@x.com',
      folderId: 'Work/2026',
    });
  });

  it('returns null for a malformed key', () => {
    expect(parseMailFolderKey('noslash')).toBeNull();
    expect(parseMailFolderKey('/account')).toBeNull();
  });
});

describe('resolveMailMatter', () => {
  it('falls back to unassigned when nothing maps the folder', () => {
    const matters = [matter('matter_a', ['m365/default/inbox'])];
    expect(resolveMailMatter(matters, 'm365', 'default', 'sent')).toBe(UNASSIGNED_MATTER_ID);
    expect(resolveMailMatter([], 'm365', 'default', 'inbox')).toBe(UNASSIGNED_MATTER_ID);
  });

  it('resolves an exact folder-level mapping', () => {
    const matters = [matter('matter_a', ['m365/default/inbox'])];
    expect(resolveMailMatter(matters, 'm365', 'default', 'inbox')).toBe('matter_a');
  });

  it('resolves an account-level mapping for any folder in the account', () => {
    const matters = [matter('matter_g', ['gmail/default'])];
    expect(resolveMailMatter(matters, 'gmail', 'default', 'INBOX')).toBe('matter_g');
    expect(resolveMailMatter(matters, 'gmail', 'default', 'Label_42')).toBe('matter_g');
    // A different account is not covered by the mapping.
    expect(resolveMailMatter(matters, 'gmail', 'other', 'INBOX')).toBe(UNASSIGNED_MATTER_ID);
  });

  it('prefers a folder-level mapping over an account-level one', () => {
    const matters = [
      matter('matter_account', ['m365/default']),
      matter('matter_litigation', ['m365/default/litigation']),
    ];
    expect(resolveMailMatter(matters, 'm365', 'default', 'litigation')).toBe('matter_litigation');
    expect(resolveMailMatter(matters, 'm365', 'default', 'inbox')).toBe('matter_account');
  });
});

describe('buildMailMatterMap', () => {
  it('flattens every matter mapping into backend entries', () => {
    const matters = [
      matter('matter_a', ['m365/default/inbox', 'm365/default/sent']),
      matter('matter_b', ['gmail/default']),
    ];
    const map = buildMailMatterMap(matters);
    expect(map).toContainEqual({ provider: 'm365', account: 'default', folderId: 'inbox', matterId: 'matter_a' });
    expect(map).toContainEqual({ provider: 'm365', account: 'default', folderId: 'sent', matterId: 'matter_a' });
    expect(map).toContainEqual({ provider: 'gmail', account: 'default', folderId: '', matterId: 'matter_b' });
    expect(map).toHaveLength(3);
  });

  it('skips malformed keys and the unassigned sentinel', () => {
    const matters = [
      { id: UNASSIGNED_MATTER_ID, name: '', client: '', folderPaths: [], mailFolderPaths: ['m365/default'], createdAt: '' },
      matter('matter_a', ['malformed-no-slash']),
    ];
    expect(buildMailMatterMap(matters)).toEqual([]);
  });
});

describe('matter store mail-folder actions', () => {
  beforeEach(() => {
    useMatterStore.setState({ matters: [], activeMatterId: null });
  });

  it('adds and removes mail-folder keys on a matter', () => {
    const m = useMatterStore.getState().createMatter({ name: 'Acme', client: 'Acme Corp' });
    // New matters start with an empty mail-folder mapping.
    expect(useMatterStore.getState().matters[0]?.mailFolderPaths).toEqual([]);

    useMatterStore.getState().addMailFolderPath(m.id, 'm365/default');
    expect(useMatterStore.getState().matters[0]?.mailFolderPaths).toEqual(['m365/default']);

    // Adding the same key twice is idempotent.
    useMatterStore.getState().addMailFolderPath(m.id, 'm365/default');
    expect(useMatterStore.getState().matters[0]?.mailFolderPaths).toEqual(['m365/default']);

    useMatterStore.getState().removeMailFolderPath(m.id, 'm365/default');
    expect(useMatterStore.getState().matters[0]?.mailFolderPaths).toEqual([]);
  });
});
