import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type {
  CustomFieldAppliesTo,
  CustomFieldKind,
  FieldCatalog,
  FieldCatalogField,
} from './fieldCatalog';
import { validateFieldCatalog } from './fieldCatalog';

const FIELD_RECORD_KIND = 'customFieldDef';

type LegacyFieldKind =
  | 'text'
  | 'number'
  | 'money'
  | 'date'
  | 'bool'
  | 'enum'
  | 'multi-enum';

interface StoredFieldRecord extends LiveCrmRecord {
  kind: typeof FIELD_RECORD_KIND;
  createdAt: string;
  updatedAt: string;
  key: string;
  label: string;
  fieldType: LegacyFieldKind;
  appliesTo: readonly CustomFieldAppliesTo[];
  options?: readonly string[];
  archived: boolean;
  required: boolean;
  order: number;
}

export interface FieldCatalogPersistence {
  load(): Promise<FieldCatalog>;
  save(catalog: FieldCatalog): Promise<void>;
}

export interface LiveFieldCatalogStore {
  records: readonly LiveCrmRecord[];
  save(record: LiveCrmRecord): Promise<unknown>;
}

const TO_PUBLIC_KIND: Readonly<Record<LegacyFieldKind, CustomFieldKind>> = {
  text: 'text',
  number: 'number',
  money: 'money',
  date: 'date',
  bool: 'boolean',
  enum: 'select',
  'multi-enum': 'multi-select',
};

const TO_STORED_KIND: Readonly<Record<CustomFieldKind, LegacyFieldKind>> = {
  text: 'text',
  number: 'number',
  money: 'money',
  date: 'date',
  boolean: 'bool',
  select: 'enum',
  'multi-select': 'multi-enum',
};

function isLegacyFieldKind(value: unknown): value is LegacyFieldKind {
  return typeof value === 'string' && value in TO_PUBLIC_KIND;
}

function isStoredFieldRecord(record: LiveCrmRecord): record is StoredFieldRecord {
  return (
    record.kind === FIELD_RECORD_KIND &&
    typeof record.id === 'string' &&
    typeof record['createdAt'] === 'string' &&
    typeof record['updatedAt'] === 'string' &&
    typeof record['key'] === 'string' &&
    typeof record['label'] === 'string' &&
    isLegacyFieldKind(record['fieldType']) &&
    Array.isArray(record['appliesTo']) &&
    record['appliesTo'].every(
      (target) => target === 'household' || target === 'person'
    ) &&
    (record['options'] === undefined ||
      (Array.isArray(record['options']) &&
        record['options'].every((option) => typeof option === 'string'))) &&
    typeof record['archived'] === 'boolean' &&
    typeof record['required'] === 'boolean' &&
    typeof record['order'] === 'number'
  );
}

function toCatalogField(record: StoredFieldRecord): FieldCatalogField {
  const kind = TO_PUBLIC_KIND[record.fieldType];
  return {
    // `key` is the CRM's stable custom-value key. Expose it as the catalog id
    // so the advisor lane reads the same key already used by stored values.
    id: record.key,
    name: record.label,
    kind,
    ...(record.options?.length ? { options: record.options } : {}),
    appliesTo: record.appliesTo,
    retired: record.archived,
  };
}

function now(): string {
  return new Date().toISOString();
}

function newStoredField(field: FieldCatalogField, order: number): StoredFieldRecord {
  const timestamp = now();
  return {
    id: field.id,
    kind: FIELD_RECORD_KIND,
    matterId: 'firm_home',
    key: field.id,
    label: field.name,
    fieldType: TO_STORED_KIND[field.kind],
    ...(field.options?.length ? { options: [...field.options] } : {}),
    appliesTo: [...field.appliesTo],
    required: false,
    order,
    archived: field.retired,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function updatedStoredField(
  current: StoredFieldRecord | undefined,
  field: FieldCatalogField,
  order: number
): StoredFieldRecord {
  const replacement = newStoredField(field, order);
  if (!current) return replacement;
  // Keep the original stable value key and all opaque CRM metadata. A rename,
  // reorder, or retirement is definition-only and never rewrites value records.
  return {
    ...current,
    ...replacement,
    id: current.id,
    key: current.key,
    createdAt: current.createdAt,
  };
}

/**
 * Persistence adapter for the generic SQLCipher-backed CRM record store.
 * It writes definition records only. It never reads or writes a client's
 * `customFields` map, so definition changes cannot rewrite stored values.
 */
export function createLiveFieldCatalogPersistence(
  store: LiveFieldCatalogStore
): FieldCatalogPersistence {
  return {
    load() {
      const fields = store.records
        .filter(isStoredFieldRecord)
        .filter((record) => !record['deleted'])
        .sort((left, right) => left.order - right.order)
        .map(toCatalogField);
      const catalog = { fields };
      validateFieldCatalog(catalog);
      return Promise.resolve(catalog);
    },
    async save(catalog) {
      validateFieldCatalog(catalog);
      const existing = new Map(
        store.records
          .filter(isStoredFieldRecord)
          .map((record) => [record.key, record])
      );
      await Promise.all(
        catalog.fields.map((field, order) =>
          store.save(updatedStoredField(existing.get(field.id), field, order))
        )
      );
    },
  };
}
