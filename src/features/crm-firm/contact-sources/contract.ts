/**
 * Stable source vocabulary shared by the firm catalog and later contact writers.
 *
 * A contact writer saves a `ContactSourceReference`, not only a source id. The
 * label is a snapshot taken when the contact is written. It must never be
 * backfilled from this catalog: renaming or retiring a source changes only the
 * catalog, so existing contact history keeps both its original id and label.
 */
export type ContactSourceStatus = 'active' | 'inactive' | 'retired';

export interface ContactSource {
  /** Stable identifier. It is never changed after the source is created. */
  id: string;
  /** The current label offered to new contact writers. */
  label: string;
  /** Every label this source has had, oldest first, including `label`. */
  historicalLabels: readonly string[];
  /** Retired sources remain in the catalog for historical resolution. */
  status: ContactSourceStatus;
  createdAt: string;
  updatedAt: string;
  retiredAt?: string;
}

export interface ContactSourceCatalog {
  version: 1;
  sources: readonly ContactSource[];
}

/**
 * The persisted shape for directory/contact records. Keep this value exactly
 * as written; do not derive `sourceLabel` from the live catalog during reads.
 */
export interface ContactSourceReference {
  sourceId: string;
  sourceLabel: string;
}

/** Creates the immutable source snapshot that later contact writers persist. */
export function createContactSourceReference(
  source: Pick<ContactSource, 'id' | 'label'>
): ContactSourceReference {
  return { sourceId: source.id, sourceLabel: source.label };
}
