import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

export type FormActivityStatus =
  | 'unmatched'
  | 'matched'
  | 'created'
  | 'rejected';

export interface FormActivityEntry {
  id: string;
  formName: string;
  submitterLabel: string | null;
  contact: { id: string; label: string } | null;
  submittedAt: string;
  status: FormActivityStatus;
  audience: 'internal' | 'client-facing';
}

type UnknownRecord = Record<string, unknown>;

type IntakeLinkDetails = {
  name: string;
  fields: ReadonlyMap<string, UnknownRecord>;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function latestDecision(decisions: unknown): UnknownRecord | null {
  if (!isRecord(decisions)) return null;
  const candidates = Object.values(decisions).filter(isRecord);
  return (
    candidates.sort((left, right) => {
      const leftAt = stringValue(left['decidedAt']) ?? '';
      const rightAt = stringValue(right['decidedAt']) ?? '';
      return rightAt.localeCompare(leftAt);
    })[0] ?? null
  );
}

function statusForDecision(decision: UnknownRecord | null): FormActivityStatus {
  switch (decision?.['decision']) {
    case 'match':
      return 'matched';
    case 'create':
      return 'created';
    case 'reject':
      return 'rejected';
    default:
      return 'unmatched';
  }
}

function isRecognizedSubmitterField(field: UnknownRecord): boolean {
  if (field['kind'] === 'email') return true;
  if (field['kind'] !== 'text') return false;
  const label = stringValue(field['label']);
  return Boolean(
    label && /^(full[ _-]?name|name|submitter|your name)$/i.test(label)
  );
}

function submitterFromPayload(
  payload: unknown,
  fields: ReadonlyMap<string, UnknownRecord> | undefined
): string | null {
  if (!isRecord(payload) || !isRecord(payload['values'])) return null;
  if (!fields) return null;
  for (const [fieldId, value] of Object.entries(payload['values'])) {
    if (!isRecognizedSubmitterField(fields.get(fieldId) ?? {})) continue;
    const submitter = stringValue(value);
    if (submitter) return submitter;
  }
  return null;
}

function householdNames(
  records: readonly LiveCrmRecord[]
): ReadonlyMap<string, string> {
  return new Map(
    records.flatMap((record) => {
      if (record.kind !== 'household') return [];
      const name = stringValue(record['name']);
      return name ? [[record.id, name] as const] : [];
    })
  );
}

function contactForDecision(
  decision: UnknownRecord | null,
  names: ReadonlyMap<string, string>
): FormActivityEntry['contact'] {
  if (!decision || !isRecord(decision['householdRef'])) return null;
  const id = stringValue(decision['householdRef']['id']);
  if (!id) return null;
  const label =
    stringValue(decision['householdRef']['label']) ?? names.get(id) ?? id;
  return { id, label };
}

/**
 * Reads only the durable CRM intake records. This surface intentionally does
 * not create, match, or review a submission; those actions keep their owners.
 */
export function selectFormActivity(
  records: readonly LiveCrmRecord[]
): readonly FormActivityEntry[] {
  const forms = new Map<string, IntakeLinkDetails>(
    records.flatMap((record) => {
      if (record.kind !== 'intakeLink') return [];
      const name = stringValue(record['name']);
      const rawFields = isRecord(record['fields']) ? record['fields'] : {};
      const fields = new Map(
        Object.entries(rawFields).flatMap(([id, field]) =>
          isRecord(field) ? [[id, field] as const] : []
        )
      );
      return name ? [[record.id, { name, fields }] as const] : [];
    })
  );
  const names = householdNames(records);

  return records
    .flatMap((record) => {
      if (record.kind !== 'intakeSubmission') return [];
      const intakeLinkId = stringValue(record['intakeLinkId']);
      const submittedAt = stringValue(record['submittedAt']);
      const audience =
        record['audience'] === 'internal' ||
        record['audience'] === 'client-facing'
          ? record['audience']
          : null;
      if (!intakeLinkId || !submittedAt || !audience) return [];
      const decision = latestDecision(record['matchingDecisions']);
      return [
        {
          id: record.id,
          formName: forms.get(intakeLinkId)?.name ?? intakeLinkId,
          submitterLabel: submitterFromPayload(
            record['payload'],
            forms.get(intakeLinkId)?.fields
          ),
          contact: contactForDecision(decision, names),
          submittedAt,
          status: statusForDecision(decision),
          audience,
        } satisfies FormActivityEntry,
      ];
    })
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
}

export function filterFormActivity(
  entries: readonly FormActivityEntry[],
  query: string,
  status: FormActivityStatus | 'all',
  audience: FormActivityEntry['audience'] | 'all'
): readonly FormActivityEntry[] {
  const normalized = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    const searchable = [
      entry.formName,
      entry.submitterLabel,
      entry.contact?.label,
      entry.status,
      entry.audience,
    ].filter((value): value is string => Boolean(value));
    return (
      (status === 'all' || entry.status === status) &&
      (audience === 'all' || entry.audience === audience) &&
      (!normalized ||
        searchable.some((value) =>
          value.toLocaleLowerCase().includes(normalized)
        ))
    );
  });
}
