/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useMemo, useState } from 'react';
import { LayoutGrid, ListFilter, Plus, Save } from 'lucide-react';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { Button } from '@/ui/kp';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type {
  FilterClause,
  FilterOperator,
  SavedView,
  ViewQuery,
} from '@/platform/crm/types';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  applyViewQuery,
  defaultViewQuery,
  displayValue,
  VIEW_DEFINITIONS,
  type ViewEntity,
} from './viewQuery';

type Layout = 'list' | 'kanban' | 'table';
const panel = {
  border: '1px solid var(--kp-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)',
  padding: 'var(--kp-space-md)',
} as const;
const muted = {
  color: 'var(--kp-text-faint)',
  fontSize: 'var(--kp-font-sm)',
} as const;
const operations: readonly FilterOperator[] = [
  'contains',
  'eq',
  'neq',
  'in',
  'before',
  'after',
  'is_empty',
  'is_not_empty',
];

function validEntity(value: unknown): value is ViewEntity {
  return (
    value === 'tasks' || value === 'households' || value === 'opportunities'
  );
}
function entityFromQuery(query: ViewQuery): ViewEntity | null {
  return query.entity === 'task'
    ? 'tasks'
    : query.entity === 'household'
      ? 'households'
      : query.entity === 'opportunity'
        ? 'opportunities'
        : null;
}
function savedSurface(entity: ViewEntity): SavedView['surface'] {
  return entity === 'tasks'
    ? 'tasks'
    : entity === 'households'
      ? 'households'
      : 'opportunities';
}
function savedLayout(layout: Layout): SavedView['layout'] {
  return layout === 'kanban' ? 'kanban' : layout;
}

