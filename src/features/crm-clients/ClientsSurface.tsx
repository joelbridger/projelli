import { useState } from 'react';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { DirectorySurface } from './DirectorySurface';
import { HouseholdRecordSurface } from './HouseholdRecordSurface';
import type { CrmClientsActions, CrmPerson, CrmProposal, HouseholdDirectoryEntry, HouseholdRecord } from './adapters';

/**
 * The real Clients tab mount. Data is always supplied by the CRM store adapter;
 * an empty directory is an honest newly-created or not-yet-imported firm, not
 * preview content.
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
  const liveHouseholds = live.records.filter((record) => record.kind === 'household').map((record): HouseholdRecord => ({
    id: record.id,
    name: typeof record.name === 'string' ? record.name : 'Untitled household',
    lifecycle: typeof record.lifecycle === 'string' ? record.lifecycle : 'Active',
    primaryAdvisor: typeof record.primaryAdvisor === 'string' ? record.primaryAdvisor : 'Maya',
    ownership: record.ownership === 'shared' || record.ownership === 'other' ? record.ownership : 'mine',
    serviceTier: typeof record.serviceTier === 'string' ? record.serviceTier : 'Standard',
    syncState: 'offline',
    facts: [], accounts: [], members: [], externalParties: [], notes: [],
  }));
  const effectiveRecords = records.length ? records : liveHouseholds;
  const effectiveHouseholds = households.length ? households : liveHouseholds.map((household) => ({
    id: household.id, name: household.name, lifecycle: household.lifecycle,
    primaryAdvisor: household.primaryAdvisor, serviceTier: household.serviceTier, peopleCount: 0,
  }));
  const selected = effectiveRecords.find((record) => record.id === selectedId);
  if (selected) return <HouseholdRecordSurface household={selected} proposals={proposals} {...(actions ? { actions } : {})} />;
  return <DirectorySurface households={effectiveHouseholds} people={people} actions={{ ...actions, onOpenHousehold: setSelectedId }} onCreateHousehold={async (name) => {
    const id = `household:${crypto.randomUUID()}`;
    await live.save({ id, kind: 'household', matterId: id, name, lifecycle: 'Active', primaryAdvisor: 'Maya', serviceTier: 'Standard', ownership: 'mine' });
  }} />;
}
