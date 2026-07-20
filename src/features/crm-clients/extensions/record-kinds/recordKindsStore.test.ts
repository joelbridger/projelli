import { describe, expect, it, vi } from 'vitest';
import {
  createContactRecordStore,
  type ContactRecordStore,
  type ContactRef,
} from '@/features/crm-contacts';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  RecordKindsIsolationError,
  createEmptyRecordKindsDetails,
  createRecordKindsRepository,
  sealRecordKindsClientScope,
  type RecordKindsDraft,
  type RecordKindsRepository,
  type SealedRecordKindsClientScope,
} from './recordKindsStore';

function liveFixture(initial: readonly LiveCrmRecord[] = []) {
  const state = { records: structuredClone(initial) as LiveCrmRecord[] };
  const live = {
    get records() {
      return state.records;
    },
    sharedMatterId: null,
    save: vi.fn((record: LiveCrmRecord) => {
      const saved = structuredClone(record);
      state.records = state.records.some(
        (candidate) => candidate.id === saved.id
      )
        ? state.records.map((candidate) =>
            candidate.id === saved.id ? saved : candidate
          )
        : [...state.records, saved];
      return Promise.resolve(saved);
    }),
    reloadRecords: vi.fn(() => Promise.resolve(structuredClone(state.records))),
  };
  return { state, live };
}

function scope() {
  return sealRecordKindsClientScope({
    householdRef: {
      kind: 'household',
      id: 'household:selected',
      matterId: 'matter-a',
    },
    matterId: 'matter-a',
  });
}

const editedDetails = {
  version: 1 as const,
  profile: {
    address: '4821 Bluebird Lane',
    preferredContact: 'Email, then mobile',
    serviceTier: 'Private wealth',
    background: 'Annual review client',
  },
  facts: [{ id: 'fact:goal', label: 'Retirement goal', value: 'Age 65' }],
  accounts: [
    {
      id: 'account:joint',
      institution: 'Schwab',
      accountType: 'Joint brokerage',
      lastFour: '4421',
      relationship: 'Household',
    },
  ],
};

function draftFor(
  kind: 'household' | 'person',
  name: string
): RecordKindsDraft {
  return {
    ...(kind === 'household'
      ? { name }
      : {
          firstName: name.split(' ')[0] ?? '',
          lastName: name.split(' ')[1] ?? '',
        }),
    lifecycle: 'Active',
    primaryAdvisor: 'Sarah Morgan',
    channels: [
      {
        id: `channel:${kind}:email`,
        kind: 'email:work',
        address: `${kind}@example.com`,
        primary: true,
      },
      {
        id: `channel:${kind}:phone`,
        kind: 'phone:mobile',
        address: '(480) 555-0142',
        primary: true,
      },
    ],
    details: editedDetails,
  };
}

async function expectEveryBoundaryToRefuse(
  repository: RecordKindsRepository,
  badScope: SealedRecordKindsClientScope
) {
  const ref: ContactRef = {
    kind: 'person',
    id: 'person:target',
    matterId: 'matter-a',
  };
  const draft = draftFor('person', 'Maya Patel');
  await expect(repository.list(badScope)).rejects.toBeInstanceOf(
    RecordKindsIsolationError
  );
  await expect(repository.read(badScope, ref)).rejects.toBeInstanceOf(
    RecordKindsIsolationError
  );
  await expect(
    repository.create(
      badScope,
      { kind: 'person', firstName: 'Maya' },
      createEmptyRecordKindsDetails()
    )
  ).rejects.toBeInstanceOf(RecordKindsIsolationError);
  await expect(repository.update(badScope, ref, draft)).rejects.toBeInstanceOf(
    RecordKindsIsolationError
  );
}

