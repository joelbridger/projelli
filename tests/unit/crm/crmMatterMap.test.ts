/**
 * Wealthbox CRM -> matter mapping.
 *
 * Covers:
 *   - buildCrmMatterMap: one entry per (matter, householdId); multi-key
 *     matters emit multiple entries; matters with no keys emit nothing; the
 *     unassigned sentinel is skipped; blank keys are filtered.
 *   - matterStore.createMatter carries `crmHouseholdKeys`.
 *   - addCrmHouseholdKey / removeCrmHouseholdKey mutators work.
 *   - MATTERS_VERSION migrate: v5 -> v6 backfills `crmHouseholdKeys: []`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildCrmMatterMap,
  buildEsignMatterMap,
  filterCrmMatterMapForProvider,
  buildMeetingMatterMap,
  buildOneDriveMatterMap,
  resolveEsignMatterForEnvelope,
} from '@/platform/rag/matterResolver';
import { UNASSIGNED_MATTER_ID, type Matter } from '@/platform/types/matter';
import { useMatterStore } from '@/platform/matter/matterStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matter(
  id: string,
  crmHouseholdKeys: string[],
  extra?: Partial<Matter>
): Matter {
  return {
    id,
    name: id,
    client: '',
    folderPaths: [],
    crmHouseholdKeys,
    createdAt: '',
    ...extra,
  };
}

function resetStore() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
}

// ---------------------------------------------------------------------------
// buildCrmMatterMap (pure)
// ---------------------------------------------------------------------------

describe('buildCrmMatterMap', () => {
  it('emits one entry per (matter, householdId)', () => {
    const matters = [matter('m1', ['hh-001']), matter('m2', ['hh-002'])];
    expect(buildCrmMatterMap(matters)).toEqual([
      { householdId: 'hh-001', matterId: 'm1' },
      { householdId: 'hh-002', matterId: 'm2' },
    ]);
  });

  it('emits multiple entries for a matter with two household keys', () => {
    const matters = [matter('m1', ['hh-001', 'hh-002'])];
    expect(buildCrmMatterMap(matters)).toEqual([
      { householdId: 'hh-001', matterId: 'm1' },
      { householdId: 'hh-002', matterId: 'm1' },
    ]);
  });

  it('emits nothing for a matter with no CRM household keys', () => {
    const matters = [matter('m1', [])];
    expect(buildCrmMatterMap(matters)).toEqual([]);
  });

  it('dedupes a household that appears in TWO matters (first wins) — BUG-B defense', () => {
    // A stale duplicate (the same household claimed by both m1 and m2) must map to
    // exactly ONE matter, or the backend would index it under two matters at once.
    const matters = [matter('m1', ['hh-dup']), matter('m2', ['hh-dup'])];
    expect(buildCrmMatterMap(matters)).toEqual([
      { householdId: 'hh-dup', matterId: 'm1' },
    ]);
  });

  it('skips the unassigned sentinel matter', () => {
    const matters = [
      matter(UNASSIGNED_MATTER_ID, ['hh-x']),
      matter('m1', ['hh-001']),
    ];
    expect(buildCrmMatterMap(matters)).toEqual([
      { householdId: 'hh-001', matterId: 'm1' },
    ]);
  });

  it('skips blank household ids within a matter', () => {
    const matters = [matter('m1', ['', 'hh-001', ''])];
    expect(buildCrmMatterMap(matters)).toEqual([
      { householdId: 'hh-001', matterId: 'm1' },
    ]);
  });

  it('returns an empty array when matters list is empty', () => {
    expect(buildCrmMatterMap([])).toEqual([]);
  });

  it('handles matters whose crmHouseholdKeys field is undefined (pre-v6 migration)', () => {
    // A matter loaded from storage before v6 will have the field missing.
    const preMigration = matter('m1', undefined as unknown as string[]);
    expect(buildCrmMatterMap([preMigration])).toEqual([]);
  });

  it('filters a mixed CRM map to the currently syncing provider', () => {
    const map = buildCrmMatterMap([
      matter('wealthbox-matter', ['10001']),
      matter('salesforce-matter', ['sfdc:001HH0000000001AAA']),
      matter('redtail-matter', ['redtail:rt-household']),
    ]);

    expect(filterCrmMatterMapForProvider(map, 'salesforce')).toEqual([
      { householdId: 'sfdc:001HH0000000001AAA', matterId: 'salesforce-matter' },
    ]);
    expect(filterCrmMatterMapForProvider(map, 'wealthbox')).toEqual([
      { householdId: '10001', matterId: 'wealthbox-matter' },
    ]);
    expect(filterCrmMatterMapForProvider(map, 'redtail')).toEqual([
      { householdId: 'redtail:rt-household', matterId: 'redtail-matter' },
    ]);
  });
});

describe('additive connector matter-map shells', () => {
  it('flattens OneDrive, e-signature, and meeting keys', () => {
    const matters: Matter[] = [
      matter('m1', [], {
        onedriveFolderKeys: ['drive-folder-1'],
        esignKeys: ['envelope-1'],
        meetingKeys: ['event-1'],
      }),
      matter('m2', [], {
        onedriveFolderKeys: ['drive-folder-2'],
        esignKeys: ['envelope-2'],
        meetingKeys: ['event-2'],
      }),
    ];

    expect(buildOneDriveMatterMap(matters)).toEqual([
      { folderKey: 'drive-folder-1', matterId: 'm1', destFolder: 'Clients/m1' },
      { folderKey: 'drive-folder-2', matterId: 'm2', destFolder: 'Clients/m2' },
    ]);
    expect(buildEsignMatterMap(matters)).toEqual([
      { esignKey: 'envelope-1', matterId: 'm1' },
      { esignKey: 'm1', matterId: 'm1' },
      { esignKey: 'envelope-2', matterId: 'm2' },
      { esignKey: 'm2', matterId: 'm2' },
    ]);
    expect(buildMeetingMatterMap(matters)).toEqual([
      { meetingKey: 'event-1', matterId: 'm1' },
      { meetingKey: 'event-2', matterId: 'm2' },
    ]);
  });

  it('normalizes meeting keys so emails and names match Calendly invitees', () => {
    const matters: Matter[] = [
      matter('m1', [], { meetingKeys: [' Amelia@Example.COM ', ' Amelia   Rivera '] }),
    ];

    expect(buildMeetingMatterMap(matters)).toEqual([
      { meetingKey: 'amelia@example.com', matterId: 'm1' },
      { meetingKey: 'amelia rivera', matterId: 'm1' },
    ]);
  });

  it('dedupes normalized meeting keys so the first client wins', () => {
    const matters: Matter[] = [
      matter('m1', [], { meetingKeys: [' Amelia@Example.COM ', ' Amelia   Rivera '] }),
      matter('m2', [], { meetingKeys: ['amelia@example.com', 'amelia rivera'] }),
    ];

    expect(buildMeetingMatterMap(matters)).toEqual([
      { meetingKey: 'amelia@example.com', matterId: 'm1' },
      { meetingKey: 'amelia rivera', matterId: 'm1' },
    ]);
  });

  it('skips blanks, duplicates, and the unassigned sentinel', () => {
    const matters: Matter[] = [
      matter(UNASSIGNED_MATTER_ID, [], { onedriveFolderKeys: ['ignored'] }),
      matter('m1', [], { onedriveFolderKeys: ['', 'folder-dup'] }),
      matter('m2', [], { onedriveFolderKeys: ['folder-dup', 'folder-2'] }),
    ];

    expect(buildOneDriveMatterMap(matters)).toEqual([
      { folderKey: 'folder-dup', matterId: 'm1', destFolder: 'Clients/m1' },
      { folderKey: 'folder-2', matterId: 'm2', destFolder: 'Clients/m2' },
    ]);
  });

  it('orders OneDrive folder mappings by longest cloud path first', () => {
    const matters: Matter[] = [
      matter('parent', [], {
        onedriveFolderKeys: ['m365/default/drive-a:/clients/acme'],
      }),
      matter('child', [], {
        onedriveFolderKeys: ['m365/default/drive-a:/clients/acme/pleadings'],
      }),
    ];

    expect(buildOneDriveMatterMap(matters)).toEqual([
      {
        folderKey: 'm365/default/drive-a:/clients/acme/pleadings',
        matterId: 'child',
        destFolder: 'Clients/child',
      },
      {
        folderKey: 'm365/default/drive-a:/clients/acme',
        matterId: 'parent',
        destFolder: 'Clients/parent',
      },
    ]);
  });

  it('keeps same-named OneDrive folders separate by drive id', () => {
    const matters: Matter[] = [
      matter('drive-a-matter', [], {
        onedriveFolderKeys: ['m365/default/drive-a:/clients/acme'],
      }),
      matter('drive-b-matter', [], {
        onedriveFolderKeys: ['m365/default/drive-b:/clients/acme'],
      }),
    ];

    expect(buildOneDriveMatterMap(matters)).toEqual([
      {
        folderKey: 'm365/default/drive-a:/clients/acme',
        matterId: 'drive-a-matter',
        destFolder: 'Clients/drive-a-matter',
      },
      {
        folderKey: 'm365/default/drive-b:/clients/acme',
        matterId: 'drive-b-matter',
        destFolder: 'Clients/drive-b-matter',
      },
    ]);
  });
});

describe('addOneDriveFolderKey', () => {
  beforeEach(resetStore);

  it('adds a OneDrive folder key to an existing matter', () => {
    const { createMatter, addOneDriveFolderKey } = useMatterStore.getState();
    const m = createMatter({ name: 'Patel, Priya', client: 'Patel, Priya' });

    addOneDriveFolderKey(m.id, 'm365/default/drive-a:/clients/patel, priya');

    const updated = useMatterStore
      .getState()
      .matters.find((x) => x.id === m.id);
    expect(updated?.onedriveFolderKeys).toEqual([
      'm365/default/drive-a:/clients/patel, priya',
    ]);
  });

  it('deduplicates repeated OneDrive folder keys on the same matter', () => {
    const { createMatter, addOneDriveFolderKey } = useMatterStore.getState();
    const m = createMatter({ name: 'Patel, Priya', client: 'Patel, Priya' });

    addOneDriveFolderKey(m.id, 'm365/default/drive-a:/clients/patel, priya');
    addOneDriveFolderKey(m.id, 'm365/default/drive-a:/clients/patel, priya');

    const updated = useMatterStore
      .getState()
      .matters.find((x) => x.id === m.id);
    expect(updated?.onedriveFolderKeys).toEqual([
      'm365/default/drive-a:/clients/patel, priya',
    ]);
  });

  it('moves a OneDrive folder key off every other matter when added to a new one', () => {
    const { createMatter, addOneDriveFolderKey } = useMatterStore.getState();
    const key = 'm365/default/drive-a:/clients/webb, marcus & tanya';
    const a = createMatter({
      name: 'A',
      client: 'A',
      onedriveFolderKeys: [key],
    });
    const b = createMatter({ name: 'B', client: 'B' });

    addOneDriveFolderKey(b.id, key);

    const matters = useMatterStore.getState().matters;
    expect(matters.find((x) => x.id === a.id)?.onedriveFolderKeys).toEqual([]);
    expect(matters.find((x) => x.id === b.id)?.onedriveFolderKeys).toEqual([
      key,
    ]);
  });

  it('does nothing for a blank OneDrive folder key', () => {
    const { createMatter, addOneDriveFolderKey } = useMatterStore.getState();
    const m = createMatter({ name: 'Patel, Priya', client: 'Patel, Priya' });

    addOneDriveFolderKey(m.id, '');

    const updated = useMatterStore
      .getState()
      .matters.find((x) => x.id === m.id);
    expect(updated?.onedriveFolderKeys).toEqual([]);
  });
});

describe('buildEsignMatterMap and resolveEsignMatterForEnvelope', () => {
  it('matches recipient email exactly first', () => {
    const matters = [
      matter('m1', [], { name: 'Smith Household', client: 'Smith', esignKeys: ['bob@example.com'] }),
      matter('m2', [], { name: 'Jones Household', client: 'Jones', esignKeys: ['advisor@example.com'] }),
    ];
    expect(resolveEsignMatterForEnvelope(matters, {
      recipientEmails: ['bob@example.com'],
      senderEmail: 'advisor@example.com',
      subject: 'Jones agreement',
    })).toEqual({ matterId: 'm1', needsAssignment: false, reason: '' });
  });

  it('falls back to sender email, fuzzy name, and subject/custom fields', () => {
    const matters = [
      matter('m1', [], { name: 'Smith Household', client: 'Smith' }),
      matter('m2', [], { name: 'Garcia Family', client: 'Garcia' }),
    ];
    expect(resolveEsignMatterForEnvelope(matters, {
      senderEmail: 'garcia@example.com',
      senderName: 'Maria Garcia',
      subject: 'Service agreement',
    }).matterId).toBe('m2');
    expect(resolveEsignMatterForEnvelope(matters, {
      subject: 'Smith Household advisory agreement',
    }).matterId).toBe('m1');
    expect(resolveEsignMatterForEnvelope(matters, {
      customFields: [{ name: 'client', value: 'Garcia' }],
    }).matterId).toBe('m2');
  });

  it('marks ambiguous and unmatched envelopes as unassigned', () => {
    const matters = [
      matter('m1', [], { name: 'Acme', client: 'Acme', esignKeys: ['shared@example.com'] }),
      matter('m2', [], { name: 'Acme', client: 'Acme', esignKeys: ['shared@example.com'] }),
    ];
    expect(resolveEsignMatterForEnvelope(matters, {
      recipientEmails: ['shared@example.com'],
    })).toEqual({
      matterId: UNASSIGNED_MATTER_ID,
      needsAssignment: true,
      reason: 'multiple matters matched this DocuSign envelope',
    });
    expect(resolveEsignMatterForEnvelope(matters, {
      recipientEmails: ['nobody@example.com'],
    })).toEqual({
      matterId: UNASSIGNED_MATTER_ID,
      needsAssignment: true,
      reason: 'no matter matched this DocuSign envelope',
    });
  });
});

// ---------------------------------------------------------------------------
// matterStore — createMatter with crmHouseholdKeys
// ---------------------------------------------------------------------------

describe('matterStore.createMatter with crmHouseholdKeys', () => {
  beforeEach(resetStore);

  it('stores the provided household keys', () => {
    const { createMatter } = useMatterStore.getState();
    const m = createMatter({
      name: 'Smith',
      client: 'Smith',
      crmHouseholdKeys: ['hh-001', 'hh-002'],
    });
    expect(m.crmHouseholdKeys).toEqual(['hh-001', 'hh-002']);
  });

  it('deduplicates household keys at creation time', () => {
    const { createMatter } = useMatterStore.getState();
    const m = createMatter({
      name: 'Smith',
      client: 'Smith',
      crmHouseholdKeys: ['hh-001', 'hh-001'],
    });
    expect(m.crmHouseholdKeys).toEqual(['hh-001']);
  });

  it('filters blank keys at creation time', () => {
    const { createMatter } = useMatterStore.getState();
    const m = createMatter({
      name: 'Smith',
      client: 'Smith',
      crmHouseholdKeys: ['', 'hh-001', ''],
    });
    expect(m.crmHouseholdKeys).toEqual(['hh-001']);
  });

  it('defaults to an empty array when crmHouseholdKeys is omitted', () => {
    const { createMatter } = useMatterStore.getState();
    const m = createMatter({ name: 'Jones', client: 'Jones' });
    expect(m.crmHouseholdKeys).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// matterStore — addCrmHouseholdKey / removeCrmHouseholdKey
// ---------------------------------------------------------------------------

describe('addCrmHouseholdKey / removeCrmHouseholdKey', () => {
  beforeEach(resetStore);

  it('adds a household key to an existing matter', () => {
    const { createMatter, addCrmHouseholdKey } = useMatterStore.getState();
    const m = createMatter({ name: 'Smith', client: 'Smith' });
    addCrmHouseholdKey(m.id, 'hh-001');
    const updated = useMatterStore
      .getState()
      .matters.find((x) => x.id === m.id);
    expect(updated?.crmHouseholdKeys).toContain('hh-001');
  });

  it('does not duplicate an existing key on repeated add', () => {
    const { createMatter, addCrmHouseholdKey } = useMatterStore.getState();
    const m = createMatter({ name: 'Smith', client: 'Smith' });
    addCrmHouseholdKey(m.id, 'hh-001');
    addCrmHouseholdKey(m.id, 'hh-001');
    const updated = useMatterStore
      .getState()
      .matters.find((x) => x.id === m.id);
    expect(
      updated?.crmHouseholdKeys?.filter((k) => k === 'hh-001')
    ).toHaveLength(1);
  });

  it('removes a household key', () => {
    const { createMatter, addCrmHouseholdKey, removeCrmHouseholdKey } =
      useMatterStore.getState();
    const m = createMatter({
      name: 'Smith',
      client: 'Smith',
      crmHouseholdKeys: ['hh-001', 'hh-002'],
    });
    removeCrmHouseholdKey(m.id, 'hh-001');
    const updated = useMatterStore
      .getState()
      .matters.find((x) => x.id === m.id);
    expect(updated?.crmHouseholdKeys).toEqual(['hh-002']);
  });

  it('moves a household key OFF every other matter when added to a new one (BUG-B)', () => {
    // Re-linking a household to a new matter must remove it from its old matter, so it
    // is never claimed by (and re-indexed + orphaned under) two matters at once.
    const { createMatter, addCrmHouseholdKey } = useMatterStore.getState();
    const a = createMatter({
      name: 'A',
      client: 'A',
      crmHouseholdKeys: ['hh-move'],
    });
    const b = createMatter({ name: 'B', client: 'B' });
    addCrmHouseholdKey(b.id, 'hh-move');
    const matters = useMatterStore.getState().matters;
    expect(matters.find((x) => x.id === a.id)?.crmHouseholdKeys).toEqual([]); // removed from A
    expect(matters.find((x) => x.id === b.id)?.crmHouseholdKeys).toEqual([
      'hh-move',
    ]); // now on B
  });

  it('add is a no-op for a blank key', () => {
    const { createMatter, addCrmHouseholdKey } = useMatterStore.getState();
    const m = createMatter({ name: 'Smith', client: 'Smith' });
    addCrmHouseholdKey(m.id, '');
    const updated = useMatterStore
      .getState()
      .matters.find((x) => x.id === m.id);
    expect(updated?.crmHouseholdKeys).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// matterStore migration: version < 7 backfills connector key arrays
// ---------------------------------------------------------------------------

describe('matterStore migration v5 -> v7', () => {
  beforeEach(() => {
    localStorage.clear();
    useMatterStore.setState({ matters: [], activeMatterId: null });
  });

  it('backfills crmHouseholdKeys: [] for a v5 matter that has the field missing', () => {
    // Seed a v5 matter without crmHouseholdKeys (as stored before v6).
    const v5Matter = {
      id: 'm-legacy',
      name: 'Legacy Matter',
      client: 'Legacy Client',
      folderPaths: [],
      mailFolderPaths: [],
      mcpAccessGranted: false,
      privileged: false,
      shared: false,
      createdAt: '2026-01-01T00:00:00Z',
      // crmHouseholdKeys is intentionally absent
    };
    localStorage.setItem(
      'lantern:matters',
      JSON.stringify({
        state: { matters: [v5Matter], activeMatterId: null },
        version: 5,
      })
    );

    // Trigger hydration by calling rehydrate.
    useMatterStore.persist.rehydrate();

    const matters = useMatterStore.getState().matters;
    const m = matters.find((x) => x.id === 'm-legacy');
    expect(m).toBeDefined();
    // After migration the field must be an empty array, never undefined.
    expect(m?.crmHouseholdKeys).toEqual([]);
    expect(m?.onedriveFolderKeys).toEqual([]);
    expect(m?.esignKeys).toEqual([]);
    expect(m?.meetingKeys).toEqual([]);
  });
});
