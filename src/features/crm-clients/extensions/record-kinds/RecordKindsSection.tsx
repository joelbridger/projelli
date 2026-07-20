/* eslint-disable lantern-i18n/no-hardcoded-string -- Copy follows the approved alt-familiar CRM record prototype. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  useContactRecordStore,
  type ContactChannel,
  type ContactRecord,
} from '@/features/crm-contacts';
import {
  useSelectionOperationDecision,
  type SelectionOperationDecision,
} from '@/platform/client-context';
import { Badge, Button, Card, SlidePanel } from '@/ui/kp';
import type { HouseholdSectionContext } from '../../recordRegistry';
import {
  RecordKindsIsolationError,
  contactKindLabel,
  createEmptyRecordKindsDetails,
  createRecordKindsRepository,
  sealRecordKindsClientScope,
  type RecordKindsDetails,
  type RecordKindsDraft,
  type RecordKindsSnapshot,
  type SealedRecordKindsClientScope,
} from './recordKindsStore';

const recordKindsSelectionRequest = {
  operationClass: 'client-scoped',
  allowAllMatters: false,
  requireFollowerAgreement: true,
} as const;

type ScopeResult =
  | { readonly kind: 'ready'; readonly scope: SealedRecordKindsClientScope }
  | { readonly kind: 'blocked'; readonly message: string };

type LoadState =
  | { readonly kind: 'loading'; readonly scopeKey: string }
  | {
      readonly kind: 'ready';
      readonly scopeKey: string;
      readonly records: readonly RecordKindsSnapshot[];
    }
  | {
      readonly kind: 'error';
      readonly scopeKey: string;
      readonly message: string;
    };

export function RecordKindsBoundaryBlocked() {
  return (
    <Card
      variant="raised"
      role="alert"
      data-testid="record-kinds-blocked"
      style={{ marginTop: 14 }}
    >
      <h2>Contact details unavailable</h2>
      <p>
        Contact details are blocked because this household has no verified
        client workspace link.
      </p>
    </Card>
  );
}

function resolveScope(
  context: HouseholdSectionContext,
  decision: SelectionOperationDecision
): ScopeResult {
  if (decision.kind === 'refused') {
    return { kind: 'blocked', message: decision.message };
  }
  if (
    decision.kind !== 'matter' ||
    decision.sourceKind !== 'matter' ||
    !decision.client ||
    decision.matter.id !== context.matterId ||
    decision.client.householdId !== context.householdRef.id
  ) {
    return {
      kind: 'blocked',
      message:
        'Contact details are blocked because the selected household and client workspace do not match.',
    };
  }
  try {
    return {
      kind: 'ready',
      scope: sealRecordKindsClientScope({
        householdRef: context.householdRef,
        matterId: context.matterId,
      }),
    };
  } catch {
    return {
      kind: 'blocked',
      message:
        'Contact details are blocked because this household has no verified client workspace link.',
    };
  }
}

function scopeKey(scope: SealedRecordKindsClientScope): string {
  return `${scope.matterId}\u0000${scope.householdRef.id}`;
}

export function RecordKindsSection({
  context,
}: {
  context: HouseholdSectionContext;
}) {
  const decision = useSelectionOperationDecision(recordKindsSelectionRequest);
  const contactStore = useContactRecordStore();
  const recordsSignature = contactStore.records
    .map(
      (record) =>
        `${record.kind}:${record.id}:${record.matterId}:${record.updatedAt ?? ''}`
    )
    .join('|');
  const repository = useMemo(
    () => createRecordKindsRepository(contactStore),
    // The public contact hook currently returns a new facade each render. The
    // saved-record signature is its stable reactive value.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- explained above
    [recordsSignature]
  );
  const boundary = useMemo(
    () => resolveScope(context, decision),
    [context, decision]
  );
  const activeKey = boundary.kind === 'ready' ? scopeKey(boundary.scope) : '';
  const [state, setState] = useState<LoadState>({
    kind: 'loading',
    scopeKey: activeKey,
  });
  const [editing, setEditing] = useState<RecordKindsSnapshot | null>(null);
  const [addingIndividual, setAddingIndividual] = useState(false);

  const reload = useCallback(async () => {
    if (boundary.kind !== 'ready') return;
    const key = scopeKey(boundary.scope);
    setState({ kind: 'loading', scopeKey: key });
    try {
      const records = await repository.list(boundary.scope);
      setState({ kind: 'ready', scopeKey: key, records });
    } catch (error) {
      setState({
        kind: 'error',
        scopeKey: key,
        message:
          error instanceof RecordKindsIsolationError
            ? error.message
            : 'The saved contact details could not be read.',
      });
    }
  }, [boundary, repository]);

  useEffect(() => {
    reload().catch(() => {
      setState({
        kind: 'error',
        scopeKey: activeKey,
        message: 'The saved contact details could not be read.',
      });
    });
  }, [activeKey, recordsSignature, reload]);

  if (boundary.kind === 'blocked') {
    return (
      <Card
        variant="raised"
        role="alert"
        data-testid="record-kinds-blocked"
        style={{ marginTop: 14 }}
      >
        <h2>Contact details unavailable</h2>
        <p>{boundary.message}</p>
      </Card>
    );
  }

  if (state.scopeKey !== activeKey || state.kind === 'loading') {
    return (
      <Card
        variant="raised"
        data-testid="record-kinds-loading"
        style={{ marginTop: 14 }}
      >
        <p>Loading this client’s contact details…</p>
      </Card>
    );
  }

  if (state.kind === 'error') {
    return (
      <Card
        variant="raised"
        role="alert"
        data-testid="record-kinds-error"
        style={{ marginTop: 14 }}
      >
        <h2>Contact details could not be opened</h2>
        <p>{state.message}</p>
      </Card>
    );
  }

  return (
    <section data-testid="record-kinds-section" style={{ marginTop: 14 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 10,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Contact details</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--color-slate-600)' }}>
            Household and individual records saved inside this client only.
          </p>
        </div>
        <Button
          size="sm"
          iconLeft={Plus}
          data-testid="record-kinds-add-individual"
          onClick={() => {
            setAddingIndividual(true);
          }}
        >
          Add individual
        </Button>
      </div>
      {state.records.length === 0 ? (
        <Card variant="raised" data-testid="record-kinds-empty">
          <h3>No contact records yet</h3>
          <p>Add an individual when this client’s contact record is ready.</p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {state.records.map((item) => (
            <RecordDetailsCard
              key={`${item.ref.kind}:${item.ref.id}`}
              snapshot={item}
              onEdit={() => {
                setEditing(item);
              }}
            />
          ))}
        </div>
      )}
      <SlidePanel
        open={editing !== null}
        onClose={() => {
          setEditing(null);
        }}
        title={editing ? `Edit ${editing.record.displayName}` : 'Edit contact'}
        data-testid="record-kinds-edit-panel"
      >
        {editing ? (
          <RecordDetailsEditor
            key={`${editing.ref.kind}:${editing.ref.id}`}
            snapshot={editing}
            onSave={async (draft) => {
              await repository.update(boundary.scope, editing.ref, draft);
              setEditing(null);
              await reload();
            }}
          />
        ) : null}
      </SlidePanel>
      <SlidePanel
        open={addingIndividual}
        onClose={() => {
          setAddingIndividual(false);
        }}
        title="Add individual"
        data-testid="record-kinds-add-panel"
      >
        <AddIndividualForm
          onSave={async (firstName, lastName) => {
            await repository.create(
              boundary.scope,
              { kind: 'person', firstName, lastName, lifecycle: 'Active' },
              createEmptyRecordKindsDetails()
            );
            setAddingIndividual(false);
            await reload();
          }}
        />
      </SlidePanel>
    </section>
  );
}

function RecordDetailsCard({
  snapshot,
  onEdit,
}: {
  snapshot: RecordKindsSnapshot;
  onEdit: () => void;
}) {
  const { record, details } = snapshot;
  const emails = record.channels.filter((channel) =>
    channel.kind.startsWith('email:')
  );
  const phones = record.channels.filter((channel) =>
    channel.kind.startsWith('phone:')
  );
  return (
    <Card
      variant="raised"
      data-testid={`record-kinds-card-${record.id}`}
      style={{ padding: 0, overflow: 'hidden' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: 16,
          borderBottom: '1px solid var(--color-slate-200)',
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>{record.displayName}</h3>
          <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
            <Badge variant="neutral">{contactKindLabel(record.kind)}</Badge>
            <Badge variant="featured">{record.lifecycle}</Badge>
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          data-testid={`record-kinds-edit-${record.id}`}
          style={{ marginLeft: 'auto' }}
          onClick={onEdit}
        >
          Edit
        </Button>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: 18,
          padding: 16,
        }}
      >
        <DetailsList
          title="Contact details & background"
          rows={[
            ['Primary advisor', record.primaryAdvisor || 'Not set'],
            ['Service tier', details.profile.serviceTier || 'Not set'],
            ['Address', details.profile.address || 'Not set'],
            [
              'Preferred contact',
              details.profile.preferredContact || 'Not set',
            ],
            ['Background', details.profile.background || 'Not set'],
          ]}
        />
        <DetailsList
          title="Email and phone"
          empty="No email or phone rows saved yet."
          rows={[
            ...emails.map(
              (channel) =>
                [
                  channel.kind.slice('email:'.length) || 'Email',
                  `${channel.address}${channel.primary ? ' · Primary' : ''}`,
                ] as const
            ),
            ...phones.map(
              (channel) =>
                [
                  channel.kind.slice('phone:'.length) || 'Phone',
                  `${channel.address}${channel.primary ? ' · Primary' : ''}`,
                ] as const
            ),
          ]}
        />
        <DetailsList
          title="Facts"
          empty="No facts saved yet."
          testId={`record-kinds-facts-${record.id}`}
          rows={details.facts.map((fact) => [fact.label, fact.value])}
        />
        <DetailsList
          title="Linked financial accounts"
          empty="No linked financial accounts yet."
          rows={details.accounts.map((account) => [
            `${account.institution} · ${account.accountType}`,
            `${account.relationship}${account.lastFour ? ` · •${account.lastFour}` : ''}`,
          ])}
        />
      </div>
    </Card>
  );
}

function DetailsList({
  title,
  rows,
  empty,
  testId,
}: {
  title: string;
  rows: readonly (readonly [string, string])[];
  empty?: string;
  testId?: string;
}) {
  return (
    <section {...(testId ? { 'data-testid': testId } : {})}>
      <h4 style={{ margin: '0 0 9px' }}>{title}</h4>
      {rows.length ? (
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(110px, auto) 1fr',
            gap: '7px 12px',
            margin: 0,
          }}
        >
          {rows.map(([label, value], index) => (
            <div
              key={`${label}:${String(index)}`}
              style={{ display: 'contents' }}
            >
              <dt
                style={{
                  color: 'var(--color-slate-600)',
                  textTransform: 'capitalize',
                }}
              >
                {label}
              </dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p style={{ color: 'var(--color-slate-600)' }}>{empty}</p>
      )}
    </section>
  );
}

function AddIndividualForm({
  onSave,
}: {
  onSave: (firstName: string, lastName: string) => Promise<void>;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <form
      data-testid="record-kinds-add-individual-form"
      style={{ display: 'grid', gap: 12 }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!firstName.trim() && !lastName.trim()) {
          setError('A first or last name is required.');
          return;
        }
        setError('');
        setSaving(true);
        void onSave(firstName.trim(), lastName.trim())
          .catch(() => {
            setError('The individual could not be saved.');
          })
          .finally(() => {
            setSaving(false);
          });
      }}
    >
      <label>
        First name
        <input
          data-testid="record-kinds-add-first-name"
          value={firstName}
          onChange={(event) => {
            setFirstName(event.target.value);
          }}
        />
      </label>
      <label>
        Last name
        <input
          data-testid="record-kinds-add-last-name"
          value={lastName}
          onChange={(event) => {
            setLastName(event.target.value);
          }}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <Button
        type="submit"
        loading={saving}
        data-testid="record-kinds-add-save"
      >
        Save individual
      </Button>
    </form>
  );
}

function RecordDetailsEditor({
  snapshot,
  onSave,
}: {
  snapshot: RecordKindsSnapshot;
  onSave: (draft: RecordKindsDraft) => Promise<void>;
}) {
  const record = snapshot.record;
  const [name, setName] = useState(
    record.kind === 'person' ? (record.name ?? '') : record.name
  );
  const [firstName, setFirstName] = useState(
    record.kind === 'person' ? (record.firstName ?? '') : ''
  );
  const [lastName, setLastName] = useState(
    record.kind === 'person' ? (record.lastName ?? '') : ''
  );
  const [lifecycle, setLifecycle] = useState(record.lifecycle);
  const [primaryAdvisor, setPrimaryAdvisor] = useState(
    record.primaryAdvisor ?? ''
  );
  const [details, setDetails] = useState<RecordKindsDetails>(snapshot.details);
  const [channels, setChannels] = useState<readonly ContactChannel[]>(
    record.channels
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = () => {
    setError('');
    setSaving(true);
    void onSave({
      ...(record.kind === 'person'
        ? { firstName, lastName, ...(name.trim() ? { name } : {}) }
        : { name }),
      lifecycle,
      primaryAdvisor,
      channels,
      details,
    })
      .catch((caught: unknown) => {
        setError(
          caught instanceof RecordKindsIsolationError
            ? caught.message
            : 'The contact changes could not be saved.'
        );
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <form
      data-testid="record-kinds-editor"
      style={{ display: 'grid', gap: 16 }}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <EditorIdentity
        record={record}
        name={name}
        firstName={firstName}
        lastName={lastName}
        lifecycle={lifecycle}
        primaryAdvisor={primaryAdvisor}
        setName={setName}
        setFirstName={setFirstName}
        setLastName={setLastName}
        setLifecycle={setLifecycle}
        setPrimaryAdvisor={setPrimaryAdvisor}
      />
      <ProfileEditor details={details} setDetails={setDetails} />
      <ChannelEditor channels={channels} setChannels={setChannels} />
      <FactEditor details={details} setDetails={setDetails} />
      <AccountEditor details={details} setDetails={setDetails} />
      {error ? <p role="alert">{error}</p> : null}
      <Button
        type="submit"
        loading={saving}
        data-testid="record-kinds-edit-save"
      >
        Save contact
      </Button>
    </form>
  );
}

function EditorIdentity({
  record,
  name,
  firstName,
  lastName,
  lifecycle,
  primaryAdvisor,
  setName,
  setFirstName,
  setLastName,
  setLifecycle,
  setPrimaryAdvisor,
}: {
  record: ContactRecord;
  name: string;
  firstName: string;
  lastName: string;
  lifecycle: string;
  primaryAdvisor: string;
  setName: (value: string) => void;
  setFirstName: (value: string) => void;
  setLastName: (value: string) => void;
  setLifecycle: (value: string) => void;
  setPrimaryAdvisor: (value: string) => void;
}) {
  return (
    <fieldset style={{ display: 'grid', gap: 10 }}>
      <legend>Basic profile</legend>
      {record.kind === 'person' ? (
        <>
          <label>
            First name
            <input
              value={firstName}
              onChange={(event) => {
                setFirstName(event.target.value);
              }}
            />
          </label>
          <label>
            Last name
            <input
              value={lastName}
              onChange={(event) => {
                setLastName(event.target.value);
              }}
            />
          </label>
        </>
      ) : (
        <label>
          Household name
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
      )}
      <label>
        Lifecycle
        <input
          value={lifecycle}
          onChange={(event) => {
            setLifecycle(event.target.value);
          }}
        />
      </label>
      <label>
        Primary advisor
        <input
          value={primaryAdvisor}
          onChange={(event) => {
            setPrimaryAdvisor(event.target.value);
          }}
        />
      </label>
    </fieldset>
  );
}

function ProfileEditor({
  details,
  setDetails,
}: {
  details: RecordKindsDetails;
  setDetails: (value: RecordKindsDetails) => void;
}) {
  const setProfile = (
    field: keyof RecordKindsDetails['profile'],
    value: string
  ) => {
    setDetails({
      ...details,
      profile: { ...details.profile, [field]: value },
    });
  };
  return (
    <fieldset style={{ display: 'grid', gap: 10 }}>
      <legend>Contact details & background</legend>
      <label>
        Address
        <input
          value={details.profile.address}
          onChange={(event) => {
            setProfile('address', event.target.value);
          }}
        />
      </label>
      <label>
        Preferred contact
        <input
          value={details.profile.preferredContact}
          onChange={(event) => {
            setProfile('preferredContact', event.target.value);
          }}
        />
      </label>
      <label>
        Service tier
        <input
          value={details.profile.serviceTier}
          onChange={(event) => {
            setProfile('serviceTier', event.target.value);
          }}
        />
      </label>
      <label>
        Background
        <textarea
          value={details.profile.background}
          onChange={(event) => {
            setProfile('background', event.target.value);
          }}
        />
      </label>
    </fieldset>
  );
}

function ChannelEditor({
  channels,
  setChannels,
}: {
  channels: readonly ContactChannel[];
  setChannels: (value: readonly ContactChannel[]) => void;
}) {
  const update = (id: string, patch: Partial<ContactChannel>) => {
    setChannels(
      channels.map((channel) => {
        if (channel.id !== id) {
          if (
            patch.primary === true &&
            channel.kind.split(':')[0] ===
              (
                patch.kind ?? channels.find((item) => item.id === id)?.kind
              )?.split(':')[0]
          ) {
            return { ...channel, primary: false };
          }
          return channel;
        }
        return { ...channel, ...patch };
      })
    );
  };
  return (
    <fieldset style={{ display: 'grid', gap: 10 }}>
      <legend>Email and phone</legend>
      {channels.map((channel) => (
        <div
          key={channel.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '130px 1fr auto auto',
            gap: 8,
          }}
        >
          <select
            aria-label="Contact method type"
            value={channel.kind}
            onChange={(event) => {
              update(channel.id, { kind: event.target.value });
            }}
          >
            <option value="email:work">Work email</option>
            <option value="email:personal">Personal email</option>
            <option value="phone:mobile">Mobile phone</option>
            <option value="phone:home">Home phone</option>
            <option value="phone:work">Work phone</option>
          </select>
          <input
            aria-label="Contact method value"
            value={channel.address}
            onChange={(event) => {
              update(channel.id, { address: event.target.value });
            }}
          />
          <label>
            <input
              type="checkbox"
              checked={channel.primary}
              onChange={(event) => {
                update(channel.id, { primary: event.target.checked });
              }}
            />{' '}
            Primary
          </label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setChannels(channels.filter((item) => item.id !== channel.id));
            }}
          >
            Remove
          </Button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="record-kinds-add-email"
          onClick={() => {
            setChannels([
              ...channels,
              {
                id: `channel:${crypto.randomUUID()}`,
                address: '',
                kind: 'email:work',
                primary: !channels.some((item) =>
                  item.kind.startsWith('email:')
                ),
              },
            ]);
          }}
        >
          Add email
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="record-kinds-add-phone"
          onClick={() => {
            setChannels([
              ...channels,
              {
                id: `channel:${crypto.randomUUID()}`,
                address: '',
                kind: 'phone:mobile',
                primary: !channels.some((item) =>
                  item.kind.startsWith('phone:')
                ),
              },
            ]);
          }}
        >
          Add phone
        </Button>
      </div>
    </fieldset>
  );
}

function FactEditor({
  details,
  setDetails,
}: {
  details: RecordKindsDetails;
  setDetails: (value: RecordKindsDetails) => void;
}) {
  const update = (
    id: string,
    patch: Partial<RecordKindsDetails['facts'][number]>
  ) => {
    setDetails({
      ...details,
      facts: details.facts.map((fact) =>
        fact.id === id ? { ...fact, ...patch } : fact
      ),
    });
  };
  return (
    <fieldset style={{ display: 'grid', gap: 10 }}>
      <legend>Facts</legend>
      {details.facts.map((fact) => (
        <div
          key={fact.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr auto',
            gap: 8,
          }}
        >
          <input
            aria-label="Fact label"
            value={fact.label}
            onChange={(event) => {
              update(fact.id, { label: event.target.value });
            }}
          />
          <input
            aria-label="Fact value"
            value={fact.value}
            onChange={(event) => {
              update(fact.id, { value: event.target.value });
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setDetails({
                ...details,
                facts: details.facts.filter((item) => item.id !== fact.id),
              });
            }}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        data-testid="record-kinds-add-fact"
        onClick={() => {
          setDetails({
            ...details,
            facts: [
              ...details.facts,
              { id: `fact:${crypto.randomUUID()}`, label: '', value: '' },
            ],
          });
        }}
      >
        Add fact
      </Button>
    </fieldset>
  );
}

function AccountEditor({
  details,
  setDetails,
}: {
  details: RecordKindsDetails;
  setDetails: (value: RecordKindsDetails) => void;
}) {
  const update = (
    id: string,
    patch: Partial<RecordKindsDetails['accounts'][number]>
  ) => {
    setDetails({
      ...details,
      accounts: details.accounts.map((account) =>
        account.id === id ? { ...account, ...patch } : account
      ),
    });
  };
  return (
    <fieldset style={{ display: 'grid', gap: 10 }}>
      <legend>Linked financial accounts</legend>
      {details.accounts.map((account) => (
        <div
          key={account.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 90px 1fr auto',
            gap: 8,
          }}
        >
          <input
            aria-label="Financial institution"
            value={account.institution}
            onChange={(event) => {
              update(account.id, { institution: event.target.value });
            }}
          />
          <input
            aria-label="Financial account type"
            value={account.accountType}
            onChange={(event) => {
              update(account.id, { accountType: event.target.value });
            }}
          />
          <input
            aria-label="Financial account last four"
            inputMode="numeric"
            maxLength={4}
            value={account.lastFour}
            onChange={(event) => {
              update(account.id, { lastFour: event.target.value });
            }}
          />
          <input
            aria-label="Financial account relationship"
            value={account.relationship}
            onChange={(event) => {
              update(account.id, { relationship: event.target.value });
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setDetails({
                ...details,
                accounts: details.accounts.filter(
                  (item) => item.id !== account.id
                ),
              });
            }}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        data-testid="record-kinds-add-account"
        onClick={() => {
          setDetails({
            ...details,
            accounts: [
              ...details.accounts,
              {
                id: `account:${crypto.randomUUID()}`,
                institution: '',
                accountType: '',
                lastFour: '',
                relationship: '',
              },
            ],
          });
        }}
      >
        Add account
      </Button>
    </fieldset>
  );
}
