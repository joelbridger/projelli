/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { createElement, useState } from 'react';
import {
  CalendarDays,
  ArrowLeft,
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
import type { CrmEngineFreshness } from '@/platform/crm/store';
import type { TimelineRecord } from '@/features/crm-timeline';
import { ContactEditor } from './ContactEditor';
import { householdTabRegistry, type HouseholdTab } from './tabRegistry';

const syncCopy: Record<HouseholdRecord['syncState'], string> = {
  live: 'Live',
  syncing:
    'Syncing — showing at least received changes; newer changes may still arrive.',
  last_synced: 'Last synced',
  offline: 'Working offline — local edits wait to deliver.',
  needs_attention: 'Needs attention',
};

function syncLabel(household: HouseholdRecord): string {
  if (household.syncState === 'last_synced') {
    return household.lastSyncedAt ? `Last synced ${household.lastSyncedAt}` : 'Last synced';
  }
  if (household.syncState === 'syncing' && household.lastSyncedAt) {
    return `Syncing — received through ${household.lastSyncedAt}`;
  }
  return syncCopy[household.syncState];
}
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
  onSaveHousehold,
  onBack,
  timelineRecords = [],
  timelineFreshness,
}: {
  household: HouseholdRecord;
  proposals?: readonly CrmProposal[];
  actions?: CrmClientsActions;
  onSaveHousehold?: (household: HouseholdRecord) => Promise<void> | void;
  onBack?: () => void;
  timelineRecords?: readonly TimelineRecord[];
  timelineFreshness?: CrmEngineFreshness;
}) {
  const schedulingLinkUrl = household.schedulingLinkUrl;
  const [tab, setTab] = useState<HouseholdTab>('client_map');
  const [addOpen, setAddOpen] = useState(false);
  const [noteAudience, setNoteAudience] = useState<
    'internal' | 'client-facing' | null
  >(null);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [editingHousehold, setEditingHousehold] = useState(false);
  const [adding, setAdding] = useState<'person' | 'account' | 'fact' | null>(null);
  const [editingPerson, setEditingPerson] = useState<import('./adapters').CrmPerson | null>(null);
  const sourceProposals = tab === 'client_map' ? [] : proposals;
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
          <div style={{ display: 'flex', gap: 8 }}>
            {onBack ? <Button size="sm" variant="secondary" iconLeft={ArrowLeft} data-testid="crm-household-back" onClick={onBack}>Directory</Button> : null}
            <Button
              size="sm"
              data-testid="crm-ask-household"
              onClick={() => actions?.onAskHousehold?.(household.id)}
            >
              Ask this household
            </Button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <Badge variant="neutral">{household.lifecycle}</Badge>
          <Badge variant="neutral" data-testid="crm-household-primary-advisor">
            Owned by {household.primaryAdvisor}
          </Badge>
          <Badge variant="neutral" data-testid="crm-household-ownership">
            {household.ownership}
          </Badge>
          <Badge variant="featured">{household.serviceTier}</Badge>
          {household.nextReview ? (
            <Badge variant="neutral">Next review {household.nextReview}</Badge>
          ) : null}
          <Badge variant={syncVariant[household.syncState]}>
            {syncLabel(household)}
          </Badge>
        </div>
      </header>
      <SurfaceToolbar data-testid="crm-household-toolbar">
        <Button
          size="sm"
          iconLeft={Plus}
          iconRight={ChevronDown}
          data-testid="crm-household-add"
          onClick={() => { setAddOpen(true); }}
        >
          Add to this household
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-testid="crm-household-metadata"
          onClick={() => { setMetadataOpen(true); }}
        >
          Fields and tags
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-testid="crm-household-edit"
          onClick={() => { setEditingHousehold(true); }}
        >
          Edit household
        </Button>
        {schedulingLinkUrl ? (
          <Button
            size="sm"
            variant="secondary"
            iconLeft={CalendarDays}
            data-testid="crm-household-schedule"
            onClick={() =>
              actions?.onOpenSchedulingLink?.(schedulingLinkUrl)
            }
          >
            Schedule with this household
          </Button>
        ) : (
          <span
            title="Ask a firm admin to add a scheduling link"
            style={{ fontSize: 13, color: 'var(--color-slate-500)' }}
          >
            Scheduling link unavailable
          </span>
        )}
      </SurfaceToolbar>
      <SegmentedToggle
        ariaLabel="Household sections"
        value={tab}
        onChange={setTab}
        options={householdTabRegistry.map(({ route, label }) => ({ value: route, label }))}
        data-testid="crm-household-tab"
      />
      {(() => {
        const selectedTab = householdTabRegistry.find((surface) => surface.route === tab) ?? householdTabRegistry[0]!;
        const legacyTabs = {
          client_map: <ClientMap household={household} onEditPerson={setEditingPerson} onDeleteFact={async (id: string) => { await onSaveHousehold?.({ ...household, facts: household.facts.filter((fact) => fact.id !== id) }); }} />,
          timeline: <ExistingSurface tab="timeline" household={household} proposals={sourceProposals} {...(actions ? { actions } : {})} />,
          documents: <ExistingSurface tab="documents" household={household} proposals={sourceProposals} {...(actions ? { actions } : {})} />,
          activity: <ExistingSurface tab="activity" household={household} proposals={sourceProposals} {...(actions ? { actions } : {})} />,
        };
        return createElement(selectedTab.Component, {
          household,
          proposals: sourceProposals,
          ...(actions ? { actions } : {}),
          timelineRecords,
          ...(timelineFreshness ? { timelineFreshness } : {}),
          renderLegacySurface: (id: HouseholdTab) => legacyTabs[id as keyof typeof legacyTabs] ?? null,
        });
      })()}
      <SlidePanel
        open={addOpen}
        onClose={() => { setAddOpen(false); }}
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
                } else if (kind === 'person' || kind === 'account' || kind === 'fact') {
                  setAdding(kind);
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
        onClose={() => { setNoteAudience(null); }}
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
            {...(actions ? { actions } : {})}
            onCancel={() => { setNoteAudience(null); }}
            onSaved={() => { setNoteAudience(null); }}
          />
        ) : null}
      </SlidePanel>
      <SlidePanel
        open={metadataOpen}
        onClose={() => { setMetadataOpen(false); }}
        title="Fields and tags"
      >
        <RecordMetadataEditor
          values={household.customFields ?? []}
          {...(household.tags ? { tags: household.tags } : {})}
          {...(actions ? { actions } : {})}
          onSaved={() => { setMetadataOpen(false); }}
        />
      </SlidePanel>
      <SlidePanel
        open={editingHousehold}
        onClose={() => { setEditingHousehold(false); }}
        title="Edit household"
      >
        <HouseholdEditor
          household={household}
          onSave={async (next) => {
            await onSaveHousehold?.(next);
            setEditingHousehold(false);
          }}
        />
      </SlidePanel>
      <SlidePanel
        open={adding === 'person'}
        onClose={() => { setAdding(null); }}
        title="Add contact"
      >
        <ContactEditor
          onSave={async (person) => {
            await onSaveHousehold?.({
              ...household,
              members: person.external ? household.members : [...household.members, person],
              externalParties: person.external ? [...household.externalParties, person] : household.externalParties,
            });
            setAdding(null);
          }}
        />
      </SlidePanel>
      <SlidePanel open={adding === 'fact'} onClose={() => { setAdding(null); }} title="Add a fact">
        <FactEditor onSave={async (fact) => { await onSaveHousehold?.({ ...household, facts: [...household.facts, fact] }); setAdding(null); }} />
      </SlidePanel>
      <SlidePanel open={editingPerson !== null} onClose={() => { setEditingPerson(null); }} title="Edit contact">
        {editingPerson ? <ContactEditor person={editingPerson} onSave={async (person) => { const replace = (people: readonly import('./adapters').CrmPerson[]) => people.map((item) => item.id === person.id ? person : item); await onSaveHousehold?.({ ...household, members: replace(household.members), externalParties: replace(household.externalParties) }); setEditingPerson(null); }} onRemove={async () => { await onSaveHousehold?.({ ...household, members: household.members.filter((item) => item.id !== editingPerson.id), externalParties: household.externalParties.filter((item) => item.id !== editingPerson.id) }); setEditingPerson(null); }} /> : null}
      </SlidePanel>
      <SlidePanel
        open={adding === 'account'}
        onClose={() => { setAdding(null); }}
        title="Add account"
      >
        <AccountEditor
          onSave={async (account) => {
            await onSaveHousehold?.({ ...household, accounts: [...household.accounts, account] });
            setAdding(null);
          }}
        />
      </SlidePanel>
    </section>
  );
}

