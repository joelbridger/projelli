/**
 * Source-time metadata carried alongside a retrieval hit.
 *
 * `indexed_at` is deliberately absent: it describes Lantern's search index,
 * not when a client fact was true. Older rows use `value: null` instead of
 * borrowing an index timestamp.
 */
export type SourceDateKind =
  | 'effective'
  | 'received'
  | 'sent'
  | 'created'
  | 'updated'
  | 'event-start'
  | 'document-modified'
  | 'snapshot-exported'
  | 'unknown';

export interface SourceDate {
  /** Normalized RFC 3339 timestamp, or null when the source has no safe date. */
  value: string | null;
  /** What the source date means. Never infer a stronger meaning. */
  kind: SourceDateKind;
  /** Original source wording, retained when normalization is unsafe. */
  rawValue?: string;
  /** Whether this came directly from the source, a safe derivation, or is unknown. */
  confidence: 'source' | 'derived' | 'unknown';
}

/**
 * An explicit, source-adapter supplied timestamp identity. It is only used to
 * compare two imported copies of the SAME record (for example, the same mail
 * message from two folders). It is not a general fact-extraction system and it
 * must never be used to compare claims in different documents.
 */
export interface DatedFact {
  /** Stable, adapter-owned record timestamp identity. */
  key: string;
  /** The source's asserted value, kept verbatim for display. */
  value: string;
  /** Optional adapter-supplied provenance explanation. */
  authorityReason?: string;
}

export interface DatedEvidence {
  sourceId: string;
  path: string;
  value: string;
  sourceDate: SourceDate;
  authorityReason?: string;
}

/**
 * A warning attached to matching copies of one record when their imported
 * timestamps differ. `relation` makes it impossible for a later answer layer
 * to silently treat newer as better: it receives both copies and their dates.
 */
export interface DateConflictFlag {
  kind: 'conflicting-dated-evidence';
  factKey: string;
  relation: 'newer-conflicts-with-older' | 'older-conflicts-with-newer';
  evidence: DatedEvidence[];
}

/**
 * The date-related slice of a citation needed by date presentation. Keeping
 * this contract with retrieval lets any surface render dated evidence without
 * importing another feature's Ask-specific citation model.
 */
export interface DateableCitation {
  label: string;
  sourceDate?: SourceDate;
  datedFact?: DatedFact;
  dateConflict?: DateConflictFlag;
}
