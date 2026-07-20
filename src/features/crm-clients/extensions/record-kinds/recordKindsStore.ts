import {
  validateContactRef,
  type ContactChannel,
  type ContactCreateInput,
  type ContactKind,
  type ContactPatch,
  type ContactRecord,
  type ContactRecordStore,
  type ContactRef,
} from '@/features/crm-contacts';

export const RECORD_KINDS_EXTENSION_KEY = 'record-kinds.v1';

declare const sealedRecordKindsClientScopeBrand: unique symbol;
const runtimeScopeSeal = Symbol('record-kinds-client-scope');

export interface SealedRecordKindsClientScope {
  readonly householdRef: ContactRef & { readonly kind: 'household' };
  readonly matterId: string;
  readonly [sealedRecordKindsClientScopeBrand]: true;
}

type RuntimeSealedScope = SealedRecordKindsClientScope & {
  readonly [runtimeScopeSeal]: true;
};

export interface RecordKindsClientScopeInput {
  readonly householdRef: ContactRef;
  readonly matterId: string;
}

export interface RecordKindsProfile {
  readonly address: string;
  readonly preferredContact: string;
  readonly serviceTier: string;
  readonly background: string;
}

export interface RecordKindsFact {
  readonly id: string;
  readonly label: string;
  readonly value: string;
}

export interface RecordKindsFinancialAccount {
  readonly id: string;
  readonly institution: string;
  readonly accountType: string;
  readonly lastFour: string;
  readonly relationship: string;
}

export interface RecordKindsDetails {
  readonly version: 1;
  readonly profile: RecordKindsProfile;
  readonly facts: readonly RecordKindsFact[];
  readonly accounts: readonly RecordKindsFinancialAccount[];
}

export interface RecordKindsSnapshot {
  readonly ref: ContactRef;
  readonly record: ContactRecord;
  readonly details: RecordKindsDetails;
}

export type ScopedContactCreateInput =
  | {
      readonly kind: 'household';
      readonly name: string;
      readonly lifecycle?: string;
      readonly primaryAdvisor?: string;
    }
  | {
      readonly kind: 'person';
      readonly firstName?: string;
      readonly lastName?: string;
      readonly name?: string;
      readonly lifecycle?: string;
      readonly primaryAdvisor?: string;
    };

export interface RecordKindsDraft {
  readonly name?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly lifecycle: string;
  readonly primaryAdvisor: string;
  readonly channels: readonly ContactChannel[];
  readonly details: RecordKindsDetails;
}

export class RecordKindsIsolationError extends Error {
  constructor(
    message = 'The selected client record boundary could not be verified.'
  ) {
    super(message);
    this.name = 'RecordKindsIsolationError';
  }
}

const emptyDetails = (): RecordKindsDetails => ({
  version: 1,
  profile: {
    address: '',
    preferredContact: '',
    serviceTier: '',
    background: '',
  },
  facts: [],
  accounts: [],
});

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function assertUniqueIds(
  values: readonly { readonly id: string }[],
  label: string
): void {
  const ids = new Set<string>();
  for (const value of values) {
    const id = required(value.id, `${label} id`);
    if (ids.has(id)) throw new Error(`${label} ids must be unique.`);
    ids.add(id);
  }
}

