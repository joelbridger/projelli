import type { NotesReviewDestination, NotesReviewItem } from './types';

const DESTINATIONS: readonly NotesReviewDestination[] = ['task', 'crm', 'client-note', 'internal'];

function readText(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function readDestination(value: unknown): NotesReviewDestination {
  if (typeof value !== 'string') return 'internal';
  const normalized = value.trim().toLowerCase().replace(/[ _]/g, '-');
  if (DESTINATIONS.includes(normalized as NotesReviewDestination)) {
    return normalized as NotesReviewDestination;
  }
  if (normalized === 'clientnote' || normalized === 'note') return 'client-note';
  if (normalized === 'crm-note' || normalized === 'crm-update') return 'crm';
  return 'internal';
}

/**
 * Safely adapts the parallel meeting-template output without trusting its
 * shape. Bad entries are omitted; missing/unknown destinations become local
 * internal notes, the least-surprising and non-outbound option.
 */
export function normalizeNotesReviewItems(rawItems: readonly unknown[]): NotesReviewItem[] {
  return rawItems.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const record = raw as Record<string, unknown>;
    // `MeetingTemplateSection` from the parallel `meetingTemplates` module is
    // `{ blockId, label, body, citations }`. These aliases deliberately keep
    // this UI compatible without trusting that module's object at runtime.
    const title = readText(record, ['title', 'summary', 'label', 'text']);
    if (!title) return [];
    const id = readText(record, ['id', 'itemId', 'key', 'blockId']) ?? `proposal-${String(index)}-${title}`;
    const detail = readText(record, ['detail', 'details', 'description', 'body', 'content']) ?? title;
    const citationText = Array.isArray(record['citations'])
      ? record['citations'].filter((citation): citation is number => Number.isSafeInteger(citation)).map(String).join(', ')
      : null;
    const sourceLabel = readText(record, ['sourceLabel', 'source', 'sourceRef', 'citation']) ?? citationText ?? undefined;
    return [{
      id,
      title,
      detail,
      destination: readDestination(record['destination'] ?? record['target'] ?? record['kind'] ?? record['output']),
      ...(sourceLabel ? { sourceLabel } : {}),
    }];
  });
}
