import type { FilterClause, ViewQuery } from '@/platform/crm/types';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

export type ViewEntity = 'tasks' | 'households' | 'opportunities';

export interface ViewField {
  key: string;
  label: string;
}

export interface ViewDefinition {
  entity: ViewEntity;
  recordKind: string;
  singular: string;
  fields: readonly ViewField[];
  defaultGroup: string;
}

export const VIEW_DEFINITIONS: Record<ViewEntity, ViewDefinition> = {
  tasks: {
    entity: 'tasks',
    recordKind: 'task',
    singular: 'task',
    defaultGroup: 'status',
    fields: [
      { key: 'title', label: 'Task' },
      { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' },
      { key: 'due', label: 'Due date' },
      { key: 'assigneeUserId', label: 'Assigned to' },
      { key: 'householdId', label: 'Household' },
    ],
  },
  households: {
    entity: 'households',
    recordKind: 'household',
    singular: 'household',
    defaultGroup: 'serviceTier',
    fields: [
      { key: 'name', label: 'Household' },
      { key: 'lifecycle', label: 'Status' },
      { key: 'serviceTier', label: 'Service tier' },
      { key: 'primaryAdvisor', label: 'Lead advisor' },
      { key: 'nextReview', label: 'Next review' },
      { key: 'ownership', label: 'Ownership' },
    ],
  },
  opportunities: {
    entity: 'opportunities',
    recordKind: 'opportunity',
    singular: 'opportunity',
    defaultGroup: 'stageId',
    fields: [
      { key: 'name', label: 'Opportunity' },
      { key: 'status', label: 'Status' },
      { key: 'stageId', label: 'Stage' },
      { key: 'householdId', label: 'Household' },
      { key: 'amount', label: 'Estimated AUM' },
      { key: 'expectedCloseDate', label: 'Expected close' },
      { key: 'ownerId', label: 'Owner' },
    ],
  },
};

export function defaultViewQuery(entity: ViewEntity): ViewQuery {
  const definition = VIEW_DEFINITIONS[entity];
  return {
    entity: entity.slice(0, -1) as ViewQuery['entity'],
    filters: [],
    fields: definition.fields.slice(0, 4).map((field) => field.key),
    sort: [{ field: definition.fields[0]!.key, dir: 'asc' }],
    groupBy: definition.defaultGroup,
  };
}

function comparable(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('value' in value && typeof value.value === 'number')
      return String(value.value);
    return JSON.stringify(value);
  }
  return String(value);
}

function matches(record: LiveCrmRecord, filter: FilterClause): boolean {
  const value = record[filter.field];
  const actual = comparable(value).toLocaleLowerCase();
  const expected = Array.isArray(filter.value)
    ? filter.value.map((item) => String(item).toLocaleLowerCase())
    : comparable(filter.value).toLocaleLowerCase();
  switch (filter.op) {
    case 'eq':
      return Array.isArray(expected)
        ? expected.includes(actual)
        : actual === expected;
    case 'neq':
      return Array.isArray(expected)
        ? !expected.includes(actual)
        : actual !== expected;
    case 'contains':
      return !Array.isArray(expected) && actual.includes(expected);
    case 'in':
      return Array.isArray(expected)
        ? expected.includes(actual)
        : actual === expected;
    case 'before':
      return !Array.isArray(expected) && actual !== '' && actual < expected;
    case 'after':
      return !Array.isArray(expected) && actual !== '' && actual > expected;
    case 'is_empty':
      return actual === '';
    case 'is_not_empty':
      return actual !== '';
  }
}

/** Runs the deliberately bounded view language in memory. It never accepts code or SQL. */
export function applyViewQuery(
  records: readonly LiveCrmRecord[],
  query: ViewQuery
): LiveCrmRecord[] {
  const result = records.filter((record) =>
    query.filters.every((filter) => matches(record, filter))
  );
  const sort = query.sort ?? [];
  return [...result].sort((left, right) => {
    for (const rule of sort) {
      const comparison = comparable(left[rule.field]).localeCompare(
        comparable(right[rule.field]),
        undefined,
        { numeric: true }
      );
      if (comparison) return rule.dir === 'asc' ? comparison : -comparison;
    }
    return 0;
  });
}

export function displayValue(record: LiveCrmRecord, field: string): string {
  const value = record[field];
  if (value === undefined || value === null || value === '')
    return 'Not recorded';
  if (
    field === 'amount' &&
    typeof value === 'object' &&
    value &&
    'value' in value &&
    typeof value.value === 'number'
  ) {
    const money = value as { value: number; currency?: unknown };
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: typeof money.currency === 'string' ? money.currency : 'USD',
      maximumFractionDigits: 0,
    }).format(money.value);
  }
  return comparable(value);
}
