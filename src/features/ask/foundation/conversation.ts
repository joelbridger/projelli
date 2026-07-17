import { useMemo } from 'react';
import {
  loadLiveCrmRecords,
  type LiveCrmRecord,
} from '@/platform/crm/liveRecords';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type {
  AskClientSnapshot,
  AskConversationMetadata,
  AskOwnerIdentityAdapter,
  AskReviewDraft,
  AskSavedSourceSelection,
  AskScope,
  AskSourceDescriptor,
} from './contracts';
import {
  askSourceMembership,
  readBoundAskClient,
  resolveAskScope,
} from './scope';
import { isGenuineAskClientSnapshot } from './clientSnapshotAuthority';

type AskStoredKind =
  | 'askConversation'
  | 'askReviewDraft'
  | 'askSourceSelection';

type AskPayload<ClientReference, MeetingReference> =
  | AskConversationMetadata<ClientReference, MeetingReference>
  | AskReviewDraft<ClientReference, MeetingReference>
  | AskSavedSourceSelection<ClientReference, MeetingReference>;

type AskStoredRecord<ClientReference, MeetingReference> = LiveCrmRecord & {
  readonly kind: AskStoredKind;
  readonly payload: AskPayload<ClientReference, MeetingReference>;
};

export interface AskConversationStoreOptions<
  ClientReference,
  MeetingReference,
> {
  readonly currentClient: AskClientSnapshot<ClientReference> | null;
  readonly owners: AskOwnerIdentityAdapter<ClientReference, MeetingReference>;
}

export interface AskConversationPort {
  readonly records: readonly LiveCrmRecord[];
  readonly workspaceRoot: string | null | undefined;
  readonly save: (record: LiveCrmRecord) => Promise<LiveCrmRecord>;
  readonly reloadRecords: () => Promise<readonly LiveCrmRecord[] | undefined>;
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function timestamp(value: unknown): value is string {
  return nonBlank(value) && !Number.isNaN(Date.parse(value));
}

function stringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(nonBlank);
}

function clientSnapshot<ClientReference, MeetingReference>(
  value: unknown,
  options: AskConversationStoreOptions<ClientReference, MeetingReference>
): value is AskClientSnapshot<ClientReference> {
  const owners = options.owners;
  return (
    object(value) &&
    owners.isClientReference(value['contactRef']) &&
    nonBlank(value['matterId']) &&
    nonBlank(value['revision']) &&
    owners.clientMatterId(value['contactRef']) === value['matterId'] &&
    // Persisted records intentionally lose symbol/WeakSet provenance on
    // serialization. Whether fresh or persisted, they are accepted only when
    // they exactly match the CURRENT genuine owner snapshot; history can never
    // recreate authority or survive a switch/remap on its own.
    !!options.currentClient &&
    isGenuineAskClientSnapshot<ClientReference>(options.currentClient) &&
    value['matterId'] === options.currentClient.matterId &&
    value['revision'] === options.currentClient.revision &&
    owners.sameClient(value['contactRef'], options.currentClient.contactRef)
  );
}

function scopeValue<ClientReference, MeetingReference>(
  value: unknown,
  options: AskConversationStoreOptions<ClientReference, MeetingReference>
): value is AskScope<ClientReference, MeetingReference> {
  if (
    !object(value) ||
    !nonBlank(value['workspaceId']) ||
    !nonBlank(value['kind'])
  ) {
    return false;
  }
  if (value['kind'] === 'whole-firm') return true;
  if (!clientSnapshot(value['client'], options)) return false;
  const scope = value as unknown as AskScope<ClientReference, MeetingReference>;
  try {
    resolveAskScope(scope, options.currentClient, options.owners);
    return true;
  } catch {
    // Serialized history has no private brand. Its shape was checked above and
    // it can be revalidated only against the current genuine snapshot.
    if (!options.currentClient) return false;
    try {
      resolveAskScope(
        { ...scope, client: options.currentClient } as AskScope<
          ClientReference,
          MeetingReference
        >,
        options.currentClient,
        options.owners
      );
      return true;
    } catch {
      return false;
    }
  }
}

