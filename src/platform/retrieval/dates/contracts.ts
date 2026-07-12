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
 * An explicit, source-adapter supplied claim used only to compare evidence for
 * the same fact. This is not a hidden authority score: any authority context
 * is preserved as visible prose for Ask to show an advisor.
 */
export interface DatedFact {
  /** Stable, adapter-owned identity such as `umbrella-limit`. */
  key: string;
  /** The source's asserted value, kept verbatim for display. */
  value: string;
  /** Optional visible explanation, e.g. "signed policy declaration". */
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
 * A warning attached to every dated source in an incompatible set. `relation`
 * makes it impossible for a later answer layer to silently treat newer as
 * better: it receives both the newer and older sources and their dates.
 */
export interface DateConflictFlag {
  kind: 'conflicting-dated-evidence';
  factKey: string;
  relation: 'newer-conflicts-with-older' | 'older-conflicts-with-newer';
  evidence: DatedEvidence[];
}
