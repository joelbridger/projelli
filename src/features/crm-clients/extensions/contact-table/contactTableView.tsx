import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '@/ui/kp';
import { isEnabled } from '@/platform/flags';
import { useFirmTagStore } from '@/features/crm-tags';
import {
  createDirectoryPreferenceStore,
  projectDirectoryResults,
  type DirectoryContext,
  type DirectoryResult,
} from '@/features/crm-clients';
import type { ContactDirectoryProjection } from '@/features/crm-contacts';

type ContactTableDensity = 'comfortable' | 'compact';
type ContactKind = 'all' | 'household' | 'person' | 'organization' | 'trust';
type LegacyDirectoryScope = 'households' | 'people' | null;

interface ContactTablePreference {
  density: ContactTableDensity;
}

type ContactRow = DirectoryResult;

function isContactTablePreference(
  value: unknown
): value is ContactTablePreference {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { density?: unknown }).density !== undefined &&
    ((value as { density: unknown }).density === 'comfortable' ||
      (value as { density: unknown }).density === 'compact')
  );
}

function personKind(person: Extract<ContactRow, { kind: 'person' }>['record']): Exclude<ContactKind, 'all' | 'household'> {
  return person.personType;
}

function rowKind(row: ContactRow): ContactKind {
  return row.kind === 'household' ? 'household' : personKind(row.record);
}

/** The four-kind contact projector feeds the existing mixed table once. */
function rowsFromContacts(contacts: readonly ContactDirectoryProjection[]): readonly ContactRow[] {
  return contacts.map((contact) => contact.kind === 'household'
    ? {
      kind: 'household' as const,
      record: {
        id: contact.id,
        name: contact.displayName,
        lifecycle: contact.lifecycle,
        primaryAdvisor: contact.primaryAdvisor ?? 'Unassigned',
        serviceTier: '—',
        peopleCount: 0,
        tagIds: contact.tagIds,
        ...(contact.lastActivityAt ? { lastActivityAt: contact.lastActivityAt } : {}),
      },
    }
    : {
      kind: 'person' as const,
      record: {
        id: contact.id,
        name: contact.displayName,
        personType: contact.kind,
        roles: [],
        relatedHouseholds: 0,
        tagIds: contact.tagIds,
        ...(contact.lastActivityAt ? { lastActivityAt: contact.lastActivityAt } : {}),
      },
    });
}

