import type { RequestItem } from './types';
import type { RequestBlueprint } from './blueprintTypes';

export class BlueprintValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlueprintValidationError';
  }
}

function requireText(value: string, name: string): void {
  if (!value.trim()) throw new BlueprintValidationError(`${name} is required.`);
}

function copyFieldMap(item: Extract<RequestItem, { t: 'pdf_fill' }>) {
  return Object.fromEntries(
    Object.entries(item.field_map).map(([key, entry]) => [key, {
      field_id: entry.field_id,
      ...(entry.item_id ? { item_id: entry.item_id } : {}),
      ...(entry.fact_kind ? { fact_kind: entry.fact_kind } : {}),
      ...(entry.pdf_field_type ? { pdf_field_type: entry.pdf_field_type } : {}),
    }]),
  );
}

/**
 * Copy only structural request fields. This is intentionally not a generic
 * object spread so accidental values or lifecycle metadata cannot become part
 * of a persisted firm blueprint.
 */
export function copyBlueprintItem(item: RequestItem): RequestItem {
  const common = {
    item_id: item.item_id,
    label: item.label,
    help_text: item.help_text,
    required: item.required,
    subject: item.subject,
  };
  switch (item.t) {
    case 'typed_field':
      return {
        t: 'typed_field',
        ...common,
        fact_kind: item.fact_kind,
        input: item.input,
        ...(item.placeholder ? { placeholder: item.placeholder } : {}),
      };
    case 'doc_upload':
      return {
        t: 'doc_upload',
        ...common,
        ...(item.accepted_mime_types ? { accepted_mime_types: [...item.accepted_mime_types] } : {}),
        ...(item.max_files === undefined ? {} : { max_files: item.max_files }),
        ...(item.max_bytes === undefined ? {} : { max_bytes: item.max_bytes }),
        ...(item.expected_doc_types ? { expected_doc_types: [...item.expected_doc_types] } : {}),
        ...(item.expected_license_slots ? { expected_license_slots: [...item.expected_license_slots] } : {}),
      };
    case 'guided_question':
      return {
        t: 'guided_question',
        ...common,
        prompt: item.prompt,
        response_format: item.response_format,
        ...(item.choices ? { choices: item.choices.map((choice) => ({ ...choice })) } : {}),
        ...(item.fact_kind ? { fact_kind: item.fact_kind } : {}),
      };
    case 'readonly_card':
      return {
        t: 'readonly_card',
        ...common,
        body: item.body,
        ...(item.acknowledgement_required === undefined
          ? {}
          : { acknowledgement_required: item.acknowledgement_required }),
      };
    case 'pdf_fill':
      return {
        t: 'pdf_fill',
        ...common,
        pdf_ref: item.pdf_ref,
        field_map: copyFieldMap(item),
        // Values and fact references are never blueprint data. A fillable PDF
        // may be saved as a future-facing item, but its prefill stays empty.
        prefill: [],
      };
    case 'signature':
      return {
        t: 'signature',
        ...common,
        grade: item.grade,
        ...(item.document_ref ? { document_ref: item.document_ref } : {}),
      };
  }
}

export function assertValidRequestBlueprint(blueprint: RequestBlueprint): void {
  requireText(blueprint.blueprintId, 'Blueprint id');
  requireText(blueprint.label, 'Blueprint label');
  if (blueprint.schemaVersion < 1 || !Number.isInteger(blueprint.schemaVersion)) {
    throw new BlueprintValidationError('Blueprint schema version must be a positive integer.');
  }
  if (blueprint.defaultKind !== 'onboarding' && blueprint.defaultKind !== 'standing') {
    throw new BlueprintValidationError('Blueprint request kind is not supported.');
  }

  const itemIds = new Set<string>();
  for (const item of blueprint.items) {
    requireText(item.item_id, 'Item id');
    requireText(item.label, 'Item label');
    requireText(item.subject, 'Item subject');
    if (itemIds.has(item.item_id)) {
      throw new BlueprintValidationError(`Blueprint item id "${item.item_id}" is duplicated.`);
    }
    itemIds.add(item.item_id);
    if (item.t === 'guided_question' && item.response_format !== 'money' && item.response_format !== 'range') {
      throw new BlueprintValidationError(
        `Guided question "${item.label}" must use money or range responses.`,
      );
    }
    if (item.t === 'pdf_fill' && item.prefill.length > 0) {
      throw new BlueprintValidationError('Blueprint PDF items cannot contain prefilled client facts.');
    }
  }
}

/** Validate and return a structural-only deep copy suitable for persistence. */
export function copyRequestBlueprint(blueprint: RequestBlueprint): RequestBlueprint {
  assertValidRequestBlueprint(blueprint);
  return {
    blueprintId: blueprint.blueprintId,
    schemaVersion: blueprint.schemaVersion,
    label: blueprint.label,
    source: blueprint.source,
    defaultKind: blueprint.defaultKind,
    items: blueprint.items.map(copyBlueprintItem),
    ...(blueprint.archived ? { archived: true } : {}),
  };
}
