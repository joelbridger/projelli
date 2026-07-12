import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
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

function list<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? value as readonly T[] : [];
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function syncState(kind: ReturnType<typeof useLiveCrmRecords>['freshness']['kind']): SyncState {
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
    facts: list(record['facts']),
    accounts: list(record['accounts']),
    members: list(record['members']),
    externalParties: list(record['externalParties']),
    notes: list(record['notes']),
    customFields: list(record['customFields']),
    tags: list(record['tags']).filter((tag): tag is string => typeof tag === 'string'),
    contextRefs: list(record['contextRefs']),
    ...(typeof record['schedulingLinkUrl'] === 'string' ? { schedulingLinkUrl: record['schedulingLinkUrl'] } : {}),
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectionKey = live.workspaceRoot
    ? `lantern:crm:selected-household:${live.workspaceRoot}`
    : null;

  // Reopen the household an advisor was working in after a real desktop
  // restart. The selection is only navigation state; the household itself and
  // every field still come from the encrypted CRM store below.
  useEffect(() => {
    if (!selectionKey) {
      setSelectedId(null);
      return;
    }
    setSelectedId(localStorage.getItem(selectionKey));
  }, [selectionKey]);

  const selectHousehold = useCallback((id: string | null) => {
    setSelectedId(id);
    if (!selectionKey) return;
    if (id) localStorage.setItem(selectionKey, id);
    else localStorage.removeItem(selectionKey);
  }, [selectionKey]);
  const lastSyncedAt = live.freshness.kind === 'last-synced' || live.freshness.kind === 'syncing'
    ? live.freshness.lastSyncedAt
    : undefined;
  const storedHouseholds = useMemo(
    () => live.records
      .filter((record) => record.kind === 'household')
      .map((record) => householdFromRecord(record, syncState(live.freshness.kind), lastSyncedAt)),
    [lastSyncedAt, live.freshness.kind, live.records],
  );
  const effectiveRecords = records.length ? records : storedHouseholds;
  const effectiveHouseholds = households.length ? households : effectiveRecords.map((household) => ({
    id: household.id,
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
  const selected = effectiveRecords.find((record) => record.id === selectedId);

  const saveHousehold = async (household: HouseholdRecord) => {
    const previous = live.records.find((record) => record.id === household.id);
    const persisted: StoredHousehold = {
      ...(previous ?? {}),
      ...household,
      id: household.id,
      kind: 'household',
      matterId: previous?.matterId ?? live.sharedMatterId ?? household.id,
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