function HouseholdEditor({ household, onSave }: { household: HouseholdRecord; onSave: (household: HouseholdRecord) => Promise<void> | void }) {
  const [name, setName] = useState(household.name);
  const [lifecycle, setLifecycle] = useState(household.lifecycle);
  const [advisor, setAdvisor] = useState(household.primaryAdvisor);
  const [tier, setTier] = useState(household.serviceTier);
  const [nextReview, setNextReview] = useState(household.nextReview ?? '');
  return <form data-testid="crm-household-editor" onSubmit={(event) => { event.preventDefault(); const cleanName = name.trim(); if (!cleanName) return; const next = { ...household, name: cleanName, lifecycle: lifecycle.trim() || 'Active', primaryAdvisor: advisor.trim() || 'Unassigned', serviceTier: tier.trim() || 'Standard' }; if (nextReview.trim()) next.nextReview = nextReview.trim(); else delete next.nextReview; void onSave(next); }} style={{ display: 'grid', gap: 10 }}>
    <label>Household name<input data-testid="crm-household-edit-name" value={name} onChange={(event) => { setName(event.target.value); }} /></label>
    <label>Lifecycle<input data-testid="crm-household-edit-lifecycle" value={lifecycle} onChange={(event) => { setLifecycle(event.target.value); }} /></label>
    <label>Primary advisor<input data-testid="crm-household-edit-advisor" value={advisor} onChange={(event) => { setAdvisor(event.target.value); }} /></label>
    <label>Service tier<input data-testid="crm-household-edit-tier" value={tier} onChange={(event) => { setTier(event.target.value); }} /></label>
    <label>Next review<input data-testid="crm-household-edit-review" value={nextReview} onChange={(event) => { setNextReview(event.target.value); }} /></label>
    <Button data-testid="crm-household-edit-save" type="submit">Save household</Button>
  </form>;
}

