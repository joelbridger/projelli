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
import type { CrmClientsActions, CrmPerson } from './adapters';

type DirectoryTab = 'households' | 'people';
export function DirectorySurface({
  people,
  actions,
}: {
  people: readonly CrmPerson[];
  actions?: CrmClientsActions;
}) {
  const [tab, setTab] = useState<DirectoryTab>('people');
  const [query, setQuery] = useState('');
  const [externalOnly, setExternalOnly] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [selected, setSelected] = useState<CrmPerson | null>(null);
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
          placeholder="Find a person"
          data-testid="crm-directory-search"
        />
        <Button
          size="sm"
          variant={externalOnly ? 'primary' : 'secondary'}
          onClick={() => setExternalOnly((value) => !value)}
          data-testid="crm-directory-external"
        >
          External
        </Button>
        <Button
          size="sm"
          variant={needsVerification ? 'primary' : 'secondary'}
          onClick={() => setNeedsVerification((value) => !value)}
          data-testid="crm-directory-needs-verification"
        >
          Needs verification
        </Button>
        <Button
          size="sm"
          iconLeft={Plus}
          data-testid="crm-directory-add"
          onClick={() => actions?.onAdd?.('person')}
        >
          Add
        </Button>
      </SurfaceToolbar>
      {tab === 'households' ? (
        <Card variant="raised">
          Household records stay in Clients. Choose People to manage
          relationships and recipient verification.
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {filtered.map((person) => (
            <Card
              key={person.id}
              variant="interactive"
              role="button"
              tabIndex={0}
              data-testid={`crm-directory-person-${person.id}`}
              onClick={() => setSelected(person)}
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
              <div style={{ color: '#475569', marginTop: 4 }}>
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
        onClose={() => setSelected(null)}
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
