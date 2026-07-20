import { useMemo, useRef } from 'react';
import { useContactRecordStore, type ContactRecordStore } from '@/features/crm-contacts';
import { createRecordKindsPort, type RecordKindsPort } from './recordKindsStore';

/**
 * Reactive record-kinds port hook. It reads the contact store internally and
 * returns ONLY the scoped port — the UI never receives the raw store, the
 * whole-firm `records` array, an id-only writer, or a whole-firm reload
 * signature (Finding #1).
 *
 * REACTIVITY BOUNDARY (Finding #1, round 4). The port's IDENTITY is now stable
 * for the whole life of the component: it is built once and never rebuilt. It
 * reaches current data through a ref that always points at the latest live
 * contact facade, so it stays correct without ever churning its identity.
 *
 * Why this matters for isolation: the section derives its reload callback from
 * `port.repository`. If the port's identity changed whenever ANY client's data
 * changed (the previous whole-pool snapshot key did exactly that), then a
 * Client-B change would give `port.repository` a new identity, churn the
 * section's reload callback, and re-run Client A's load effect — a cross-client
 * reactive/timing signal, even though A never sees B's data. Freezing the port
 * identity removes that side-channel at the source. The ONLY per-client
 * reactive input that remains is `reloadSignatureFor(scope)`, which is scoped to
 * the active sealed pair and read on each render from the current store — so the
 * section reloads for THIS client's own changes and for nothing else.
 */
export function useRecordKindsPort(): RecordKindsPort {
  // The public contact hook returns a fresh facade whenever ANY client's records
  // change, and that facade snapshots its `records`/`unpairedContactDocuments`
  // eagerly. Keep a ref pointing at the LATEST facade so the stable port below
  // always reads current data instead of a captured snapshot.
  const contacts = useContactRecordStore();
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;

  // A live store view whose IDENTITY never changes (memoised once). Every access
  // is delegated to `contactsRef.current`, so it reads the current data yet its
  // identity is fixed — and therefore so is the port built from it. This is what
  // keeps `port.repository` (and the section's reload callback) from churning on
  // another client's change.
  const liveStore = useMemo<ContactRecordStore>(
    () => ({
      get records() {
        return contactsRef.current.records;
      },
      get unpairedContactDocuments() {
        return contactsRef.current.unpairedContactDocuments;
      },
      listDirectory: () => contactsRef.current.listDirectory(),
      get: (id) => contactsRef.current.get(id),
      resolve: (ref) => contactsRef.current.resolve(ref),
      create: (input) => contactsRef.current.create(input),
      update: (id, patch) => contactsRef.current.update(id, patch),
      linkContact: (household, contact, role) =>
        contactsRef.current.linkContact(household, contact, role),
      unlinkContact: (household, contact) =>
        contactsRef.current.unlinkContact(household, contact),
      listRelated: (ref) => contactsRef.current.listRelated(ref),
    }),
    []
  );

  // The stable identity of `liveStore` makes this memo run exactly once, so the
  // port — and every accessor derived from it — keeps a single identity for the
  // component's life.
  return useMemo(() => createRecordKindsPort(liveStore), [liveStore]);
}