function FactEditor({ onSave }: { onSave: (fact: import('./adapters').CrmFact) => Promise<void> | void }) {
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState('');
  const [sourceRef, setSourceRef] = useState('');
  return <form data-testid="crm-fact-editor" onSubmit={(event) => { event.preventDefault(); if (!label.trim() || !value.trim() || !asOf || !source.trim()) return; void onSave({ id: `fact:${crypto.randomUUID()}`, label: label.trim(), value: value.trim(), status: 'Current', asOf, learned: new Date().toISOString().slice(0, 10), sources: [{ id: `source:${crypto.randomUUID()}`, label: source.trim(), ...(sourceRef.trim() ? { ref: sourceRef.trim() } : {}) }] }); }} style={{ display: 'grid', gap: 10 }}>
    <label>What should the firm remember?<input data-testid="crm-fact-label" value={label} onChange={(event) => setLabel(event.target.value)} /></label>
    <label>Value<input data-testid="crm-fact-value" value={value} onChange={(event) => setValue(event.target.value)} /></label>
    <label>True as of<input data-testid="crm-fact-as-of" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label>
    <label>Source<input data-testid="crm-fact-source" value={source} onChange={(event) => setSource(event.target.value)} placeholder="Tax return, meeting, or advisor" /></label>
    <label>Open this source (optional)<input data-testid="crm-fact-source-ref" value={sourceRef} onChange={(event) => setSourceRef(event.target.value)} placeholder="Workspace file, mail link, or web link" /></label>
    <Button data-testid="crm-fact-save" type="submit">Save fact</Button>
  </form>;
}

