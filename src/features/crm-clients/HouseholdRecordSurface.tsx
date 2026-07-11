import { useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  Clock3,
  Lock,
  Mail,
  Plus,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CiteChip,
  SegmentedToggle,
  SlidePanel,
  SurfaceToolbar,
} from '@/ui/kp';
import type {
  CrmClientsActions,
  CrmProposal,
  HouseholdRecord,
} from './adapters';
import { NoteEditor } from './NoteEditor';
import { ProposalCard } from './ProposalCard';
import { RecordMetadataEditor } from './RecordMetadataEditor';

type HouseholdTab =
  | 'client_map'
  | 'timeline'
  | 'documents'
  | 'email'
  | 'meetings'
  | 'activity';
const syncCopy: Record<HouseholdRecord['syncState'], string> = {
  live: 'Live',
  syncing:
    'Syncing — showing at least received changes; newer changes may still arrive.',
  last_synced: 'Last synced',
  offline: 'Working offline — local edits wait to deliver.',
  needs_attention: 'Needs attention',
};
const syncVariant: Record<
  HouseholdRecord['syncState'],
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  live: 'success',
  syncing: 'neutral',
  last_synced: 'warning',
  offline: 'neutral',
  needs_attention: 'danger',
};

export function HouseholdRecordSurface({
  household,
  proposals = [],
  actions,
}: {
  household: HouseholdRecord;
  proposals?: readonly CrmProposal[];
  actions?: CrmClientsActions;
}) {
  const [tab, setTab] = useState<HouseholdTab>('client_map');
  const [addOpen, setAddOpen] = useState(false);
  const [noteAudience, setNoteAudience] = useState<
    'internal' | 'client-facing' | null
  >(null);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const sourceProposals = proposals.filter((proposal) => tab !== 'client_map');
  return (
    <section data-testid="crm-household-record">
      <header>
        <p style={{ marginBottom: 2 }}>Clients / {household.name}</p>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <h1 style={{ marginTop: 0 }}>{household.name}</h1>
          <Button
            size="sm"
            data-testid="crm-ask-household"
            onClick={() => actions?.onAskHousehold?.(household.id)}
          >
            Ask this household
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <Badge variant="neutral">{household.lifecycle}</Badge>
          <Badge variant="neutral">Owned by {household.primaryAdvisor}</Badge>
          <Badge variant="neutral">{household.ownership}</Badge>
          <Badge variant="featured">{household.serviceTier}</Badge>
          {household.nextReview ? (
            <Badge variant="neutral">Next review {household.nextReview}</Badge>
          ) : null}
          <Badge variant={syncVariant[household.syncState]}>
            {syncCopy[household.syncState]}
          </Badge>
        </div>
      </header>
      <SurfaceToolbar data-testid="crm-household-toolbar">
        <Button
          size="sm"
          iconLeft={Plus}
          iconRight={ChevronDown}
          data-testid="crm-household-add"
          onClick={() => setAddOpen(true)}
        >
          Add to this household
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-testid="crm-household-metadata"
          onClick={() => setMetadataOpen(true)}
        >
          Fields and tags
        </Button>
        {household.schedulingLinkUrl ? (
          <Button
            size="sm"
            variant="secondary"
            iconLeft={CalendarDays}
            data-testid="crm-household-schedule"
            onClick={() =>
              actions?.onOpenSchedulingLink?.(household.schedulingLinkUrl!)
            }
          >
            Schedule with this household
          </Button>
        ) : (
          <span
            title="Ask a firm admin to add a scheduling link"
            style={{ fontSize: 13, color: '#64748b' }}
          >
            Scheduling link unavailable
          </span>
        )}
      </SurfaceToolbar>
      <SegmentedToggle
        ariaLabel="Household sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'client_map', label: 'Client Map' },
          { value: 'timeline', label: 'Timeline' },
          { value: 'documents', label: 'Documents' },
          { value: 'email', label: 'Email' },
          { value: 'meetings', label: 'Meetings' },
          { value: 'activity', label: 'Activity' },
        ]}
        data-testid="crm-household-tab"
      />
      {tab === 'client_map' ? (
        <ClientMap household={household} />
      ) : (
        <ExistingSurface
          tab={tab}
          household={household}
          proposals={sourceProposals}
          actions={actions}
        />
      )}
      <SlidePanel
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add to this household"
        data-testid="crm-household-add-panel"
      >
        <div style={{ display: 'grid', gap: 8 }}>
          {(
            [
              'fact',
              'note',
              'task',
              'account',
              'person',
              'opportunity',
              'workflow',
            ] as const
          ).map((kind) => (
            <Button
              key={kind}
              variant="secondary"
              size="sm"
              data-testid={`crm-household-add-${kind}`}
              onClick={() => {
                if (kind === 'note') {
                  setNoteAudience('internal');
                  setAddOpen(false);
                } else
                  actions?.onAdd?.({
                    kind,
                    householdRef: {
                      kind: 'household',
                      id: household.id,
                      label: household.name,
                    },
                    contextRefs: [
                      {
                        kind: 'household',
                        id: household.id,
                        label: household.name,
                      },
                    ],
                  });
              }}
            >
              {kind === 'note' ? 'Add internal note' : `Add ${kind}`}
            </Button>
          ))}
          <Button
            size="sm"
            variant="secondary"
            data-testid="crm-household-add-client-note"
            onClick={() => {
              setNoteAudience('client-facing');
              setAddOpen(false);
            }}
          >
            Add client-facing note
          </Button>
        </div>
      </SlidePanel>
      <SlidePanel
        open={noteAudience !== null}
        onClose={() => setNoteAudience(null)}
        title={
          noteAudience === 'internal'
            ? 'New internal note'
            : 'New client-facing note'
        }
      >
        {noteAudience ? (
          <NoteEditor
            audience={noteAudience}
            availableMentions={household.members.map((member) => ({
              id: member.id,
              label: member.name,
            }))}
            actions={actions}
            onCancel={() => setNoteAudience(null)}
          />
        ) : null}
      </SlidePanel>
      <SlidePanel
        open={metadataOpen}
        onClose={() => setMetadataOpen(false)}
        title="Fields and tags"
      >
        <RecordMetadataEditor
          values={household.customFields ?? []}
          tags={household.tags}
          actions={actions}
        />
      </SlidePanel>
    </section>
  );
}

