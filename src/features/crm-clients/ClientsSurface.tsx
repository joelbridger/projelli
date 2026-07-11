import { useState } from 'react';
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = records.find((record) => record.id === selectedId);
  if (selected) return <HouseholdRecordSurface household={selected} proposals={proposals} {...(actions ? { actions } : {})} />;
  return <DirectorySurface households={households} people={people} actions={{ ...actions, onOpenHousehold: setSelectedId }} />;
}