function normalizeDetails(value: unknown): RecordKindsDetails {
  if (value === undefined) return emptyDetails();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Saved contact details are malformed.');
  }
  const source = value as Record<string, unknown>;
  if (source['version'] !== 1) {
    throw new Error('Saved contact details use an unsupported version.');
  }
  const rawProfile = source['profile'];
  if (
    !rawProfile ||
    typeof rawProfile !== 'object' ||
    Array.isArray(rawProfile)
  ) {
    throw new Error('Saved contact profile is malformed.');
  }
  const profile = rawProfile as Record<string, unknown>;
  const facts = source['facts'];
  const accounts = source['accounts'];
  if (!Array.isArray(facts) || !Array.isArray(accounts)) {
    throw new Error('Saved contact facts or accounts are malformed.');
  }
  const normalizedFacts = facts.map((candidate): RecordKindsFact => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      throw new Error('Saved contact fact is malformed.');
    }
    const fact = candidate as Record<string, unknown>;
    return {
      id: required(fact['id'], 'Fact id'),
      label: required(fact['label'], 'Fact label'),
      value: required(fact['value'], 'Fact value'),
    };
  });
  const normalizedAccounts = accounts.map(
    (candidate): RecordKindsFinancialAccount => {
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
      ) {
        throw new Error('Saved financial account is malformed.');
      }
      const account = candidate as Record<string, unknown>;
      const lastFour =
        typeof account['lastFour'] === 'string'
          ? account['lastFour'].trim()
          : '';
      if (lastFour && !/^\d{4}$/.test(lastFour)) {
        throw new Error(
          'Financial account last four must contain four digits.'
        );
      }
      return {
        id: required(account['id'], 'Financial account id'),
        institution: required(account['institution'], 'Financial institution'),
        accountType: required(account['accountType'], 'Financial account type'),
        lastFour,
        relationship: required(
          account['relationship'],
          'Financial account relationship'
        ),
      };
    }
  );
  assertUniqueIds(normalizedFacts, 'Fact');
  assertUniqueIds(normalizedAccounts, 'Financial account');
  return {
    version: 1,
    profile: {
      address:
        typeof profile['address'] === 'string' ? profile['address'].trim() : '',
      preferredContact:
        typeof profile['preferredContact'] === 'string'
          ? profile['preferredContact'].trim()
          : '',
      serviceTier:
        typeof profile['serviceTier'] === 'string'
          ? profile['serviceTier'].trim()
          : '',
      background:
        typeof profile['background'] === 'string'
          ? profile['background'].trim()
          : '',
    },
    facts: normalizedFacts,
    accounts: normalizedAccounts,
  };
}

function validateChannels(
  channels: readonly ContactChannel[]
): readonly ContactChannel[] {
  if (!Array.isArray(channels))
    throw new Error('Contact methods must be a list.');
  const candidates: readonly unknown[] = channels;
  const normalized = candidates.map((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      throw new Error('Contact method row is malformed.');
    }
    const channel = candidate as Record<string, unknown>;
    const kind = required(channel['kind'], 'Contact method type');
    if (!kind.startsWith('email:') && !kind.startsWith('phone:')) {
      throw new Error('Contact methods must be email or phone rows.');
    }
    if (typeof channel['primary'] !== 'boolean') {
      throw new Error('Contact method primary must be a boolean.');
    }
    return {
      id: required(channel['id'], 'Contact method id'),
      address: required(channel['address'], 'Contact method value'),
      kind,
      primary: channel['primary'],
    };
  });
  assertUniqueIds(normalized, 'Contact method');
  for (const family of ['email:', 'phone:'] as const) {
    if (
      normalized.filter(
        (channel) => channel.kind.startsWith(family) && channel.primary
      ).length > 1
    ) {
      throw new Error(`Only one ${family.slice(0, -1)} row can be primary.`);
    }
  }
  return normalized;
}

function assertScope(value: SealedRecordKindsClientScope): RuntimeSealedScope {
  const candidate = value as Partial<RuntimeSealedScope> | null | undefined;
  if (!candidate || candidate[runtimeScopeSeal] !== true) {
    throw new RecordKindsIsolationError();
  }
  let householdRef: ContactRef;
  try {
    householdRef = validateContactRef(candidate.householdRef as ContactRef);
  } catch {
    throw new RecordKindsIsolationError();
  }
  if (
    householdRef.kind !== 'household' ||
    typeof candidate.matterId !== 'string' ||
    !candidate.matterId.trim() ||
    householdRef.matterId !== candidate.matterId.trim()
  ) {
    throw new RecordKindsIsolationError();
  }
  return candidate as RuntimeSealedScope;
}

function assertTarget(
  scope: RuntimeSealedScope,
  value: ContactRef
): ContactRef {
  let target: ContactRef;
  try {
    target = validateContactRef(value);
  } catch {
    throw new RecordKindsIsolationError();
  }
  if (target.matterId !== scope.matterId) {
    throw new RecordKindsIsolationError();
  }
  return target;
}