function AccountEditor({ onSave }: { onSave: (account: import('./adapters').CrmAccount) => Promise<void> | void }) {
  const [custodian, setCustodian] = useState('');
  const [type, setType] = useState('');
  const [purpose, setPurpose] = useState('');
  const [lastFour, setLastFour] = useState('');
  return <form data-testid="crm-account-editor" onSubmit={(event) => { event.preventDefault(); if (!custodian.trim() || !type.trim() || !purpose.trim()) return; void onSave({ id: `account:${crypto.randomUUID()}`, custodian: custodian.trim(), type: type.trim(), purpose: purpose.trim(), ...(lastFour.trim() ? { lastFour: lastFour.trim().slice(-4) } : {}), status: 'Open' }); }} style={{ display: 'grid', gap: 10 }}>
    <label>Custodian<input data-testid="crm-account-custodian" value={custodian} onChange={(event) => { setCustodian(event.target.value); }} /></label>
    <label>Account type<input data-testid="crm-account-type" value={type} onChange={(event) => { setType(event.target.value); }} /></label>
    <label>Purpose<input data-testid="crm-account-purpose" value={purpose} onChange={(event) => { setPurpose(event.target.value); }} /></label>
    <label>Last four only<input data-testid="crm-account-last-four" inputMode="numeric" value={lastFour} onChange={(event) => { setLastFour(event.target.value); }} /></label>
    <Button data-testid="crm-account-save" type="submit">Save account</Button>
  </form>;
}

