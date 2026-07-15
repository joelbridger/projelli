/**
 * The small public custom-field catalog consumed by advisor-side editing.
 *
 * Values must be stored by `id`, never by the display `name`. A firm may
 * rename or retire a definition without changing an already-saved value.
 * This is deliberately the full public shape: storage metadata, timestamps,
 * and CRM-record bookkeeping are private to this feature's persistence layer.
 */
export type CustomFieldKind =
  | 'text'
  | 'number'
  | 'money'
  | 'date'
  | 'boolean'
  | 'select'
  | 'multi-select';

/** `person` includes people, companies, and trusts in the CRM model. */
export type CustomFieldAppliesTo = 'household' | 'person';

export interface FieldCatalogField {
  id: string;
  name: string;
  kind: CustomFieldKind;
  options?: readonly string[];
  appliesTo: readonly CustomFieldAppliesTo[];
  retired: boolean;
}

export interface FieldCatalog {
  fields: readonly FieldCatalogField[];
}

export type FieldCatalogDraft = Omit<FieldCatalogField, 'id' | 'retired'>;

const KINDS = new Set<CustomFieldKind>([
  'text',
  'number',
  'money',
  'date',
  'boolean',
  'select',
  'multi-select',
]);
const APPLIES_TO = new Set<CustomFieldAppliesTo>(['household', 'person']);

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function normalizedOptions(options: readonly string[] | undefined) {
  return options?.map((option) => option.trim()).filter(Boolean) ?? [];
}

/** Throws before an invalid definition can enter the firm catalog. */
export function validateFieldCatalogField(field: FieldCatalogField): void {
  if (!field.id.trim()) throw new Error('A custom field needs an id.');
  if (!field.name.trim()) throw new Error('A custom field needs a name.');
  if (!KINDS.has(field.kind)) throw new Error('Choose a supported field kind.');
  if (field.appliesTo.length === 0)
    throw new Error('Choose at least one record type.');
  if (
    !field.appliesTo.every((target) => APPLIES_TO.has(target)) ||
    !unique(field.appliesTo)
  ) {
    throw new Error('Choose each supported record type only once.');
  }
  const options = normalizedOptions(field.options);
  const needsOptions = field.kind === 'select' || field.kind === 'multi-select';
  if (needsOptions && options.length === 0)
    throw new Error('Choice fields need at least one option.');
  if (!needsOptions && options.length > 0)
    throw new Error('Only choice fields can have options.');
  if (!unique(options)) throw new Error('Each option must be different.');
}

/** Throws when a persisted catalog is malformed or has duplicate ids. */
export function validateFieldCatalog(catalog: FieldCatalog): void {
  const ids = catalog.fields.map((field) => field.id);
  if (!unique(ids)) throw new Error('Custom field ids must be unique.');
  catalog.fields.forEach(validateFieldCatalogField);
}

export function defineField(
  catalog: FieldCatalog,
  id: string,
  draft: FieldCatalogDraft
): FieldCatalog {
  if (catalog.fields.some((field) => field.id === id))
    throw new Error('A custom field already has that id.');
  const field: FieldCatalogField = {
    id,
    name: draft.name.trim(),
    kind: draft.kind,
    ...(draft.options ? { options: normalizedOptions(draft.options) } : {}),
    appliesTo: [...draft.appliesTo],
    retired: false,
  };
  validateFieldCatalogField(field);
  return { fields: [...catalog.fields, field] };
}

/** Changes only the display name; the stable value key (`id`) cannot move. */
export function renameField(
  catalog: FieldCatalog,
  id: string,
  name: string
): FieldCatalog {
  const next = catalog.fields.map((field) =>
    field.id === id ? { ...field, name: name.trim() } : field
  );
  if (next.every((field) => field.id !== id))
    throw new Error('Custom field not found.');
  const result = { fields: next };
  validateFieldCatalog(result);
  return result;
}

export function reorderFields(
  catalog: FieldCatalog,
  orderedIds: readonly string[]
): FieldCatalog {
  if (
    orderedIds.length !== catalog.fields.length ||
    !unique(orderedIds) ||
    orderedIds.some((id) => !catalog.fields.some((field) => field.id === id))
  ) {
    throw new Error('The new order must include every custom field once.');
  }
  const byId = new Map(catalog.fields.map((field) => [field.id, field]));
  const fields: FieldCatalogField[] = [];
  for (const id of orderedIds) {
    const field = byId.get(id);
    if (!field) throw new Error('Custom field not found.');
    fields.push(field);
  }
  return { fields };
}

/** Retiring hides a field from new entry; it never changes saved values. */
export function retireField(catalog: FieldCatalog, id: string): FieldCatalog {
  const next = catalog.fields.map((field) =>
    field.id === id ? { ...field, retired: true } : field
  );
  if (next.every((field) => field.id !== id))
    throw new Error('Custom field not found.');
  return { fields: next };
}