export function sealRecordKindsClientScope(
  input: RecordKindsClientScopeInput
): SealedRecordKindsClientScope {
  const householdRef = validateContactRef(input.householdRef);
  const matterId = required(input.matterId, 'Client matter id');
  if (householdRef.kind !== 'household' || householdRef.matterId !== matterId) {
    throw new RecordKindsIsolationError();
  }
  const sealed = {
    householdRef: { ...householdRef, kind: 'household' as const },
    matterId,
  } as RuntimeSealedScope;
  Object.defineProperty(sealed, runtimeScopeSeal, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return Object.freeze(sealed);
}

function snapshot(record: ContactRecord): RecordKindsSnapshot {
  return {
    ref: {
      kind: record.kind,
      id: record.id,
      matterId: record.matterId,
      ...(record.displayName ? { label: record.displayName } : {}),
    },
    record,
    details: normalizeDetails(
      record.extensionData?.[RECORD_KINDS_EXTENSION_KEY]
    ),
  };
}

function createInput(
  scope: RuntimeSealedScope,
  input: ScopedContactCreateInput,
  details: RecordKindsDetails
): ContactCreateInput {
  const shared = {
    matterId: scope.matterId,
    ...(input.lifecycle?.trim() ? { lifecycle: input.lifecycle.trim() } : {}),
    extensionData: { [RECORD_KINDS_EXTENSION_KEY]: normalizeDetails(details) },
  };
  if (input.kind === 'household') {
    return {
      kind: 'household',
      name: required(input.name, 'Household name'),
      ...shared,
    };
  }
  return {
    kind: 'person',
    ...(input.firstName?.trim() ? { firstName: input.firstName.trim() } : {}),
    ...(input.lastName?.trim() ? { lastName: input.lastName.trim() } : {}),
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    ...shared,
  };
}

function assertInScope(
  scope: RuntimeSealedScope,
  record: ContactRecord
): ContactRecord {
  if (record.matterId !== scope.matterId) {
    throw new RecordKindsIsolationError();
  }
  return record;
}

/**
 * Records that look like this client's contacts but cannot be verified against
 * the sealed pair — a legacy household with no `matterId`, an unpaired linked
 * individual, or a malformed document claiming this matter. Their existence must
 * fail the scoped read closed; silently dropping them would report a populated
 * client as empty and hide cross-client bleed.
 */
function scopedIsolationBlockers(
  scope: RuntimeSealedScope,
  contacts: ContactRecordStore
): readonly Readonly<Record<string, unknown>>[] {
  const linkedIds = new Set<string>();
  const household = contacts.records.find(
    (record) =>
      record.kind === 'household' &&
      record.id === scope.householdRef.id &&
      record.matterId === scope.matterId
  );
  if (household) {
    for (const link of household.contactLinks) linkedIds.add(link.contactId);
  }
  return contacts.unpairedContactDocuments.filter((document) => {
    const id = typeof document['id'] === 'string' ? document['id'] : '';
    const matterId =
      typeof document['matterId'] === 'string' ? document['matterId'] : '';
    return (
      matterId === scope.matterId ||
      id === scope.householdRef.id ||
      (id !== '' && linkedIds.has(id))
    );
  });
}

/**
 * The real storage boundary for this feature. Every read, resolve, create, and
 * update authorizes the sealed household+matter pair BEFORE touching data. It
 * never hands the feature a whole-firm array or an ID-only writer: the whole-firm
 * records and the underlying `update(id, patch)` are encapsulated here, reached
 * only after the pair is proven at runtime.
 */
interface ScopedContactStore {
  readonly scope: RuntimeSealedScope;
  list(): readonly ContactRecord[];
  read(ref: ContactRef): Promise<ContactRecord | null>;
  create(input: ContactCreateInput): Promise<ContactRecord>;
  update(ref: ContactRef, patch: ContactPatch): Promise<ContactRecord>;
}

function createScopedContactStore(
  contacts: ContactRecordStore,
  untrustedScope: SealedRecordKindsClientScope
): ScopedContactStore {
  const scope = assertScope(untrustedScope);
  return {
    scope,
    list() {
      if (scopedIsolationBlockers(scope, contacts).length > 0) {
        throw new RecordKindsIsolationError(
          'Contact details are blocked because this client has records that are not linked to its workspace.'
        );
      }
      return contacts.records.filter(
        (record) => record.matterId === scope.matterId
      );
    },
    async read(untrustedRef) {
      const ref = assertTarget(scope, untrustedRef);
      const projection = await contacts.resolve(ref);
      return projection ? assertInScope(scope, projection.contact) : null;
    },
    async create(input) {
      if (input.matterId !== scope.matterId) {
        throw new RecordKindsIsolationError();
      }
      const created = await contacts.create(input);
      return assertInScope(scope, created);
    },
    async update(untrustedRef, patch) {
      const ref = assertTarget(scope, untrustedRef);
      const current = await contacts.resolve(ref);
      if (!current) throw new Error('The contact record no longer exists.');
      assertInScope(scope, current.contact);
      const updated = await contacts.update(ref.id, patch);
      if (updated.kind !== ref.kind) {
        throw new RecordKindsIsolationError();
      }
      return assertInScope(scope, updated);
    },
  };
}

export interface RecordKindsRepository {
  list(
    scope: SealedRecordKindsClientScope
  ): Promise<readonly RecordKindsSnapshot[]>;
  read(
    scope: SealedRecordKindsClientScope,
    ref: ContactRef
  ): Promise<RecordKindsSnapshot | null>;
  create(
    scope: SealedRecordKindsClientScope,
    input: ScopedContactCreateInput,
    details: RecordKindsDetails
  ): Promise<RecordKindsSnapshot>;
  update(
    scope: SealedRecordKindsClientScope,
    ref: ContactRef,
    draft: RecordKindsDraft
  ): Promise<RecordKindsSnapshot>;
}

export function createRecordKindsRepository(
  contacts: ContactRecordStore
): RecordKindsRepository {
  return {
    list(untrustedScope) {
      return Promise.resolve().then(() => {
        const store = createScopedContactStore(contacts, untrustedScope);
        return store
          .list()
          .filter(
            (record) => record.kind === 'household' || record.kind === 'person'
          )
          .map(snapshot);
      });
    },
    async read(untrustedScope, untrustedRef) {
      const store = createScopedContactStore(contacts, untrustedScope);
      const record = await store.read(untrustedRef);
      return record ? snapshot(record) : null;
    },
    async create(untrustedScope, input, details) {
      const store = createScopedContactStore(contacts, untrustedScope);
      const normalizedDetails = normalizeDetails(details);
      const created = await store.create(
        createInput(store.scope, input, normalizedDetails)
      );
      const primaryAdvisor = input.primaryAdvisor?.trim();
      if (!primaryAdvisor) return snapshot(created);
      const updated = await store.update(
        { kind: created.kind, id: created.id, matterId: created.matterId },
        { primaryAdvisor }
      );
      return snapshot(updated);
    },
    async update(untrustedScope, untrustedRef, draft) {
      const store = createScopedContactStore(contacts, untrustedScope);
      const channels = validateChannels(draft.channels);
      const details = normalizeDetails(draft.details);
      const patch: ContactPatch = {
        lifecycle: required(draft.lifecycle, 'Lifecycle'),
        primaryAdvisor: draft.primaryAdvisor.trim(),
        channels,
        extensionData: { [RECORD_KINDS_EXTENSION_KEY]: details },
        ...(draft.name?.trim() ? { name: draft.name.trim() } : {}),
        ...(draft.firstName !== undefined
          ? { firstName: draft.firstName.trim() }
          : {}),
        ...(draft.lastName !== undefined
          ? { lastName: draft.lastName.trim() }
          : {}),
      };
      const updated = await store.update(untrustedRef, patch);
      return snapshot(updated);
    },
  };
}

export function createEmptyRecordKindsDetails(): RecordKindsDetails {
  return emptyDetails();
}

export function contactKindLabel(kind: ContactKind): string {
  return kind === 'person'
    ? 'Individual'
    : kind.charAt(0).toUpperCase() + kind.slice(1);
}
