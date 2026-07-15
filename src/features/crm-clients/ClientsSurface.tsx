import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { useActiveMatters, useMatterStore } from '@/platform/matter/matterStore';
import { readSelectedCrmHousehold, writeSelectedCrmHousehold } from '@/platform/crm/clientSelection';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { Matter } from '@/platform/types/matter';
import { DirectorySurface } from './DirectorySurface';
import { HouseholdRecordSurface } from './HouseholdRecordSurface';
import type { TimelineRecord } from '@/features/crm-timeline';
import type {
  CrmClientsActions,
  CrmFieldValue,
  CrmNote,
  CrmPerson,
  CrmProposal,
  HouseholdDirectoryEntry,
  HouseholdRecord,
  SyncState,
} from './adapters';

type StoredHousehold = LiveCrmRecord & Omit<HouseholdRecord, 'id' | 'syncState'>;

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function syncState(kind: ReturnType<typeof useLiveCrmRecords>['freshness']['kind']): SyncState {
  if (kind === 'idle') return 'live';
  if (kind === 'live' || kind === 'syncing' || kind === 'offline') return kind;
  return kind === 'last-synced' ? 'last_synced' : 'needs_attention';
}

function householdFromRecord(record: LiveCrmRecord, currentSyncState: SyncState, lastSyncedAt?: string): HouseholdRecord {
  return {
    id: record.id,
    name: stringValue(record['name'], 'Untitled household'),
    lifecycle: stringValue(record['lifecycle'], 'Active'),
    primaryAdvisor: stringValue(record['primaryAdvisor'], 'Unassigned'),
    ownership: record['ownership'] === 'shared' || record['ownership'] === 'other' ? record['ownership'] : 'mine',
    serviceTier: stringValue(record['serviceTier'], 'Standard'),
    ...(typeof record['nextReview'] === 'string' ? { nextReview: record['nextReview'] } : {}),
    ...(lastSyncedAt ? { lastSyncedAt } : {}),
    syncState: currentSyncState,
    facts: list(record['facts']) as NonNullable<HouseholdRecord['facts']>,
    accounts: list(record['accounts']) as NonNullable<HouseholdRecord['accounts']>,
    members: list(record['members']) as NonNullable<HouseholdRecord['members']>,
    externalParties: list(record['externalParties']) as NonNullable<HouseholdRecord['externalParties']>,
    notes: list(record['notes']) as NonNullable<HouseholdRecord['notes']>,
    customFields: list(record['customFields']) as NonNullable<HouseholdRecord['customFields']>,
    tags: list(record['tags']).filter((tag): tag is string => typeof tag === 'string'),
    contextRefs: list(record['contextRefs']) as NonNullable<HouseholdRecord['contextRefs']>,
    ...(record['extensionData'] && typeof record['extensionData'] === 'object' && !Array.isArray(record['extensionData'])
      ? { extensionData: record['extensionData'] as Readonly<Record<string, unknown>> }
      : {}),
    ...(typeof record['schedulingLinkUrl'] === 'string' ? { schedulingLinkUrl: record['schedulingLinkUrl'] } : {}),
  };
}

/**
 * CRM imports create the app's client before their slower search work starts.
 * Keep that client navigable and readable while the richer encrypted CRM record
 * is still arriving instead of making navigation wait on search indexing.
 */
function householdFromMatter(matter: Matter, currentSyncState: SyncState): HouseholdRecord {
  return {
    id: matter.id,
    name: matter.client.trim() || matter.name,
    lifecycle: 'Active',
    primaryAdvisor: 'Unassigned',
    ownership: 'mine',
    serviceTier: 'Standard',
    syncState: currentSyncState,
    facts: [],
    accounts: [],
    members: [],
    externalParties: [],
    notes: [],
    customFields: [],
    tags: [],
    contextRefs: [],
  };
}

