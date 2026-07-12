import {
  WEALTHBOX_PAGE_CAP,
  type WealthboxAskSource,
  type WealthboxCustomFieldDefinition,
  type WealthboxCustomFieldIngestion,
  type WealthboxCustomFieldRecord,
  type WealthboxCustomFieldRegistry,
  type WealthboxCustomFieldValue,
  type WealthboxDepthTransport,
  type WealthboxDocumentType,
} from './types';

function customFieldsPath(documentType: WealthboxDocumentType, page: number): string {
  return `/categories/custom_fields?document_type=${encodeURIComponent(documentType)}&page=${String(page)}&per_page=${String(WEALTHBOX_PAGE_CAP)}`;
}

/**
 * Reads the documented custom-field registry page by page.  The live service
 * silently caps a larger requested page size at 100, so keeping this explicit
 * avoids both missing fields and a misleading "complete" import.
 */
export async function fetchCustomFieldRegistry(
  transport: WealthboxDepthTransport,
  documentType: WealthboxDocumentType,
): Promise<WealthboxCustomFieldRegistry> {
  const definitions: WealthboxCustomFieldDefinition[] = [];
  const seenIds = new Set<number>();
  let page = 1;

  for (;;) {
    const response = await transport.getJson<{
      meta?: { page?: number; total_pages?: number };
      custom_fields?: WealthboxCustomFieldDefinition[];
    }>(customFieldsPath(documentType, page));
    for (const definition of response.custom_fields ?? []) {
      if (!seenIds.has(definition.id)) {
        definitions.push(definition);
        seenIds.add(definition.id);
      }
    }

    const totalPages = response.meta?.total_pages ?? page;
    if (page >= totalPages) break;
    page += 1;
  }

  return { definitions, pagesRead: page };
}

function valueAsText(value: WealthboxCustomFieldValue['value']): string | null {
  if (value === null) return null;
  if (Array.isArray(value)) return value.join(', ');
  return String(value).trim() || null;
}

function sourceId(recordId: string, fieldId: number): string {
  return `crm:wealthbox:custom-field:${recordId}:${String(fieldId)}`;
}

function fieldLabel(field: WealthboxCustomFieldValue, registry: Map<number, WealthboxCustomFieldDefinition>): string {
  return registry.get(field.id)?.name.trim() || field.name.trim() || `Field ${String(field.id)}`;
}

/**
 * Converts the inline custom-field objects returned with a CRM record into
 * small, citable Ask sources. Values remain tied to their source record and
 * are never inferred from a matching label alone.
 */
export function buildCustomFieldAskSources(
  records: readonly WealthboxCustomFieldRecord[],
  registry: readonly WealthboxCustomFieldDefinition[],
): WealthboxCustomFieldIngestion {
  const definitions = new Map(registry.map((definition) => [definition.id, definition]));
  const warnings: string[] = [];
  const sources: WealthboxAskSource[] = [];

  for (const record of records) {
    const recordId = String(record.id);
    for (const field of record.custom_fields ?? []) {
      const value = valueAsText(field.value);
      if (value === null) continue;

      const definition = definitions.get(field.id);
      if (!definition) {
        warnings.push(`Wealthbox field ${String(field.id)} on record ${recordId} is not present in the imported registry.`);
      }
      const label = fieldLabel(field, definitions);
      const documentType = definition?.document_type ?? field.document_type;
      const fieldType = definition?.field_type ?? field.field_type;
      sources.push({
        sourceId: sourceId(recordId, field.id),
        recordId,
        text: `Wealthbox custom field — ${label}: ${value}`,
        fieldId: field.id,
        fieldName: label,
        documentType,
        fieldType,
      });
    }
  }

  return { sources, warnings };
}

/**
 * The connector-level operation used by an Ask-index bridge. Definitions come
 * from Wealthbox's registry, while values come from the records already read
 * during the normal CRM import. Keeping those two reads separate preserves the
 * record citation and lets us report a registry/value mismatch instead of
 * silently dropping a value an advisor may rely on.
 */
export async function ingestCustomFieldsForAsk(args: {
  transport: WealthboxDepthTransport;
  documentType: WealthboxDocumentType;
  records: readonly WealthboxCustomFieldRecord[];
  ingest: (sources: readonly WealthboxAskSource[]) => Promise<void>;
}): Promise<WealthboxCustomFieldIngestion> {
  const registry = await fetchCustomFieldRegistry(args.transport, args.documentType);
  const ingestion = buildCustomFieldAskSources(args.records, registry.definitions);
  if (ingestion.sources.length > 0) {
    await args.ingest(ingestion.sources);
  }
  return ingestion;
}
