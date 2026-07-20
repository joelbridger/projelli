// Audit log export helpers
//
// Pure functions for serializing AuditEntry arrays to JSON and CSV, plus
// utilities for filename construction and client-side download via Blob.
//
// Kept intentionally free of React / DOM coupling below the download layer
// so the serialization is unit-testable without jsdom.

import type { AuditEntry, AuditActionType } from '@/platform/types/audit';
import type { AuditIntegrityVerdict } from '@/platform/utils/tauri-commands';
import { csvCell, csvDocument, csvGuardedRow } from '@/platform/export/csvSafe';

/**
 * Columns emitted by the CSV exporter. The final three (`tokens_in`,
 * `tokens_out`, `cost_usd`) are future-proofing for the Q4 cost dashboard in
 * Wave 1.2 — they're derived from `metadata` / `outputs` if present, empty
 * string otherwise. The Q4 work may promote these to first-class fields on
 * `AuditEntry`; until then we scrape defensively.
 */
export const CSV_COLUMNS = [
  'id',
  'timestamp',
  'action',
  'description',
  'model',
  'status',
  'user_decision',
  'inputs',
  'outputs',
  'metadata',
  'tokens_in',
  'tokens_out',
  'cost_usd',
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

/**
 * Action types that map to a non-neutral "status". Everything else becomes
 * empty string in the CSV status column. Kept small and explicit so the Q4
 * dashboard can evolve this independently without breaking CSV consumers.
 */
const STATUS_FOR_ACTION: Partial<Record<AuditActionType, string>> = {
  workflow_start: 'started',
  workflow_complete: 'completed',
  workflow_fail: 'failed',
};

/**
 * Serialize entries to pretty-printed JSON with 2-space indentation.
 */
export function entriesToJSON(
  entries: AuditEntry[],
  integrity?: AuditIntegrityVerdict,
): string {
  if (integrity) {
    return JSON.stringify(
      {
        integrity,
        exportedAt: new Date().toISOString(),
        entries,
      },
      null,
      2,
    );
  }
  return JSON.stringify(entries, null, 2);
}

/**
 * Serialize entries to RFC 4180-compliant CSV.
 *
 * - Every field is quoted if it contains `,`, `"`, CR, or LF.
 * - Embedded `"` is escaped by doubling.
 * - Line separator is CRLF per RFC 4180.
 * - Nested objects (`inputs`, `outputs`, `metadata`) are JSON-stringified so
 *   the CSV stays one-row-per-entry without losing detail.
 */
export function entriesToCSV(
  entries: AuditEntry[],
  integrity?: AuditIntegrityVerdict,
): string {
  const header = csvGuardedRow(CSV_COLUMNS);
  const rows = entries.map((e) => csvGuardedRow(CSV_COLUMNS.map((col) => extractField(e, col))));
  const integrityRows = integrity ? integrityToCsvCommentRows(integrity) : [];
  return csvDocument([...integrityRows, header, ...rows]);
}

function integrityToCsvCommentRows(integrity: AuditIntegrityVerdict) {
  const rows: Array<[string, string]> = [['# integrity_status', integrity.status]];
  if (integrity.status === 'sealMissing') {
    // No "checked" count — the seal that would prove completeness is gone.
    rows.push(
      ['# integrity_surviving_rows', String(integrity.survivingRows)],
      ['# integrity_last_verifiable', integrity.lastTimestamp ?? ''],
    );
  } else {
    rows.push(['# integrity_checked', String(integrity.checked)]);
    if (integrity.status === 'altered') {
      rows.push(
        ['# integrity_broken_entry', String(integrity.seq)],
        ['# integrity_broken_id', integrity.id],
        ['# integrity_reason', integrity.reason],
      );
    }
  }
  // The `# integrity_*` keys are OUR literals, never user data, so they carry
  // no formula risk; the value beside them is data and is guarded.
  return rows.map(([key, value]) => [csvCell(key), csvCell(value)]);
}

/**
 * Extract a single field from an AuditEntry for a given CSV column. Returns
 * raw string (unescaped); the caller is responsible for CSV-escaping.
 */
function extractField(entry: AuditEntry, col: CsvColumn): string {
  switch (col) {
    case 'id':
      return entry.id;
    case 'timestamp':
      return entry.timestamp;
    case 'action':
      return entry.action;
    case 'description':
      return entry.description;
    case 'model':
      return entry.model ?? '';
    case 'status':
      return STATUS_FOR_ACTION[entry.action] ?? '';
    case 'user_decision':
      return entry.userDecision ?? '';
    case 'inputs': {
      const inputs = asRecord(entry.inputs);
      return Object.keys(inputs).length > 0 ? JSON.stringify(inputs) : '';
    }
    case 'outputs': {
      const outputs = asRecord(entry.outputs);
      return Object.keys(outputs).length > 0 ? JSON.stringify(outputs) : '';
    }
    case 'metadata': {
      const metadata = asRecord(entry.metadata);
      return Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : '';
    }
    case 'tokens_in':
      return readNumeric(entry, ['tokensIn', 'tokens_in', 'input_tokens']);
    case 'tokens_out':
      return readNumeric(entry, ['tokensOut', 'tokens_out', 'output_tokens', 'tokens']);
    case 'cost_usd':
      return readNumeric(entry, ['costUsd', 'cost_usd', 'cost']);
  }
}

/**
 * Look up a numeric value across `outputs`, `metadata`, and top-level entry
 * fields. Returns empty string if nothing found or value isn't a finite
 * number. Tolerates Wave 1.2 / Q4 schema extension regardless of where it
 * lands.
 */
function readNumeric(entry: AuditEntry, keys: string[]): string {
  const haystacks: Array<Record<string, unknown>> = [
    asRecord(entry.outputs),
    asRecord(entry.metadata),
    entry as unknown as Record<string, unknown>,
  ];
  for (const haystack of haystacks) {
    for (const key of keys) {
      const val = haystack[key];
      if (typeof val === 'number' && Number.isFinite(val)) {
        return String(val);
      }
    }
  }
  return '';
}

/*
 * BUG-027's local RFC-4180 + formula escape used to live here. It was correct,
 * and being correct in ONE of six writers is exactly the failure this class is
 * about — a per-file guard cannot make a promise about the file that gets
 * written next week. It now lives in `@/platform/export/csvSafe`, which the
 * derived-set gate requires every CSV writer to reach.
 */

/**
 * Build a filename like `aph-audit-2026-04-16T14-32-07.json` using the
 * given Date in local time. Colons in ISO time are replaced with `-` so the
 * name is portable across Windows.
 */
export function buildExportFilename(
  extension: 'json' | 'csv',
  now: Date = new Date()
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `aph-audit-${y}-${m}-${d}T${hh}-${mm}-${ss}.${extension}`;
}

/**
 * Unique models present in the given entries, sorted alphabetically. Used to
 * populate the model-filter dropdown.
 */
export function uniqueModels(entries: AuditEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) {
    if (e.model && e.model.trim() !== '') {
      set.add(e.model);
    }
  }
  return Array.from(set).sort();
}