function sourceValue<ClientReference, MeetingReference>(
  value: unknown,
  scope: AskScope<ClientReference, MeetingReference>,
  options: AskConversationStoreOptions<ClientReference, MeetingReference>
): value is AskSourceDescriptor<ClientReference, MeetingReference> {
  if (
    !object(value) ||
    !nonBlank(value['sourceId']) ||
    !nonBlank(value['kind']) ||
    !nonBlank(value['workspaceId']) ||
    !clientSnapshot(value['client'], options) ||
    !nonBlank(value['label']) ||
    !['available', 'unavailable'].includes(String(value['availability'])) ||
    !object(value['citationOpenPath']) ||
    !nonBlank(value['citationOpenPath']['kind']) ||
    // A persisted source carries only the opaque sealed opener ref, never the
    // raw actionable token.
    !nonBlank(value['citationOpenPath']['ref'])
  ) {
    return false;
  }
  if (
    ![
      'crm-contact',
      'document',
      'meeting-artifact',
      'email-descriptor',
    ].includes(value['kind'])
  ) {
    return false;
  }
  if (
    value['kind'] === 'meeting-artifact' &&
    (!options.owners.isMeetingReference(value['meeting']) ||
      !nonBlank(value['occurredOn']) ||
      !nonBlank(value['meetingType']))
  ) {
    return false;
  }
  if (value['kind'] === 'email-descriptor' && !timestamp(value['date'])) {
    return false;
  }
  if (!options.currentClient) return false;
  try {
    const currentClient = options.currentClient;
    const normalizedScope =
      scope.kind === 'whole-firm'
        ? scope
        : ({ ...scope, client: currentClient } as AskScope<
            ClientReference,
            MeetingReference
          >);
    const resolved = resolveAskScope(
      normalizedScope,
      currentClient,
      options.owners
    );
    return askSourceMembership(
      resolved,
      {
        ...(value as unknown as AskSourceDescriptor<
          ClientReference,
          MeetingReference
        >),
        client: currentClient,
      },
      options.owners
    );
  } catch {
    return false;
  }
}

function conversationValue<ClientReference, MeetingReference>(
  value: unknown,
  options: AskConversationStoreOptions<ClientReference, MeetingReference>
): value is AskConversationMetadata<ClientReference, MeetingReference> {
  return (
    object(value) &&
    nonBlank(value['id']) &&
    scopeValue(value['scope'], options) &&
    nonBlank(value['title']) &&
    timestamp(value['createdAt']) &&
    timestamp(value['updatedAt'])
  );
}

function draftValue<ClientReference, MeetingReference>(
  value: unknown,
  options: AskConversationStoreOptions<ClientReference, MeetingReference>
): value is AskReviewDraft<ClientReference, MeetingReference> {
  return (
    object(value) &&
    nonBlank(value['id']) &&
    scopeValue(value['scope'], options) &&
    ['task', 'crm-note', 'follow-up'].includes(String(value['destination'])) &&
    nonBlank(value['body']) &&
    stringList(value['citationIds']) &&
    timestamp(value['createdAt']) &&
    timestamp(value['updatedAt'])
  );
}

function selectionValue<ClientReference, MeetingReference>(
  value: unknown,
  options: AskConversationStoreOptions<ClientReference, MeetingReference>
): value is AskSavedSourceSelection<ClientReference, MeetingReference> {
  if (!object(value)) return false;
  const scope = value['scope'];
  const sources = value['sources'];
  if (
    !nonBlank(value['id']) ||
    !scopeValue(scope, options) ||
    !Array.isArray(sources) ||
    !sources.length ||
    !timestamp(value['createdAt']) ||
    !timestamp(value['updatedAt'])
  ) {
    return false;
  }
  return sources.every((source) => sourceValue(source, scope, options));
}

function payloadForKind<ClientReference, MeetingReference>(
  kind: AskStoredKind,
  payload: unknown,
  options: AskConversationStoreOptions<ClientReference, MeetingReference>
): payload is AskPayload<ClientReference, MeetingReference> {
  if (kind === 'askConversation') return conversationValue(payload, options);
  if (kind === 'askReviewDraft') return draftValue(payload, options);
  return selectionValue(payload, options);
}

function projectStoredRecord<ClientReference, MeetingReference>(
  record: LiveCrmRecord,
  options: AskConversationStoreOptions<ClientReference, MeetingReference>
): AskStoredRecord<ClientReference, MeetingReference> | undefined {
  if (
    !['askConversation', 'askReviewDraft', 'askSourceSelection'].includes(
      record.kind
    )
  ) {
    return undefined;
  }
  const kind = record.kind as AskStoredKind;
  if (!payloadForKind(kind, record['payload'], options)) return undefined;

  const payload = record['payload'] as AskPayload<
    ClientReference,
    MeetingReference
  >;
  const currentClient = options.currentClient;

  if (kind === 'askConversation') {
    const scope = payload.scope;
    if (scope.kind !== 'whole-firm' && !currentClient) return undefined;
    return {
      ...record,
      kind,
      payload: {
        ...payload,
        scope:
          scope.kind === 'whole-firm'
            ? scope
            : { ...scope, client: currentClient },
      },
    } as AskStoredRecord<ClientReference, MeetingReference>;
  }
  if (kind === 'askReviewDraft') {
    const scope = payload.scope;
    if (scope.kind !== 'whole-firm' && !currentClient) return undefined;
    return {
      ...record,
      kind,
      payload: {
        ...payload,
        scope:
          scope.kind === 'whole-firm'
            ? scope
            : { ...scope, client: currentClient },
      },
    } as AskStoredRecord<ClientReference, MeetingReference>;
  }
  if (!currentClient) return undefined;
  const selection = payload as AskSavedSourceSelection<
    ClientReference,
    MeetingReference
  >;
  return {
    ...record,
    kind,
    payload: {
      ...selection,
      scope:
        selection.scope.kind === 'whole-firm'
          ? selection.scope
          : { ...selection.scope, client: currentClient },
      sources: selection.sources.map((source) => ({
        ...source,
        client: currentClient,
      })),
    },
  } as AskStoredRecord<ClientReference, MeetingReference>;
}