/**
 * The Clients tab is a thin render adapter over encrypted CRM collection
 * documents. There is no browser fallback: every edit below writes the same
 * SQLCipher-backed household record and is reloaded after a desktop restart.
 */
export function ClientsSurface({
  households = [], people = [], records = [], proposals = [], actions,
}: {
  households?: readonly HouseholdDirectoryEntry[];
  people?: readonly CrmPerson[];
  records?: readonly HouseholdRecord[];
  proposals?: readonly CrmProposal[];
  actions?: CrmClientsActions;
}) {
  const live = useLiveCrmRecords();
  return (
    <ClientsSurfaceContent
      key={live.workspaceRoot ?? 'no-workspace'}
      live={live}
      households={households}
      people={people}
      records={records}
      proposals={proposals}
      {...(actions ? { actions } : {})}
    />
  );
}

function ClientsSurfaceContent({
  live, households = [], people = [], records = [], proposals = [], actions,
}: {
  live: ReturnType<typeof useLiveCrmRecords>;
  households?: readonly HouseholdDirectoryEntry[];
  people?: readonly CrmPerson[];
  records?: readonly HouseholdRecord[];
  proposals?: readonly CrmProposal[];
  actions?: CrmClientsActions;
}) {
  const matters = useActiveMatters();
  const clientMapHubId = useMatterStore((state) => state.clientMapHubId);
  const selectionWorkspace = live.workspaceRoot ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    clientMapHubId ?? (selectionWorkspace ? readSelectedCrmHousehold(selectionWorkspace) : null),
  );

  // Reopen the household an advisor was working in after a real desktop
  // restart. Keying this component by workspace gives each workspace a fresh
  // initial selection without scheduling a second render after it appears.
  // The selection is only navigation state; the household itself and every
  // field still come from the encrypted CRM store below.

  useEffect(() => {
    // A client click in the shared sidebar changes this store. Subscribe to
    // that external navigation event instead of copying it during an effect
    // render, which avoids a cascading render and keeps both client lists in
    // lockstep.
    return useMatterStore.subscribe((next, previous) => {
      if (next.clientMapHubId === previous.clientMapHubId) return;
      setSelectedId(next.clientMapHubId);
      if (!next.clientMapHubId && previous.clientMapHubId && selectionWorkspace) {
        writeSelectedCrmHousehold(selectionWorkspace, null);
      }
    });
  }, [selectionWorkspace]);

  const lastSyncedAt = live.freshness.kind === 'last-synced' || live.freshness.kind === 'syncing'
    ? live.freshness.lastSyncedAt
    : undefined;
  const storedHouseholds = useMemo(
    () => live.records
      .filter((record) => record.kind === 'household')
      .map((record) => householdFromRecord(record, syncState(live.freshness.kind), lastSyncedAt)),
    [lastSyncedAt, live.freshness.kind, live.records],
  );

  const mergedHouseholds = useMemo(() => {
    const merged = [...storedHouseholds];
    const representedMatterIds = new Set(
      live.records
        .filter((record) => record.kind === 'household' && record.matterId)
        .map((record) => record.matterId as string),
    );
    for (const matter of matters) {
      if (!representedMatterIds.has(matter.id)) {
        merged.push(householdFromMatter(matter, syncState(live.freshness.kind)));
      }
    }
    return merged;
  }, [live.freshness.kind, live.records, matters, storedHouseholds]);

  const effectiveRecords = records.length ? records : mergedHouseholds;
  const recordMatterId = useCallback((record: HouseholdRecord): string => {
    const mapped = live.records.find((candidate) => candidate.id === record.id)?.matterId;
    return mapped && matters.some((matter) => matter.id === mapped) ? mapped : record.id;
  }, [live.records, matters]);
  const findRecord = useCallback((id: string): HouseholdRecord | undefined =>
    effectiveRecords.find((record) => record.id === id || recordMatterId(record) === id),
  [effectiveRecords, recordMatterId]);

  const selectHousehold = useCallback((id: string | null) => {
    const selectedRecord = id ? findRecord(id) : undefined;
    const selection = selectedRecord ? recordMatterId(selectedRecord) : id;
    setSelectedId(selection);
    // Ask's confidentiality boundary is the active client in the matter store.
    // Keep it scoped only when the selected CRM record maps to a real client.
    const safeMatterId = selection && useMatterStore.getState().matters.some(
      (matter) => matter.id === selection,
    ) ? selection : null;
    useMatterStore.getState().setActiveMatter(safeMatterId);
    if (selectionWorkspace) writeSelectedCrmHousehold(selectionWorkspace, selection);
  }, [findRecord, recordMatterId, selectionWorkspace]);

  const effectiveHouseholds = households.length ? households : effectiveRecords.map((household) => ({
    id: recordMatterId(household),
    name: household.name,
    lifecycle: household.lifecycle,
    primaryAdvisor: household.primaryAdvisor,
    serviceTier: household.serviceTier,
    peopleCount: household.members.length + household.externalParties.length,
  }));
  const livePeople = useMemo(() => {
    const seen = new Map<string, CrmPerson>();
    for (const household of storedHouseholds) {
      for (const person of [...household.members, ...household.externalParties]) {
        const prior = seen.get(person.id);
        seen.set(person.id, {
          ...person,
          relatedHouseholds: (prior?.relatedHouseholds ?? 0) + 1,
        });
      }
    }
    return [...seen.values()];
  }, [storedHouseholds]);
  const effectivePeople = people.length ? people : livePeople;
  const selected = selectedId ? findRecord(selectedId) : undefined;

  const saveHousehold = async (household: HouseholdRecord) => {
    const previous = live.records.find((record) => record.id === household.id);
    const persisted: StoredHousehold = {
      ...(previous ?? {}),
      ...household,
      id: household.id,
      kind: 'household',
      matterId: previous?.matterId ?? live.sharedMatterId ?? recordMatterId(household),
    };
    delete (persisted as Partial<StoredHousehold>)['syncState'];
    delete (persisted as Partial<StoredHousehold>)['lastSyncedAt'];
    await live.save(persisted);
  };

  if (selected) {
    const current = selected;
    return (
      <HouseholdRecordSurface
        household={current}
        proposals={proposals}
        onBack={() => { selectHousehold(null); }}
        onSaveHousehold={saveHousehold}
        timelineRecords={live.records as readonly TimelineRecord[]}
        timelineFreshness={live.freshness}
        onSaveActivityRecord={live.save}
        actions={{
          ...actions,
          onSaveNote: async (note, notifyFirm) => {
            const nextNote: CrmNote = {
              id: `note:${crypto.randomUUID()}`,
              ...note,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            await saveHousehold({ ...current, notes: [...current.notes, nextNote] });
            await actions?.onSaveNote?.(note, notifyFirm);
          },
          onSaveMetadata: async (values: readonly CrmFieldValue[], tags: readonly string[]) => {
            await saveHousehold({ ...current, customFields: values, tags });
            await actions?.onSaveMetadata?.(values, tags);
          },
        }}
      />
    );
  }

  return (
    <DirectorySurface
      households={effectiveHouseholds}
      people={effectivePeople}
      actions={{ ...actions, onOpenHousehold: selectHousehold }}
      onCreateHousehold={async (name) => {
        const id = `household:${crypto.randomUUID()}`;
        await live.save({
          id,
          kind: 'household',
          matterId: live.sharedMatterId ?? id,
          name,
          lifecycle: 'Active',
          primaryAdvisor: 'Unassigned',
          serviceTier: 'Standard',
          ownership: 'mine',
          facts: [],
          accounts: [],
          members: [],
          externalParties: [],
          notes: [],
          customFields: [],
          tags: [],
        });
        selectHousehold(id);
      }}
      error={live.error}
    />
  );
}