describe('record-kinds paired client repository', () => {
  it('creates, edits, and reopens household and individual details without losing rows', async () => {
    // The selected client's household exists in canonical storage (you are
    // viewing it) — pair-integrity requires it. Record-kinds adds individuals.
    const persisted = liveFixture([
      {
        id: 'household:selected',
        kind: 'household',
        matterId: 'matter-a',
        name: 'Foster household',
        lifecycle: 'Active',
        primaryAdvisor: 'Sarah Morgan',
        channels: [],
        contactLinks: [],
        contextRefs: [],
        tagIds: [],
      },
    ]);
    const firstContacts = createContactRecordStore(persisted.live);
    const first = createRecordKindsRepository(firstContacts);
    const sealed = scope();
    const householdRef: ContactRef = {
      kind: 'household',
      id: 'household:selected',
      matterId: 'matter-a',
    };

    const person = await first.create(
      sealed,
      {
        kind: 'person',
        firstName: 'Robert',
        lastName: 'Foster',
        primaryAdvisor: 'Sarah Morgan',
      },
      createEmptyRecordKindsDetails()
    );

    await first.update(sealed, householdRef, draftFor('household', 'Foster family'));
    await first.update(sealed, person.ref, draftFor('person', 'Robert Foster'));

    const reopenedContacts = createContactRecordStore(persisted.live);
    const reopened = createRecordKindsRepository(reopenedContacts);
    const records = await reopened.list(sealed);
    expect(records).toHaveLength(2);

    for (const ref of [householdRef, person.ref]) {
      const saved = await reopened.read(sealed, ref);
      expect(saved).not.toBeNull();
      expect(saved?.record.channels).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'email:work', primary: true }),
          expect.objectContaining({ kind: 'phone:mobile', primary: true }),
        ])
      );
      expect(saved?.details).toEqual(editedDetails);
    }
  });

  it('refuses when the selected household is absent from canonical storage (fail closed, never empty)', async () => {
    // An empty store means the selected household does not exist. Pre-fix this
    // returned an empty list; that is exactly the boundary Finding #2 closes —
    // the pair was never proven against canonical storage.
    const persisted = liveFixture();
    const repository = createRecordKindsRepository(
      createContactRecordStore(persisted.live)
    );
    const sealed = scope();
    await expect(repository.list(sealed)).rejects.toBeInstanceOf(
      RecordKindsIsolationError
    );
    await expect(
      repository.read(sealed, {
        kind: 'household',
        id: 'household:missing',
        matterId: 'matter-a',
      })
    ).rejects.toBeInstanceOf(RecordKindsIsolationError);
  });

  it('lists just the household for a client that has no individuals yet', async () => {
    const persisted = liveFixture([
      {
        id: 'household:selected',
        kind: 'household',
        matterId: 'matter-a',
        name: 'Foster household',
        lifecycle: 'Active',
        channels: [],
        contactLinks: [],
        contextRefs: [],
        tagIds: [],
      },
    ]);
    const repository = createRecordKindsRepository(
      createContactRecordStore(persisted.live)
    );
    const sealed = scope();
    const records = await repository.list(sealed);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.id).toBe('household:selected');
    // A missing target inside a verified pair resolves to null, not a refusal.
    await expect(
      repository.read(sealed, {
        kind: 'person',
        id: 'person:missing',
        matterId: 'matter-a',
      })
    ).resolves.toBeNull();
  });

  it('refuses a forged pair: a mismatched household id aimed at a real matter (Finding #2)', async () => {
    // Canonical storage: household:x owns matter-a and holds a real individual.
    const persisted = liveFixture([
      {
        id: 'household:x',
        kind: 'household',
        matterId: 'matter-a',
        name: 'Real household',
        lifecycle: 'Active',
        channels: [],
        contactLinks: [{ contactId: 'person:x', kind: 'person' }],
        contextRefs: [],
        tagIds: [],
      },
      {
        id: 'person:x',
        kind: 'person',
        matterId: 'matter-a',
        firstName: 'Real',
        lastName: 'Client',
        lifecycle: 'Active',
        channels: [],
        contactLinks: [],
        contextRefs: [],
        tagIds: [],
      },
    ]);
    const repository = createRecordKindsRepository(
      createContactRecordStore(persisted.live)
    );
    // A structurally valid sealed pair for a household id that does NOT own
    // matter-a, pointed at the real matter-a. Pre-fix, list() leaked every
    // contact in matter-a. Now the canonical pair cannot be resolved → refuse.
    const forged = sealRecordKindsClientScope({
      householdRef: {
        kind: 'household',
        id: 'household:forged',
        matterId: 'matter-a',
      },
      matterId: 'matter-a',
    });
    await expect(repository.list(forged)).rejects.toBeInstanceOf(
      RecordKindsIsolationError
    );
    await expect(
      repository.read(forged, {
        kind: 'person',
        id: 'person:x',
        matterId: 'matter-a',
      })
    ).rejects.toBeInstanceOf(RecordKindsIsolationError);
  });

  it('refuses when the household exists but canonically owns a different matter', async () => {
    const persisted = liveFixture([
      {
        id: 'household:selected',
        kind: 'household',
        matterId: 'matter-other',
        name: 'Foster household',
        lifecycle: 'Active',
        channels: [],
        contactLinks: [],
        contextRefs: [],
        tagIds: [],
      },
    ]);
    const repository = createRecordKindsRepository(
      createContactRecordStore(persisted.live)
    );
    // scope() aims household:selected at matter-a, but it canonically owns
    // matter-other — the pair is not owned → refuse before any read.
    await expect(repository.list(scope())).rejects.toBeInstanceOf(
      RecordKindsIsolationError
    );
  });

  it('refuses undefined, partial, and mismatched household/matter pairs at every read and write', async () => {
    const contacts = {
      records: [],
      unpairedContactDocuments: [],
      listDirectory: vi.fn(),
      get: vi.fn(),
      resolve: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      linkContact: vi.fn(),
      unlinkContact: vi.fn(),
      listRelated: vi.fn(),
    } satisfies ContactRecordStore;
    const repository = createRecordKindsRepository(contacts);
    const sealed = scope();
    const runtimeSeal = Object.getOwnPropertySymbols(sealed)[0];
    if (!runtimeSeal) throw new Error('Expected the runtime client-pair seal.');
    const mismatched = {
      householdRef: sealed.householdRef,
      matterId: 'matter-b',
    } as unknown as SealedRecordKindsClientScope;
    Object.defineProperty(mismatched, runtimeSeal, { value: true });
    const invalid = [
      undefined,
      { matterId: 'matter-a' },
      mismatched,
      {
        householdRef: {
          kind: 'household',
          id: '',
          matterId: 'matter-a',
        },
        matterId: 'matter-a',
      },
    ] as unknown as readonly SealedRecordKindsClientScope[];

    for (const badScope of invalid) {
      await expectEveryBoundaryToRefuse(repository, badScope);
    }
    expect(contacts.resolve).not.toHaveBeenCalled();
    expect(contacts.create).not.toHaveBeenCalled();
    expect(contacts.update).not.toHaveBeenCalled();
  });

  it('refuses a target reference from another client workspace before reading or writing', async () => {
    const persisted = liveFixture();
    const contacts = createContactRecordStore(persisted.live);
    const repository = createRecordKindsRepository(contacts);
    const otherMatterRef: ContactRef = {
      kind: 'person',
      id: 'person:other',
      matterId: 'matter-b',
    };
    await expect(
      repository.read(scope(), otherMatterRef)
    ).rejects.toBeInstanceOf(RecordKindsIsolationError);
    await expect(
      repository.update(
        scope(),
        otherMatterRef,
        draftFor('person', 'Other Client')
      )
    ).rejects.toBeInstanceOf(RecordKindsIsolationError);
  });

  it('refuses a legacy household with no matter pair instead of reporting empty', async () => {
    const persisted = liveFixture([
      {
        id: 'household:selected',
        kind: 'household',
        name: 'Legacy Foster household',
      },
    ]);
    const repository = createRecordKindsRepository(
      createContactRecordStore(persisted.live)
    );
    await expect(repository.list(scope())).rejects.toBeInstanceOf(
      RecordKindsIsolationError
    );
  });

  it('refuses when a linked individual is missing its matter pair, never a partial roster', async () => {
    const persisted = liveFixture([
      {
        id: 'household:selected',
        kind: 'household',
        matterId: 'matter-a',
        name: 'Foster household',
        contactLinks: [{ contactId: 'person:legacy', kind: 'person' }],
      },
      {
        id: 'person:legacy',
        kind: 'person',
        firstName: 'Robert',
        lastName: 'Foster',
      },
    ]);
    const repository = createRecordKindsRepository(
      createContactRecordStore(persisted.live)
    );
    await expect(repository.list(scope())).rejects.toBeInstanceOf(
      RecordKindsIsolationError
    );
  });

  it('refuses a malformed document that claims this matter rather than dropping it', async () => {
    const persisted = liveFixture([
      {
        id: 'household:selected',
        kind: 'household',
        matterId: 'matter-a',
        name: 'Foster household',
        lifecycle: 'Active',
        channels: [],
        contactLinks: [],
        contextRefs: [],
        tagIds: [],
      },
      {
        id: 'person:broken',
        kind: 'person',
        matterId: 'matter-a',
      },
    ]);
    const repository = createRecordKindsRepository(
      createContactRecordStore(persisted.live)
    );
    await expect(repository.list(scope())).rejects.toBeInstanceOf(
      RecordKindsIsolationError
    );
  });

  it('does not let another client’s unpaired record block this client', async () => {
    const persisted = liveFixture([
      {
        id: 'household:selected',
        kind: 'household',
        matterId: 'matter-a',
        name: 'Foster household',
      },
      { id: 'household:foreign', kind: 'household', name: 'Unpaired stranger' },
    ]);
    const repository = createRecordKindsRepository(
      createContactRecordStore(persisted.live)
    );
    const records = await repository.list(scope());
    expect(records).toHaveLength(1);
    expect(records[0]?.record.displayName).toBe('Foster household');
  });

  it('keeps malformed saved details on the error branch instead of calling them empty', async () => {
    const persisted = liveFixture([
      {
        id: 'household:selected',
        kind: 'household',
        matterId: 'matter-a',
        name: 'Foster household',
        extensionData: {
          'record-kinds.v1': { version: 1, facts: 'not-a-list' },
        },
      },
    ]);
    const repository = createRecordKindsRepository(
      createContactRecordStore(persisted.live)
    );
    await expect(repository.list(scope())).rejects.toThrow(
      'Saved contact profile is malformed.'
    );
  });
});