export interface AuditMatterScopeOption {
  matterId: string;
  label: string;
}

export function uniqueMatterScopes(entries: AuditEntry[]): AuditMatterScopeOption[] {
  const byId = new Map<string, AuditMatterScopeOption>();
  for (const entry of entries) {
    const scope = getAuditEntryMatterScope(entry);
    if (scope?.kind === 'matter' && !byId.has(scope.matterId)) {
      byId.set(scope.matterId, {
        matterId: scope.matterId,
        label: scope.matterName ?? scope.matterId,
      });
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  );
}

export interface AuditFilter {
  actionTypes?: Set<AuditActionType> | undefined;
  /** Inclusive ISO date string (YYYY-MM-DD) for the start of the range. */
  dateFrom?: string | undefined;
  /** Inclusive ISO date string (YYYY-MM-DD) for the end of the range. */
  dateTo?: string | undefined;
  /** Model name to match exactly; empty string or undefined = no filter. */
  model?: string | undefined;
  /** Matter id to match from metadata scope/matter fields. */
  matterId?: string | undefined;
  /** Scope kind to match. `matterId` is more specific when both are present. */
  scope?: 'matter' | 'allMatters' | undefined;
  /** Free-text search across description, action, model. */
  searchQuery?: string | undefined;
}

/**
 * Pure filter function that composes every AuditLog filter in one place.
 * Dates are interpreted as local midnight for "from" and end-of-day 23:59:59
 * for "to" so the range is fully inclusive of both boundary days.
 */
export function filterEntries(
  entries: AuditEntry[],
  filter: AuditFilter
): AuditEntry[] {
  const fromTime = filter.dateFrom ? parseLocalDayStart(filter.dateFrom) : null;
  const toTime = filter.dateTo ? parseLocalDayEnd(filter.dateTo) : null;
  const query = filter.searchQuery?.toLowerCase() ?? '';

  return entries.filter((entry) => {
    if (
      filter.actionTypes &&
      filter.actionTypes.size > 0 &&
      !filter.actionTypes.has(entry.action)
    ) {
      return false;
    }

    if (filter.model && filter.model !== '' && entry.model !== filter.model) {
      return false;
    }

    if (filter.matterId && filter.matterId !== '') {
      const scope = getAuditEntryMatterScope(entry);
      if (scope?.kind !== 'matter' || scope.matterId !== filter.matterId) {
        return false;
      }
    } else if (filter.scope) {
      const scope = getAuditEntryMatterScope(entry);
      if (scope?.kind !== filter.scope) {
        return false;
      }
    }

    if (fromTime !== null || toTime !== null) {
      const t = new Date(entry.timestamp).getTime();
      if (Number.isFinite(t)) {
        if (fromTime !== null && t < fromTime) return false;
        if (toTime !== null && t > toTime) return false;
      }
    }

    if (query !== '') {
      const hit =
        entry.description.toLowerCase().includes(query) ||
        entry.action.toLowerCase().includes(query) ||
        (entry.model ? entry.model.toLowerCase().includes(query) : false);
      if (!hit) return false;
    }

    return true;
  });
}

type AuditEntryScope =
  | { kind: 'matter'; matterId: string; matterName?: string }
  | { kind: 'allMatters' };

function getAuditEntryMatterScope(entry: AuditEntry): AuditEntryScope | null {
  const meta = asRecord(entry.metadata);
  const scope = meta['scope'];
  if (isRecord(scope)) {
    const kind = stringValue(scope['kind']);
    if (kind === 'allMatters') {
      return { kind: 'allMatters' };
    }
    if (kind === 'matter') {
      const matterId =
        stringValue(scope['matterId']) ??
        stringValue(scope['matter_id']) ??
        stringValue(meta['matterId']) ??
        stringValue(meta['matter_id']) ??
        stringValue(meta['firm_matter_id']);
      if (matterId) {
        const matterName =
          stringValue(scope['matterName']) ??
          stringValue(scope['matter_name']) ??
          stringValue(meta['matterName']) ??
          stringValue(meta['matter_name']) ??
          undefined;
        return matterName
          ? { kind: 'matter', matterId, matterName }
          : { kind: 'matter', matterId };
      }
    }
  }

  const directMatterId =
    stringValue(meta['matterId']) ??
    stringValue(meta['matter_id']) ??
    stringValue(meta['firm_matter_id']);
  if (directMatterId) {
    const directMatterName =
      stringValue(meta['matterName']) ??
      stringValue(meta['matter_name']) ??
      undefined;
    return directMatterName
      ? { kind: 'matter', matterId: directMatterId, matterName: directMatterName }
      : { kind: 'matter', matterId: directMatterId };
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Defensive coercion to a plain record. An audit row may legitimately arrive
 * WITHOUT an `inputs` / `outputs` / `metadata` object (e.g. backend-emitted
 * connector entries), even though the `AuditEntry` type marks them required.
 * Reading `.scope` / `Object.keys()` off such an `undefined` throws and — with
 * no catch around the Activity Log's `useMemo` — white-screens the entire app.
 * Coercing to `{}` here means no audit row can ever throw, whatever its shape.
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed !== '' ? trimmed : null;
}

function parseLocalDayStart(isoDate: string): number | null {
  // isoDate is YYYY-MM-DD from a native date input. Construct in local tz.
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [y, m, d] = parts as [number, number, number];
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function parseLocalDayEnd(isoDate: string): number | null {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [y, m, d] = parts as [number, number, number];
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

/**
 * Trigger a browser download of the given text content. Uses a Blob + a
 * temporary anchor with `download=` attribute and cleans up the object URL.
 * No-ops cleanly when `document`/`URL.createObjectURL` aren't available
 * (e.g. SSR / unit tests without jsdom hooks).
 */
export function triggerDownload(
  content: string,
  filename: string,
  mimeType: string
): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return;
  }
  if (typeof URL.createObjectURL !== 'function') {
    return;
  }
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke asynchronously so the click has time to consume the URL on
  // slower-running browsers (Safari in particular).
  setTimeout(() => {
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  }, 0);
}

/**
 * Convenience wrapper: serialize + trigger download in one call. Returns the
 * filename used so the caller can log / toast.
 */
export function downloadAuditJSON(
  entries: AuditEntry[],
  now: Date = new Date(),
  integrity?: AuditIntegrityVerdict,
): string {
  const filename = buildExportFilename('json', now);
  triggerDownload(entriesToJSON(entries, integrity), filename, 'application/json');
  return filename;
}

export function downloadAuditCSV(
  entries: AuditEntry[],
  now: Date = new Date(),
  integrity?: AuditIntegrityVerdict,
): string {
  const filename = buildExportFilename('csv', now);
  triggerDownload(entriesToCSV(entries, integrity), filename, 'text/csv');
  return filename;
}