function ClientMap({ household }: { household: HouseholdRecord }) {
  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
      <Card variant="raised" data-testid="crm-household-facts">
        <h2>Facts</h2>
        {household.facts.length ? (
          household.facts.map((fact) => (
            <div
              key={fact.id}
              style={{ padding: '8px 0', borderTop: '1px solid #e2e8f0' }}
            >
              <strong>
                {fact.label}: {fact.value}
              </strong>{' '}
              <Badge variant="neutral">{fact.status}</Badge>
              <div style={{ fontSize: 13, color: '#475569' }}>
                As of {fact.asOf}
                {fact.learned ? ` · Learned ${fact.learned}` : ''}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 5,
                  flexWrap: 'wrap',
                  marginTop: 5,
                }}
              >
                {fact.sources.map((source) => (
                  <CiteChip
                    key={source.id}
                    docLabel={source.label}
                    quote={source.asOf ?? 'Source available'}
                  >
                    {source.label}
                  </CiteChip>
                ))}
              </div>
              {fact.history?.length ? (
                <details>
                  <summary>Older values ({fact.history.length})</summary>
                  {fact.history.map((older) => (
                    <div key={older.id}>
                      {older.value} · As of {older.asOf}
                    </div>
                  ))}
                </details>
              ) : null}
            </div>
          ))
        ) : (
          <p>Start the client map with Add a fact.</p>
        )}
      </Card>
      <Card variant="raised" data-testid="crm-household-accounts">
        <h2>Accounts</h2>
        {household.accounts.map((account) => (
          <div key={account.id}>
            <strong>
              {account.custodian} · {account.type}{' '}
              {account.lastFour ? `· •${account.lastFour}` : ''}
            </strong>
            <div>
              {account.status}
              {account.owner ? ` · ${account.owner}` : ''} ·{' '}
              <b>{account.purpose ?? 'Needs a purpose'}</b>
            </div>
          </div>
        ))}
      </Card>
      <Card variant="raised" data-testid="crm-household-people">
        <h2>People</h2>
        <p>
          <strong>Household members:</strong>{' '}
          {household.members
            .map(
              (person) =>
                `${person.name}${person.householdRole ? ` (${person.householdRole})` : ''}`
            )
            .join(', ') || 'None'}
        </p>
        <p>
          <strong>External parties:</strong>{' '}
          {household.externalParties
            .map(
              (person) =>
                `${person.name} · ${person.roles.join(', ') || 'No role'} · ${person.verifiedAt ? 'Recipient verified' : 'Needs verification'}`
            )
            .join('; ') || 'None'}
        </p>
      </Card>
      <Card variant="raised" data-testid="crm-household-notes">
        <div
          style={{
            border: '1px solid #d97706',
            background: '#fffbeb',
            padding: 10,
          }}
        >
          <Lock size={14} aria-hidden="true" /> <strong>Internal only</strong>
          <p>Never included in client-facing drafts.</p>
          {household.notes
            .filter((note) => note.audience === 'internal')
            .map((note) => (
              <p key={note.id}>{note.body}</p>
            ))}
        </div>
        <div
          style={{
            border: '1px solid #0f766e',
            background: '#f0fdfa',
            padding: 10,
            marginTop: 8,
          }}
        >
          <strong>Client-facing</strong>
          <p>Audience fixed at creation.</p>
          {household.notes
            .filter((note) => note.audience === 'client-facing')
            .map((note) => (
              <p key={note.id}>{note.body}</p>
            ))}
        </div>
      </Card>
    </div>
  );
}

function ExistingSurface({
  tab,
  household,
  proposals,
  actions,
}: {
  tab: Exclude<HouseholdTab, 'client_map'>;
  household: HouseholdRecord;
  proposals: readonly CrmProposal[];
  actions?: CrmClientsActions;
}) {
  const label = tab === 'email' ? 'Email' : tab[0].toUpperCase() + tab.slice(1);
  return (
    <div
      style={{ display: 'grid', gap: 12, marginTop: 14 }}
      data-testid={`crm-household-${tab}`}
    >
      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} actions={actions} />
      ))}
      <Card variant="raised">
        <h2>{label}</h2>
        <p>
          {tab === 'email'
            ? 'This preserves the existing threaded mail surface. Draft email opens its recipient verification and external approval flow.'
            : `This preserves the existing ${label.toLowerCase()} layout and source content.`}
        </p>
        {tab === 'email' ? (
          <Button
            size="sm"
            iconLeft={Mail}
            data-testid="crm-open-mail-surface"
            onClick={() =>
              actions?.onDraftEmail?.({
                kind: 'open_mail_surface',
                householdRef: {
                  kind: 'household',
                  id: household.id,
                  label: household.name,
                },
                contextRefs: [
                  {
                    kind: 'household',
                    id: household.id,
                    label: household.name,
                  },
                ],
                source: 'crm_household',
              })
            }
          >
            Open mail surface
          </Button>
        ) : (
          <span>
            <Clock3 size={14} aria-hidden="true" /> No history yet.
          </span>
        )}
      </Card>
    </div>
  );
}
