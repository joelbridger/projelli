import { useMemo } from 'react';
import { useContactRecordStore } from '@/features/crm-contacts';
import { createRecordKindsPort, type RecordKindsPort } from './recordKindsStore';

/**
 * Reactive record-kinds port hook. It reads the contact store internally and
 * returns ONLY the scoped port — the UI never receives the raw store, the
 * whole-firm `records` array, an id-only writer, or a whole-firm reload
 * signature (Finding #1).
 *
 * The public contact hook returns a new facade each render, so the port is
 * memoised on a CONTENT-based snapshot signature. That signature is internal to
 * this hook and is never handed to the UI; it only keeps `port.repository`
 * stable across the live hook's per-render identity churn so the section's
 * reload effect does not loop.
 */
export function useRecordKindsPort(): RecordKindsPort {
  const contacts = useContactRecordStore();
  const snapshotSignature =
    contacts.records
      .map(
        (record) =>
          `${record.kind}:${record.id}:${record.matterId}:${record.updatedAt ?? ''}`
      )
      .join('|') +
    '::' +
    String(contacts.unpairedContactDocuments.length);
  return useMemo(
    () => createRecordKindsPort(contacts),
    // The content-based snapshot signature is the stable reactive key; `contacts`
    // itself is a fresh facade each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- explained above
    [snapshotSignature]
  );
}
