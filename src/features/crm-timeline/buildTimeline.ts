import type { TimelineEntry, TimelineEntryType, TimelineHousehold, TimelineRecord, TimelineSource } from './types';

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function date(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function value(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function source(kind: string, id: string, label?: string): TimelineSource {
  return { kind, id, label: label || `${kind} record` };
}

function sourceList(input: unknown): TimelineSource[] {
  const items = Array.isArray(input) ? input : [input];
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    const id = text(value(candidate, 'id')) || text(value(candidate, 'sourceId'));
    return id ? [source(text(value(candidate, 'kind')) || text(value(candidate, 'sourceType')) || 'source', id, text(value(candidate, 'label')) || text(value(candidate, 'title')))] : [];
  });
}

function referencesHousehold(record: TimelineRecord, household: TimelineHousehold): boolean {
  if (record.kind === 'household' && record.id === household.id) return true;
  if (text(value(record, 'householdId')) === household.id) return true;
  const householdRef = value(record, 'householdRef');
  if (householdRef && typeof householdRef === 'object' && text(value(householdRef as Record<string, unknown>, 'id')) === household.id) return true;
  if (['householdLinks', 'links', 'contextRefs'].some((key) => sourceList(value(record, key)).some((item) => item.kind === 'household' && item.id === household.id))) return true;
  return Boolean(household.matterId && record.matterId === household.matterId);
}

/** Document files live in Documents. CRM records store only these small refs. */
function addDocumentLinkEntries(entries: TimelineEntry[], record: TimelineRecord, at: string, who: string, ownSource: TimelineSource) {
  const documentRefs = ['contextRefs', 'links']
    .flatMap((key) => sourceList(value(record, key)))
    .filter((item) => item.kind === 'document');
  documentRefs.forEach((document) => {
    entries.push(entry('document', `document-link:${record.kind}:${record.id}:${document.id}`, at, who, `Linked document: ${document.label}`, source('document', document.id, document.label), [ownSource]));
  });
  if (record.kind !== 'household') return;
  const notes = value(record, 'notes');
  if (!Array.isArray(notes)) return;
  notes.forEach((note, index) => {
    if (!note || typeof note !== 'object') return;
    const noteValue = note as Record<string, unknown>;
    const noteAt = date(value(noteValue, 'updatedAt')) ?? date(value(noteValue, 'createdAt')) ?? at;
    sourceList(value(noteValue, 'links')).filter((item) => item.kind === 'document').forEach((document) => {
      entries.push(entry('document', `document-link:household-note:${record.id}:${String(value(noteValue, 'id') ?? index)}:${document.id}`, noteAt, who, `Linked document: ${document.label}`, source('document', document.id, document.label), [source('note', text(value(noteValue, 'id')) || `${record.id}:note:${index}`, text(value(noteValue, 'body'), 'Household note'))]));
    });
  });
}

function recordDate(record: TimelineRecord): string | null {
  return date(value(record, 'at')) ?? date(value(record, 'completedAt')) ?? date(record.updatedAt) ?? date(record.createdAt) ?? date(value(record, 'startedAt'));
}

function recordActor(record: TimelineRecord): string {
  const actor = value(record, 'actor') ?? value(record, 'updatedBy') ?? value(record, 'createdBy');
  if (actor && typeof actor === 'object') return text(value(actor as Record<string, unknown>, 'display')) || text(value(actor as Record<string, unknown>, 'label')) || 'A team member';
  return text(value(record, 'completedBy')) || 'A team member';
}

function entry(type: TimelineEntryType, id: string, at: string, who: string, summary: string, ownSource: TimelineSource, provenance: TimelineSource[]): TimelineEntry {
  return { id, type, at, who, summary, source: ownSource, provenance };
}

function addRecordEntries(entries: TimelineEntry[], record: TimelineRecord, household: TimelineHousehold) {
  if (!referencesHousehold(record, household)) return;
  const at = recordDate(record);
  if (!at) return;
  const ownSource = source(record.kind, record.id, text(value(record, 'title')) || text(value(record, 'name')) || text(value(record, 'summary')));
  const sourceValue = value(record, 'source');
  const provenance = sourceList(sourceValue && typeof sourceValue === 'object' ? value(sourceValue as Record<string, unknown>, 'sources') : value(record, 'sources'));
  const who = recordActor(record);
  addDocumentLinkEntries(entries, record, at, who, ownSource);
  if (record.kind === 'activityEvent') {
    entries.push(entry('activity', record.id, at, who, text(value(record, 'summary'), 'Activity recorded'), ownSource, [...provenance, ...sourceList(value(record, 'targetRef'))]));
  } else if (record.kind === 'task' && value(record, 'status') === 'done') {
    entries.push(entry('task', record.id, at, who, `Completed task: ${text(value(record, 'title'), 'Untitled task')}`, ownSource, provenance));
  } else if (record.kind === 'fact') {
    entries.push(entry('fact', record.id, at, who, `Updated fact: ${text(value(record, 'label'), 'Untitled fact')}`, ownSource, provenance));
  } else if (record.kind === 'note') {
    entries.push(entry('note', record.id, at, who, text(value(record, 'title')) || text(value(record, 'body'), 'Added a note'), ownSource, provenance));
  } else if (record.kind === 'workflowInstance') {
    const rawSteps = value(record, 'steps');
    const steps = rawSteps && typeof rawSteps === 'object' ? Object.values(rawSteps as Record<string, unknown>).filter((step) => step && typeof step === 'object' && value(step as Record<string, unknown>, 'status') === 'done') : [];
    if (steps.length) steps.forEach((step, index) => entries.push(entry('workflow', `${record.id}:step:${index}`, at, who, `Completed workflow step: ${text(value(step as Record<string, unknown>, 'titleSnapshot'), text(value(record, 'name'), 'Workflow'))}`, ownSource, provenance)));
    else entries.push(entry('workflow', record.id, at, who, `${text(value(record, 'name'), 'Workflow')} ${text(value(record, 'status'), 'updated')}`, ownSource, provenance));
  } else {
    const type: TimelineEntryType | null = record.kind === 'email' || record.kind === 'mail' ? 'email' : record.kind === 'meeting' || record.kind === 'calendarEvent' || record.kind === 'event' ? 'meeting' : record.kind === 'document' || record.kind === 'doc' || record.kind === 'file' ? 'document' : null;
    if (type) entries.push(entry(type, record.id, at, who, text(value(record, 'summary')) || text(value(record, 'title')) || text(value(record, 'name')) || `${type.charAt(0).toUpperCase()}${type.slice(1)} recorded`, ownSource, provenance));
  }
}

/** A read-only projection. It never copies or owns mail, calendar, or document records. */
export function buildHouseholdTimeline(household: TimelineHousehold, records: readonly TimelineRecord[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const note of household.notes ?? []) {
    const at = date(note.updatedAt) ?? date(note.createdAt);
    if (at) entries.push(entry('note', `household-note:${note.id}`, at, note.author || 'A team member', note.body || 'Added a note', source('note', note.id, 'Household note'), []));
  }
  for (const fact of household.facts ?? []) {
    const at = date(fact.learned) ?? date(fact.asOf);
    if (at) entries.push(entry('fact', `household-fact:${fact.id}`, at, 'A team member', `Updated fact: ${fact.label}${fact.value ? ` (${fact.value})` : ''}`, source('fact', fact.id, fact.label), (fact.sources ?? []).map((item) => source('document', item.id, item.label))));
  }
  records.forEach((record) => addRecordEntries(entries, record, household));
  return [...new Map(entries.map((item) => [item.id, item])).values()].sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}
