import type { RequestItem } from './types';
import type { RequestBlueprint } from './blueprintTypes';
import { assertValidPdfTemplateDescriptor } from './pdfTemplates/templateValidation';

export class BlueprintValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlueprintValidationError';
  }
}

function requireText(value: string, name: string): void {
  if (!value.trim()) throw new BlueprintValidationError(`${name} is required.`);
}

function copyPdfTemplate(item: Extract<RequestItem, { t: 'pdf_fill' }>) {
  assertValidPdfTemplateDescriptor(item.template);
  return {
    templateId: item.template.templateId,
    version: item.template.version,
    kind: item.template.kind,
    sourceSha256: item.template.sourceSha256,
    sourceArtifactRef: item.template.sourceArtifactRef,
    outputFileStem: item.template.outputFileStem,
    maxOutputBytes: item.template.maxOutputBytes,
    fields: Object.fromEntries(Object.entries(item.template.fields).map(([fieldId, field]) => [
      fieldId,
      field.kind === 'acroform'
        ? {
            kind: 'acroform' as const,
            field_id: field.field_id,
            pdf_field_type: field.pdf_field_type,
            acroform_field: field.acroform_field,
            ...(field.fact_kind === undefined ? {} : { fact_kind: field.fact_kind }),
            ...(field.required === undefined ? {} : { required: field.required }),
            ...('options' in field ? { options: field.options.map((option) => ({ ...option })) } : {}),
          }
        : {
            kind: 'overlay' as const,
            field_id: field.field_id,
            pdf_field_type: field.pdf_field_type,
            page: field.page,
            rect: { ...field.rect },
            font: { ...field.font },
            alignment: field.alignment,
            overflow: field.overflow,
            ...(field.fact_kind === undefined ? {} : { fact_kind: field.fact_kind }),
            ...(field.required === undefined ? {} : { required: field.required }),
            ...('options' in field ? { options: field.options.map((option) => ({ ...option })) } : {}),
          },
    ])),
  } as Extract<RequestItem, { t: 'pdf_fill' }>['template'];
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
        template: copyPdfTemplate(item),
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
  // Defensive at runtime even though the type is exhaustive: blueprints can
  // arrive from persisted JSON that was never actually type-checked.
  const defaultKind = blueprint.defaultKind as string;
  if (defaultKind !== 'onboarding' && defaultKind !== 'standing') {
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
    if (item.t === 'pdf_fill') {
      try {
        assertValidPdfTemplateDescriptor(item.template);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown template validation error.';
        throw new BlueprintValidationError(`Blueprint PDF template is not approved: ${message}`);
      }
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