function ViewRows({
  rows,
  fields,
  layout,
  groupBy,
}: {
  rows: readonly LiveCrmRecord[];
  fields: readonly string[];
  layout: Layout;
  groupBy?: string;
}) {
  if (!rows.length)
    return (
      <section data-testid="crm-views-empty" style={panel}>
        <strong>Nothing matches this view yet.</strong>
        <p style={muted}>
          Try removing a filter, or choose a different saved view.
        </p>
      </section>
    );
  if (layout === 'table')
    return (
      <div
        data-testid="crm-views-table"
        style={{ overflowX: 'auto', ...panel, padding: 0 }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {fields.map((field) => (
                <th
                  key={field}
                  style={{
                    textAlign: 'left',
                    padding: 10,
                    borderBottom: '1px solid var(--kp-border)',
                  }}
                >
                  {field}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((record) => (
              <tr key={record.id} data-testid={`crm-view-row-${record.id}`}>
                {fields.map((field) => (
                  <td
                    key={field}
                    style={{
                      padding: 10,
                      borderBottom: '1px solid var(--kp-border)',
                    }}
                  >
                    {displayValue(record, field)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if (layout === 'kanban') {
    const groups = new Map<string, LiveCrmRecord[]>();
    for (const row of rows) {
      const label = displayValue(row, groupBy ?? 'status');
      groups.set(label, [...(groups.get(label) ?? []), row]);
    }
    return (
      <div
        data-testid="crm-views-board"
        style={{
          display: 'grid',
          gridAutoFlow: 'column',
          gridAutoColumns: 'minmax(230px, 1fr)',
          gap: 10,
          overflowX: 'auto',
        }}
      >
        {[...groups].map(([label, group]) => (
          <section key={label} style={{ ...panel, minHeight: 150 }}>
            <strong>{label}</strong>
            <span style={muted}> · {group.length}</span>
            <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              {group.map((record) => (
                <article
                  key={record.id}
                  data-testid={`crm-view-card-${record.id}`}
                  style={{
                    border: '1px solid var(--kp-border)',
                    borderRadius: 8,
                    padding: 9,
                    background: 'white',
                  }}
                >
                  <strong>{displayValue(record, fields[0] ?? 'name')}</strong>
                  {fields.slice(1).map((field) => (
                    <div key={field} style={muted}>
                      {field}: {displayValue(record, field)}
                    </div>
                  ))}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }
  return (
    <div data-testid="crm-views-list" style={{ display: 'grid', gap: 8 }}>
      {rows.map((record) => (
        <article
          key={record.id}
          data-testid={`crm-view-card-${record.id}`}
          style={panel}
        >
          <strong>{displayValue(record, fields[0] ?? 'name')}</strong>
          <div
            style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 5 }}
          >
            {fields.slice(1).map((field) => (
              <span key={field} style={muted}>
                {field}: {displayValue(record, field)}
              </span>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

export function CrmViewsSurface() {
  const live = useLiveCrmRecords();
  const [entity, setEntity] = useState<ViewEntity>('tasks');
  const [query, setQuery] = useState<ViewQuery>(() =>
    defaultViewQuery('tasks')
  );
  const [layout, setLayout] = useState<Layout>('list');
  const [name, setName] = useState('');
  const [visibility, setVisibility] =
    useState<SavedView['visibility']>('personal');
  const [message, setMessage] = useState<string | null>(null);
  const definition = VIEW_DEFINITIONS[entity];
  const fields = query.fields?.length
    ? query.fields
    : definition.fields.slice(0, 4).map((field) => field.key);
  const rows = useMemo(
    () =>
      applyViewQuery(
        live.records.filter((record) => record.kind === definition.recordKind),
        query
      ),
    [definition.recordKind, live.records, query]
  );
  const savedViews = live.records.filter(
    (record): record is LiveCrmRecord & Partial<SavedView> =>
      record.kind === 'savedView' && record['surface'] === savedSurface(entity)
  );
  const selectEntity = (next: ViewEntity) => {
    setEntity(next);
    setQuery(defaultViewQuery(next));
    setLayout('list');
    setMessage(null);
  };
  const updateFilter = (index: number, patch: Partial<FilterClause>) =>
    setQuery((current) => ({
      ...current,
      filters: current.filters.map((filter, position) =>
        position === index ? { ...filter, ...patch } : filter
      ),
    }));
  const toggleField = (field: string) =>
    setQuery((current) => ({
      ...current,
      fields: (current.fields ?? []).includes(field)
        ? (current.fields ?? []).filter((item) => item !== field)
        : [...(current.fields ?? []), field],
    }));
  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage('Give this view a name before saving it.');
      return;
    }
    const record: LiveCrmRecord = {
      id: `saved-view:${crypto.randomUUID()}`,
      kind: 'savedView',
      matterId: live.sharedMatterId ?? 'firm_home',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      name: trimmed,
      surface: savedSurface(entity),
      visibility,
      query,
      layout: savedLayout(layout),
    };
    await live.save(record);
    setName('');
    setMessage(
      visibility === 'firm'
        ? 'Saved for everyone at the firm.'
        : 'Saved just for you.'
    );
  };
  const open = (view: LiveCrmRecord & Partial<SavedView>) => {
    const nextEntity =
      view.query && typeof view.query === 'object'
        ? entityFromQuery(view.query as ViewQuery)
        : null;
    if (!nextEntity || nextEntity !== entity) return;
    const next = view.query as ViewQuery;
    setQuery({
      ...defaultViewQuery(entity),
      ...next,
      filters: Array.isArray(next.filters) ? next.filters : [],
    });
    setLayout(
      view.layout === 'kanban' ||
        view.layout === 'table' ||
        view.layout === 'list'
        ? view.layout
        : 'list'
    );
    setMessage(
      `Showing “${typeof view.name === 'string' ? view.name : 'Saved view'}”.`
    );
  };
  return (
    <main
      data-testid="crm-views-surface"
      style={{
        flex: 1,
        overflow: 'auto',
        padding: 'var(--kp-space-lg)',
        display: 'grid',
        alignContent: 'start',
        gap: 'var(--kp-space-md)',
      }}
    >
      <SurfaceHeader
        Icon={ListFilter}
        title="Saved views"
        description="Build the short lists your firm uses every day, then save them."
      />
      {live.error ? (
        <section role="alert" style={panel}>
          Could not load saved views: {live.error}
        </section>
      ) : null}
      <section data-testid="crm-views-builder" style={panel}>
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'end',
          }}
        >
          <label>
            What are you looking at?
            <select
              data-testid="crm-views-entity"
              value={entity}
              onChange={(event) => {
                if (validEntity(event.target.value))
                  selectEntity(event.target.value);
              }}
            >
              <option value="tasks">Tasks</option>
              <option value="households">Households</option>
              <option value="opportunities">Opportunities</option>
            </select>
          </label>
          <label>
            Show it as
            <select
              data-testid="crm-views-layout"
              value={layout}
              onChange={(event) => {
                setLayout(event.target.value as Layout);
              }}
            >
              <option value="list">List</option>
              <option value="kanban">Board</option>
              <option value="table">Table</option>
            </select>
          </label>
          <label>
            Sort by
            <select
              data-testid="crm-views-sort-field"
              value={query.sort?.[0]?.field ?? definition.fields[0]!.key}
              onChange={(event) => {
                setQuery((current) => ({
                  ...current,
                  sort: [
                    {
                      field: event.target.value,
                      dir: current.sort?.[0]?.dir ?? 'asc',
                    },
                  ],
                }));
              }}
            >
              {definition.fields.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Order
            <select
              data-testid="crm-views-sort-direction"
              value={query.sort?.[0]?.dir ?? 'asc'}
              onChange={(event) => {
                setQuery((current) => ({
                  ...current,
                  sort: [
                    {
                      field:
                        current.sort?.[0]?.field ?? definition.fields[0]!.key,
                      dir: event.target.value as 'asc' | 'desc',
                    },
                  ],
                }));
              }}
            >
              <option value="asc">A to Z</option>
              <option value="desc">Z to A</option>
            </select>
          </label>
          <label>
            Board columns
            <select
              data-testid="crm-views-group-by"
              value={query.groupBy ?? ''}
              onChange={(event) => {
                setQuery((current) => {
                  const { groupBy: _previousGroup, ...withoutGroup } = current;
                  return event.target.value
                    ? { ...withoutGroup, groupBy: event.target.value }
                    : withoutGroup;
                });
              }}
            >
              <option value="">No grouping</option>
              {definition.fields.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
          <legend style={{ fontWeight: 600 }}>Details to show</legend>
          <div
            style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 5 }}
          >
            {definition.fields.map((field) => (
              <label key={field.key}>
                <input
                  data-testid={`crm-views-field-${field.key}`}
                  type="checkbox"
                  checked={fields.includes(field.key)}
                  onChange={() => {
                    toggleField(field.key);
                  }}
                />{' '}
                {field.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <strong>Filters</strong>
            <Button
              size="sm"
              variant="secondary"
              iconLeft={Plus}
              data-testid="crm-views-add-filter"
              onClick={() => {
                setQuery((current) => ({
                  ...current,
                  filters: [
                    ...current.filters,
                    {
                      field: definition.fields[0]!.key,
                      op: 'contains',
                      value: '',
                    },
                  ],
                }));
              }}
            >
              Add filter
            </Button>
          </div>
          {query.filters.length === 0 ? (
            <p style={muted}>No filters. This view includes every {entity}.</p>
          ) : (
            query.filters.map((filter, index) => (
              <div
                key={`${filter.field}-${index}`}
                data-testid={`crm-views-filter-${index}`}
                style={{
                  display: 'flex',
                  gap: 6,
                  marginTop: 8,
                  flexWrap: 'wrap',
                }}
              >
                <select
                  data-testid={`crm-views-filter-field-${index}`}
                  value={filter.field}
                  onChange={(event) => {
                    updateFilter(index, { field: event.target.value });
                  }}
                >
                  {definition.fields.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.label}
                    </option>
                  ))}
                </select>
                <select
                  data-testid={`crm-views-filter-op-${index}`}
                  value={filter.op}
                  onChange={(event) => {
                    updateFilter(index, {
                      op: event.target.value as FilterOperator,
                    });
                  }}
                >
                  {operations.map((operation) => (
                    <option key={operation} value={operation}>
                      {operation.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
                {filter.op !== 'is_empty' && filter.op !== 'is_not_empty' ? (
                  <input
                    data-testid={`crm-views-filter-value-${index}`}
                    value={String(filter.value ?? '')}
                    onChange={(event) => {
                      updateFilter(index, { value: event.target.value });
                    }}
                    placeholder="Value"
                  />
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid={`crm-views-filter-remove-${index}`}
                  onClick={() => {
                    setQuery((current) => ({
                      ...current,
                      filters: current.filters.filter(
                        (_, position) => position !== index
                      ),
                    }));
                  }}
                >
                  Remove
                </Button>
              </div>
            ))
          )}
        </div>
      </section>
      <section data-testid="crm-views-save" style={panel}>
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'end',
          }}
        >
          <label style={{ flex: 1, minWidth: 180 }}>
            Save this view as
            <input
              data-testid="crm-views-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="For example, Reviews due this month"
            />
          </label>
          <label>
            Who can use it?
            <select
              data-testid="crm-views-visibility"
              value={visibility}
              onChange={(event) => {
                setVisibility(event.target.value as SavedView['visibility']);
              }}
            >
              <option value="personal">Just me</option>
              <option value="firm">Everyone at the firm</option>
            </select>
          </label>
          <Button
            data-testid="crm-views-save-button"
            iconLeft={Save}
            onClick={() => {
              void save();
            }}
          >
            Save view
          </Button>
        </div>
        {message ? (
          <p data-testid="crm-views-message" role="status">
            {message}
          </p>
        ) : null}
      </section>
      {savedViews.length ? (
        <section data-testid="crm-views-saved" style={panel}>
          <strong>Saved {entity}</strong>
          <div
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}
          >
            {savedViews.map((view) => (
              <Button
                key={view.id}
                size="sm"
                variant="secondary"
                data-testid={`crm-views-open-${view.id}`}
                onClick={() => {
                  open(view);
                }}
              >
                {typeof view.name === 'string' ? view.name : 'Saved view'} ·{' '}
                {view.visibility === 'firm' ? 'Firm' : 'Personal'}
              </Button>
            ))}
          </div>
        </section>
      ) : (
        <section data-testid="crm-views-saved-empty" style={panel}>
          <strong>No saved {entity} yet.</strong>
          <p style={muted}>Make a useful list, then save it here.</p>
        </section>
      )}
      <section aria-label="View results">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <LayoutGrid size={18} aria-hidden="true" />
          <strong>
            {rows.length} {rows.length === 1 ? definition.singular : entity}
          </strong>
        </div>
        <div style={{ marginTop: 8 }}>
          <ViewRows
            rows={rows}
            fields={fields}
            layout={layout}
            {...(query.groupBy ? { groupBy: query.groupBy } : {})}
          />
        </div>
      </section>
    </main>
  );
}
