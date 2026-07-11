/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useMemo, useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  SearchField,
  SegmentedToggle,
  SlidePanel,
  SurfaceToolbar,
} from '@/ui/kp';
import type {
  CrmClientsActions,
  CrmPerson,
  HouseholdDirectoryEntry,
} from './adapters';

type DirectoryTab = 'households' | 'people';
export function DirectorySurface({
  people,
  households = [],
  actions,
  onCreateHousehold,
  error,
}: {
  people: readonly CrmPerson[];
  households?: readonly HouseholdDirectoryEntry[];
  actions?: CrmClientsActions;
  onCreateHousehold?: (name: string) => Promise<void> | void;
  error?: string | null;
}) {
  const [tab, setTab] = useState<DirectoryTab>('households');
  const [query, setQuery] = useState('');
  const [externalOnly, setExternalOnly] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [selected, setSelected] = useState<CrmPerson | null>(null);
  const [creatingHousehold, setCreatingHousehold] = useState(false);
  const [householdName, setHouseholdName] = useState('');
  const filtered = useMemo(
    () =>
      people.filter(
        (person) =>
          (!externalOnly || person.external) &&
          (!needsVerification || !person.verifiedAt) &&
          person.name.toLowerCase().includes(query.toLowerCase())
      ),
    [people, query, externalOnly, needsVerification]
  );
  const filteredHouseholds = useMemo(
    () =>
      households.filter((household) =>
        household.name.toLowerCase().includes(query.toLowerCase())
      ),
    [households, query]
  );
  return (
    <section data-testid="crm-directory-surface">
      <header>
        <p style={{ marginBottom: 2 }}>Clients / Directory</p>
        <h1 style={{ marginTop: 0 }}>People and external parties</h1>
      </header>
      <SurfaceToolbar data-testid="crm-directory-toolbar">
        <SegmentedToggle
          ariaLabel="Directory view"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'households', label: 'Households' },
            { value: 'people', label: 'People' },
          ]}
          data-testid="crm-directory-tab"
        />
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={tab === 'households' ? 'Find a household' : 'Find a person'}
          data-testid="crm-directory-search"
        />
        <Button
          size="sm"
          variant={externalOnly ? 'primary' : 'secondary'}
          onClick={() => { setExternalOnly((value) => !value); }}
          data-testid="crm-directory-external"
        >
          External
        </Button>
        <Button
          size="sm"
          variant={needsVerification ? 'primary' : 'secondary'}
          onClick={() => { setNeedsVerification((value) => !value); }}
          data-testid="crm-directory-needs-verification"
        >
          Needs verification
        </Button>
        <Button
          size="sm"
          iconLeft={Plus}
          data-testid="crm-directory-add"
          onClick={() => { setCreatingHousehold(true); }}
        >
          New household
        </Button>
      </SurfaceToolbar>
      {error ? <Card variant="raised" role="alert">Could not load the saved CRM records: {error}</Card> : null}
      {creatingHousehold ? <form data-testid="crm-create-household" onSubmit={(event) => { event.preventDefault(); const name = householdName.trim(); if (!name) return; void Promise.resolve(onCreateHousehold?.(name)).then(() => { setHouseholdName(''); setCreatingHousehold(false); }); }} style={{ display: 'flex', gap: 8, marginTop: 12 }}><input data-testid="crm-household-name" aria-label="Household name" value={householdName} onChange={(event) => { setHouseholdName(event.target.value); }} placeholder="Household name" autoFocus /><Button data-testid="crm-household-save" type="submit">Create household</Button><Button variant="secondary" type="button" onClick={() => { setCreatingHousehold(false); }}>Cancel</Button></form> : null}
      {tab === 'households' ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {filteredHouseholds.length ? (
            filteredHouseholds.map((household) => (
              <Card
                key={household.id}
                variant="interactive"
                role="button"
                tabIndex={0}
                data-testid={`crm-directory-household-${household.id}`}
                onClick={() => actions?.onOpenHousehold?.(household.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') actions?.onOpenHousehold?.(household.id);
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong>{household.name}</strong>
                  <Badge variant="featured">{household.serviceTier}</Badge>
                </div>
                <div style={{ color: 'var(--color-slate-600)', marginTop: 4 }}>
                  {household.lifecycle} · Owned by {household.primaryAdvisor} · {household.peopleCount} people
                </div>
              </Card>
            ))
          ) : (
            <Card variant="raised">No households match this search.</Card>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {filtered.map((person) => (
            <Card
              key={person.id}
              variant="interactive"
              role="button"
              tabIndex={0}
              data-testid={`crm-directory-person-${person.id}`}
              onClick={() => { setSelected(person); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setSelected(person);
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <strong>{person.name}</strong>
                <div style={{ display: 'flex', gap: 6 }}>
                  {person.external ? (
                    <Badge variant="warning">External</Badge>
                  ) : (
                    <Badge variant="neutral">Household member</Badge>
                  )}
                  {person.verifiedAt ? (
                    <Badge variant="success" icon={ShieldCheck}>
                      Email verified
                    </Badge>
                  ) : (
                    <Badge variant="warning">Needs verification</Badge>
                  )}
                </div>
              </div>
              <div style={{ color: 'var(--color-slate-600)', marginTop: 4 }}>
                {person.personType === 'organization'
                  ? 'Organization'
                  : person.personType === 'trust'
                    ? 'Trust'
                    : (person.householdRole ?? 'Person')}{' '}
                · {person.roles.join(', ') || 'No firm roles'} · serves{' '}
                {person.relatedHouseholds} household
                {person.relatedHouseholds === 1 ? '' : 's'}
              </div>
            </Card>
          ))}
        </div>
      )}
      <SlidePanel
        open={selected !== null}
        onClose={() => { setSelected(null); }}
        title={selected?.name}
        data-testid="crm-directory-person-panel"
      >
        {selected ? (
          <div>
            <p>
              <strong>Person roles:</strong>{' '}
              {selected.roles.join(', ') || 'None'}
            </p>
            <p>
              <strong>Household relationship:</strong>{' '}
              {selected.householdRole ?? 'Not a household member'}
            </p>
            <p>
              <strong>Channel:</strong>{' '}
              {selected.channel ?? 'No recipient channel'}
            </p>
            <p>
              <strong>Verification:</strong>{' '}
              {selected.verifiedAt
                ? `${selected.verifiedAt}${selected.verifiedBy ? ` by ${selected.verifiedBy}` : ''}`
                : 'Needs verification'}
            </p>
            <Button
              size="sm"
              data-testid={`crm-review-recipient-${selected.id}`}
              onClick={() => actions?.onReviewRecipient?.(selected.id)}
            >
              Review recipient
            </Button>
          </div>
        ) : null}
      </SlidePanel>
    </section>
  );
}