function ContactTableView({ context }: { context: DirectoryContext }) {
  const { t } = useTranslation();
  const tagStore = useFirmTagStore();
  const preferences = useMemo(
    () =>
      createDirectoryPreferenceStore<ContactTablePreference>(
        'crm-contact-table',
        isContactTablePreference
      ),
    []
  );
  const [density, setDensity] = useState<ContactTableDensity>(
    () => preferences.load()?.density ?? 'comfortable'
  );
  const [type, setType] = useState<ContactKind>('all');
  const [addingHousehold, setAddingHousehold] = useState(false);
  const [householdName, setHouseholdName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [submittingHousehold, setSubmittingHousehold] = useState(false);
  const [syncedLegacyTab, setSyncedLegacyTab] = useState(context.filters.tab);
  const [legacyScope, setLegacyScope] = useState<LegacyDirectoryScope>(null);
  const query = context.query.value.trim().toLowerCase();

  // The legacy toggle remains in the shared toolbar. Keep it meaningful while
  // preserving the mixed directory as this view's initial presentation.
  if (syncedLegacyTab !== context.filters.tab) {
    setSyncedLegacyTab(context.filters.tab);
    setLegacyScope(
      context.filters.tab === 'people' || context.filters.tab === 'households'
        ? context.filters.tab
        : null
    );
  }
  const tagNames = useMemo(
    () => new Map(tagStore.catalog.tags.map((tag) => [tag.id, tag.name])),
    [tagStore.catalog.tags]
  );
  const contactRefs = useMemo(
    () => new Map((context.contacts ?? []).map((contact) => [contact.id, contact.ref])),
    [context.contacts],
  );
  const rows = useMemo(
    () =>
      projectDirectoryResults(context.contacts ? rowsFromContacts(context.contacts) : [
        ...context.records.households
          .filter((household) => household.name.toLowerCase().includes(query))
          .map((record) => ({ kind: 'household' as const, record })),
        ...context.records.people
          .filter(
            (person) =>
              (!context.filters.externalOnly || person.external) &&
              (!context.filters.needsVerification || !person.verifiedAt) &&
              person.name.toLowerCase().includes(query)
          )
          .map((record) => ({ kind: 'person' as const, record })),
      ] satisfies readonly ContactRow[], context).filter((row) => {
        const matchesLegacyScope =
          legacyScope === null ||
          (legacyScope === 'households' && row.kind === 'household') ||
          (legacyScope === 'people' && row.kind === 'person');
        return matchesLegacyScope && (type === 'all' || rowKind(row) === type);
      }),
    [context, legacyScope, query, type]
  );
  const rowPadding = density === 'compact' ? '8px 12px' : '14px 12px';

  const changeDensity = () => {
    const nextDensity: ContactTableDensity =
      density === 'comfortable' ? 'compact' : 'comfortable';
    preferences.save({ density: nextDensity });
    setDensity(nextDensity);
  };

  const addHousehold = () => {
    const name = householdName.trim();
    if (!name || submittingHousehold) return;
    setAddError(null);
    setSubmittingHousehold(true);
    void Promise.resolve().then(() => context.repository.createHousehold(name)).then(() => {
      setHouseholdName('');
      setAddingHousehold(false);
    }).catch(() => {
      setAddError(t('contactTable.createFailed'));
    }).finally(() => {
      setSubmittingHousehold(false);
    });
  };

  return (
    <Card
      variant="raised"
      data-testid="crm-contact-table"
      data-density={density}
      style={{ marginTop: 12, overflowX: 'auto' }}
    >
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>{t('contactTable.title')}</h2>
          <p style={{ color: 'var(--color-slate-600)', margin: '4px 0 0' }}>
            {t('contactTable.description')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            size="sm"
            variant="secondary"
            data-testid="crm-contact-table-density"
            onClick={changeDensity}
          >
            {density === 'comfortable'
              ? t('contactTable.compact')
              : t('contactTable.comfortable')}
          </Button>
          <Button
            size="sm"
            data-testid="crm-contact-table-add-household"
            onClick={() => {
              setAddError(null);
              setAddingHousehold(true);
            }}
          >
            {t('contactTable.addHousehold')}
          </Button>
        </div>
      </div>
      {addingHousehold ? (
        <form
          data-testid="crm-contact-table-add-household-form"
          onSubmit={(event) => {
            event.preventDefault();
            addHousehold();
          }}
          style={{ display: 'flex', gap: 8, marginBottom: 12 }}
        >
          <input
            aria-label={t('contactTable.householdName')}
            data-testid="crm-contact-table-household-name"
            onChange={(event) => {
              setHouseholdName(event.target.value);
            }}
            placeholder={t('contactTable.householdName')}
            value={householdName}
          />
          <Button
            data-testid="crm-contact-table-household-save"
            disabled={submittingHousehold}
            type="submit"
          >
            {t('contactTable.createHousehold')}
          </Button>
          <Button
            onClick={() => {
              setAddingHousehold(false);
            }}
            type="button"
            variant="secondary"
          >
            {t('contactTable.cancel')}
          </Button>
          {addError ? <p role="alert">{addError}</p> : null}
        </form>
      ) : null}
      <label style={{ display: 'inline-grid', gap: 4, marginBottom: 12 }}>
        <span>{t('contactTable.type')}</span>
        <select
          aria-label={t('contactTable.type')}
          data-testid="crm-contact-table-type"
          onChange={(event) => {
            setType(event.target.value as ContactKind);
          }}
          value={type}
        >
          {(['all', 'household', 'person', 'organization', 'trust'] as const).map(
            (kind) => (
              <option key={kind} value={kind}>
                {t(`contactTable.types.${kind}`)}
              </option>
            )
          )}
        </select>
      </label>
      {rows.length === 0 ? (
        <div
          data-testid="crm-contact-table-empty"
          style={{
            color: 'var(--color-slate-600)',
            padding: '28px 12px',
            textAlign: 'center',
          }}
        >
          {t('contactTable.empty')}
        </div>
      ) : (
        <table
          style={{
            borderCollapse: 'collapse',
            minWidth: 800,
            textAlign: 'left',
            width: '100%',
          }}
        >
          <thead>
            <tr style={{ color: 'var(--color-slate-600)', fontSize: 13 }}>
              {(['name', 'type', 'status', 'tags', 'owner', 'lastActivity'] as const).map(
                (column) => (
                  <th key={column} scope="col" style={{ padding: '0 12px 8px' }}>
                    {t(`contactTable.columns.${column}`)}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const record = row.record;
              const tagIds = record.tagIds ?? [];
              const status = row.kind === 'household' ? row.record.lifecycle : '—';
              const owner = row.kind === 'household' ? row.record.primaryAdvisor : '—';
              return (
                <tr
                  key={`${row.kind}-${record.id}`}
                  data-testid={`crm-contact-table-${row.kind}-${record.id}`}
                  style={{ borderTop: '1px solid var(--kp-border)' }}
                >
                  <td style={{ padding: rowPadding }}>
                    <button
                      type="button"
                      data-testid={`crm-contact-table-open-${row.kind}-${record.id}`}
                      onClick={() => {
                        const ref = contactRefs.get(row.record.id);
                        if (ref && context.repository.openContact) {
                          void context.repository.openContact(ref);
                        } else if (row.kind === 'household') {
                          context.repository.openHousehold(row.record.id);
                        } else {
                          context.selection.setPerson(row.record);
                        }
                      }}
                      style={{
                        background: 'none',
                        border: 0,
                        color: 'var(--kp-assured)',
                        cursor: 'pointer',
                        font: 'inherit',
                        fontWeight: 600,
                        padding: 0,
                        textAlign: 'left',
                      }}
                    >
                      {record.name}
                    </button>
                  </td>
                  <td style={{ padding: rowPadding }}>
                    {t(`contactTable.types.${rowKind(row)}`)}
                  </td>
                  <td style={{ padding: rowPadding }}>
                    {status}
                  </td>
                  <td style={{ padding: rowPadding }}>
                    {tagIds.length
                      ? tagIds.map((id) => tagNames.get(id) ?? id).join(', ')
                      : '—'}
                  </td>
                  <td style={{ padding: rowPadding }}>
                    {owner}
                  </td>
                  <td style={{ padding: rowPadding }}>
                    {record.lastActivityAt ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** The outer gate must stay inert before the enabled table reads any context data or preference. */
export function ContactTableDirectoryView({
  context,
}: {
  context: DirectoryContext;
}) {
  if (!isEnabled('crm-contact-table')) return null;
  return <ContactTableView context={context} />;
}
