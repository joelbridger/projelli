import type { CrmSearchHit } from '@/platform/crm/search';

export type CrmRecordPresentation = {
  heading: string;
  body: string;
  details: readonly string[];
};

type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function objects(value: unknown): readonly UnknownRecord[] {
  return Array.isArray(value) ? value.map(object).filter((item): item is UnknownRecord => item !== null) : [];
}

function text(record: UnknownRecord, ...keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function displayDate(value: string | null): string | null {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

function queryTerms(query: string): readonly string[] {
  return query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function matches(record: UnknownRecord, query: string): boolean {
  const terms = queryTerms(query);
  if (!terms.length) return false;
  const searchable = JSON.stringify(record).toLocaleLowerCase();
  return terms.every((term) => searchable.includes(term));
}

function sourceLabels(record: UnknownRecord): readonly string[] {
  return objects(record['sources'])
    .map((source) => text(source, 'label', 'name', 'title'))
    .filter((label): label is string => label !== null);
}

function factPresentation(fact: UnknownRecord): CrmRecordPresentation {
  const label = text(fact, 'label', 'name') ?? 'Saved fact';
  const value = text(fact, 'value', 'text', 'body') ?? 'No value saved';
  const sources = sourceLabels(fact);
  const asOf = displayDate(text(fact, 'asOf', 'learned', 'createdAt', 'updatedAt'));
  return {
    heading: `Fact: ${label}`,
    body: value,
    details: [
      ...(sources.length ? [`Source: ${sources.join(', ')}`] : []),
      ...(asOf ? [`As of ${asOf}`] : []),
    ],
  };
}

function notePresentation(note: UnknownRecord): CrmRecordPresentation {
  const body = text(note, 'body', 'text', 'title') ?? 'Empty note';
  const audience = text(note, 'audience');
  const saved = displayDate(text(note, 'createdAt', 'updatedAt', 'date'));
  return {
    heading: 'Note',
    body,
    details: [
      ...(audience === 'internal' ? ['Internal only'] : audience === 'client-facing' ? ['Client-facing'] : []),
      ...(saved ? [`Saved ${saved}`] : []),
    ],
  };
}

function genericPresentation(record: UnknownRecord, kind: string, fallback: string): CrmRecordPresentation {
  const heading = ({
    household: 'Client',
    person: 'Person',
    account: 'Account',
    task: 'Task',
    workflowInstance: 'Workflow',
    workflowTemplate: 'Workflow template',
    opportunity: 'Opportunity',
    activityEvent: 'Activity',
    legacyProject: 'Project',
  } as Record<string, string>)[kind] ?? 'Saved record';
  const body = text(record, 'name', 'title', 'label', 'body', 'text', 'value', 'description') ?? fallback;
  const status = text(record, 'status', 'priority', 'lifecycle');
  const saved = displayDate(text(record, 'asOf', 'due', 'createdAt', 'updatedAt'));
  return {
    heading,
    body,
    details: [
      ...(status ? [`Status: ${status}`] : []),
      ...(saved ? [`Date: ${saved}`] : []),
    ],
  };
}

function safeFallback(hit: CrmSearchHit): string {
  const snippet = hit.snippet.trim();
  return snippet.startsWith('{') || snippet.startsWith('[') || snippet.includes('":"')
    ? `Matching ${hit.entityKind} record`
    : snippet || `Matching ${hit.entityKind} record`;
}

/** Turns an encrypted search row into advisor-facing copy without exposing IDs or JSON keys. */
export function presentCrmSearchHit(hit: CrmSearchHit, query: string): CrmRecordPresentation {
  let record: UnknownRecord | null = null;
  try {
    record = object(JSON.parse(hit.content));
  } catch {
    record = null;
    // Older or imported rows may contain plain text. The guarded fallback below
    // still refuses to expose a JSON-looking machine payload.
  }
  if (!record) return { heading: 'Saved record', body: safeFallback(hit), details: [] };

  if (hit.entityKind === 'fact') return factPresentation(record);
  if (hit.entityKind === 'note') return notePresentation(record);

  const matchingFact = objects(record['facts']).find((fact) => matches(fact, query));
  if (matchingFact) return factPresentation(matchingFact);
  const matchingNote = objects(record['notes']).find((note) => matches(note, query));
  if (matchingNote) return notePresentation(matchingNote);

  return genericPresentation(record, hit.entityKind, safeFallback(hit));
}