function ClientMap({ household, onEditPerson, onDeleteFact }: { household: HouseholdRecord; onEditPerson: (person: import('./adapters').CrmPerson) => void; onDeleteFact: (id: string) => Promise<void> | void }) {
  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
      <Card variant="raised" data-testid="crm-household-facts">
        <h2>Facts</h2>
        {household.facts.length ? (
          household.facts.map((fact) => (
            <div
              key={fact.id}
              data-testid={`crm-household-fact-${fact.id}`}
              style={{ padding: '8px 0', borderTop: '1px solid var(--color-slate-200)' }}
            >
              <strong>
                {fact.label}: {fact.value}
              </strong>{' '}
              <Badge variant="neutral">{fact.status}</Badge>
              <div style={{ fontSize: 13, color: 'var(--color-slate-600)' }}>
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
                {fact.sources.map((source) => source.ref ? (
                  <button key={source.id} type="button" data-testid={`crm-fact-source-${source.id}`} title={`Open ${source.label}`} onClick={() => { window.open(source.ref, '_blank', 'noopener,noreferrer'); }}><CiteChip docLabel={source.label} quote={source.asOf ?? 'Open source'}>{source.label}</CiteChip></button>
                ) : <CiteChip key={source.id} docLabel={source.label} quote={source.asOf ?? 'Source recorded'}>{source.label}</CiteChip>)}
              </div>
              <Button size="sm" variant="secondary" data-testid={`crm-fact-remove-${fact.id}`} onClick={() => { void onDeleteFact(fact.id); }}>Remove fact</Button>
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
          <div key={account.id} data-testid={`crm-household-account-${account.id}`}>
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
          {household.members.length ? household.members.map((person) => <span key={person.id} data-testid={`crm-household-person-${person.id}`} style={{ display: 'block' }}><button type="button" data-testid={`crm-person-edit-${person.id}`} onClick={() => onEditPerson(person)}>{person.name}</button>{person.householdRole ? <span data-testid={`crm-person-household-role-${person.id}`}> ({person.householdRole})</span> : null}{person.roles.length ? <span data-testid={`crm-person-roles-${person.id}`}> · {person.roles.join(', ')}</span> : null}{person.emails?.length ? <span data-testid={`crm-person-email-${person.id}`}> · {person.emails.find((email) => email.primary)?.address ?? person.emails[0]?.address}</span> : null}{person.phones?.length ? <span data-testid={`crm-person-phone-${person.id}`}> · {person.phones.find((phone) => phone.primary)?.address ?? person.phones[0]?.address}</span> : null}{person.addresses?.length ? <span data-testid={`crm-person-address-${person.id}`} style={{ display: 'block', color: 'var(--color-slate-600)' }}>{person.addresses.find((address) => address.primary)?.address ?? person.addresses[0]?.address}</span> : null}</span>) : 'None'}
        </p>
        <p>
          <strong>External parties:</strong>{' '}
          {household.externalParties.length ? household.externalParties.map((person) => <span key={person.id} style={{ display: 'block' }}><button type="button" data-testid={`crm-person-edit-${person.id}`} onClick={() => onEditPerson(person)}>{person.name}</button>{` · ${person.roles.join(', ') || 'No role'} · ${person.verifiedAt ? 'Recipient verified' : 'Needs verification'}`}</span>) : 'None'}
        </p>
      </Card>
      <Card variant="raised" data-testid="crm-household-metadata-summary">
        <h2>Tags and fields</h2>
        {household.tags?.length ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: household.customFields?.length ? 12 : 0 }}>
            {household.tags.map((tag) => <Badge key={tag} variant="featured" data-testid={`crm-household-tag-${tag}`}>{tag}</Badge>)}
          </div>
        ) : null}
        {household.customFields?.length ? (
          <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, auto) 1fr', gap: '6px 12px', margin: 0 }}>
            {household.customFields.map((field) => <div key={field.id} data-testid={`crm-household-field-${field.id}`} style={{ display: 'contents' }}><dt style={{ color: 'var(--color-slate-600)' }}>{field.label}</dt><dd style={{ margin: 0 }}>{field.value || 'Not set'}</dd></div>)}
          </dl>
        ) : null}
        {!household.tags?.length && !household.customFields?.length ? <p>Use Fields and tags to add details that belong only to this household.</p> : null}
      </Card>
      <Card variant="raised" data-testid="crm-household-notes">
        <div
          style={{
            border: '1px solid var(--color-amber-600)',
            background: 'var(--color-amber-50)',
            padding: 10,
          }}
        >
          <Lock size={14} aria-hidden="true" /> <strong>Internal only</strong>
          <p>Never included in client-facing drafts.</p>
          {household.notes
            .filter((note) => note.audience === 'internal')
            .map((note) => (
              <p key={note.id} data-testid={`crm-note-${note.id}`}>
                {note.pinned ? <Badge variant="featured" data-testid={`crm-note-pinned-${note.id}`}>Pinned</Badge> : null}{' '}
                {note.body}
              </p>
            ))}
        </div>
        <div
          style={{
            border: '1px solid var(--color-teal-700)',
            background: 'var(--color-teal-50)',
            padding: 10,
            marginTop: 8,
          }}
        >
          <strong>Client-facing</strong>
          <p>Audience fixed at creation.</p>
          {household.notes
            .filter((note) => note.audience === 'client-facing')
            .map((note) => (
              <p key={note.id} data-testid={`crm-note-${note.id}`}>
                {note.pinned ? <Badge variant="featured" data-testid={`crm-note-pinned-${note.id}`}>Pinned</Badge> : null}{' '}
                {note.body}
              </p>
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
  const label = tab === 'email' ? 'Email' : tab.charAt(0).toUpperCase() + tab.slice(1);
  return (
    <div
      style={{ display: 'grid', gap: 12, marginTop: 14 }}
      data-testid={`crm-household-${tab}`}
    >
      {proposals.map((proposal) => (
        <ProposalCard key={proposal.record.id} proposal={proposal} {...(actions ? { actions } : {})} />
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