function matterForScope<ClientReference, MeetingReference>(
  scope: AskScope<ClientReference, MeetingReference>
): string | undefined {
  return scope.kind === 'whole-firm' ? undefined : scope.client.matterId;
}

function recordFor<ClientReference, MeetingReference>(
  kind: AskStoredKind,
  payload: AskPayload<ClientReference, MeetingReference>,
  options: AskConversationStoreOptions<ClientReference, MeetingReference>
): AskStoredRecord<ClientReference, MeetingReference> {
  if (!payloadForKind(kind, payload, options)) {
    throw new Error(`Ask refused malformed or stale ${kind} state.`);
  }
  const matterId = matterForScope(payload.scope);
  return {
    id: `ask:${kind}:${payload.id}`,
    kind,
    payload,
    ...(matterId ? { matterId } : {}),
  };
}

export function createAskConversationStore<ClientReference, MeetingReference>(
  port: AskConversationPort,
  options: AskConversationStoreOptions<ClientReference, MeetingReference>
) {
  const stored = port.records.flatMap((record) => {
    const projected = projectStoredRecord(record, options);
    return projected ? [projected] : [];
  });
  const persist = async (
    kind: AskStoredKind,
    payload: AskPayload<ClientReference, MeetingReference>
  ): Promise<void> => {
    // GAP-2 fix: re-resolve the ACTIVE client LIVE at write time from the owner
    // binding (the same source the read guards use), not from the frozen
    // `options.currentClient` captured when this store was created. A save handle
    // held across a client switch therefore fails closed: `recordFor` rejects a
    // payload whose scope no longer resolves under the current live client (or
    // when no owner is bound). Whole-firm payloads carry no client and still pass.
    const writeOptions: AskConversationStoreOptions<
      ClientReference,
      MeetingReference
    > = {
      owners: options.owners,
      currentClient: readBoundAskClient<ClientReference>(),
    };
    const record = recordFor(kind, payload, writeOptions);
    await port.save(record);
    const reloaded = await port.reloadRecords();
    const canonical = reloaded
      ?.map((candidate) => projectStoredRecord(candidate, writeOptions))
      .find((candidate) => candidate?.id === record.id);
    if (!canonical) {
      throw new Error(
        'Saved Ask state was absent from the fresh canonical reload.'
      );
    }
  };
  return {
    conversations: stored
      .filter((record) => record.kind === 'askConversation')
      .map(
        (record) =>
          record.payload as AskConversationMetadata<
            ClientReference,
            MeetingReference
          >
      ),
    reviewDrafts: stored
      .filter((record) => record.kind === 'askReviewDraft')
      .map(
        (record) =>
          record.payload as AskReviewDraft<ClientReference, MeetingReference>
      ),
    sourceSelections: stored
      .filter((record) => record.kind === 'askSourceSelection')
      .map(
        (record) =>
          record.payload as AskSavedSourceSelection<
            ClientReference,
            MeetingReference
          >
      ),
    saveConversation: (
      metadata: AskConversationMetadata<ClientReference, MeetingReference>
    ) => persist('askConversation', metadata),
    saveReviewDraft: (
      draft: AskReviewDraft<ClientReference, MeetingReference>
    ) => persist('askReviewDraft', draft),
    saveSourceSelection: (
      selection: AskSavedSourceSelection<ClientReference, MeetingReference>
    ) => persist('askSourceSelection', selection),
  };
}

/** Reactive doorway over the encrypted live-record route. */
export function useAskConversation<ClientReference, MeetingReference>(
  options: AskConversationStoreOptions<ClientReference, MeetingReference>
) {
  const live = useLiveCrmRecords();
  return useMemo(
    () =>
      createAskConversationStore(
        {
          records: live.records,
          workspaceRoot: live.workspaceRoot,
          save: live.save,
          reloadRecords: () => loadLiveCrmRecords(live.workspaceRoot),
        },
        options
      ),
    [live.records, live.workspaceRoot, live.save, options]
  );
}

export { recordFor as askConversationLiveRecord };
