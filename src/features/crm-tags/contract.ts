/**
 * Small, stable vocabulary for firm tags.
 *
 * Consumers save only `FirmTag.id` on their own records. A rename, recolor,
 * or retirement changes this catalog only, so a saved tag id remains valid.
 * Keep this contract deliberately small: persistence timestamps and storage
 * formats belong to the private catalog adapter.
 */
export type FirmTagStatus = 'active' | 'retired';

/** A normalized six-digit hex color: `#` followed by six hex digits. */
export type FirmTagColor = `#${string}`;

/** Stable machine-readable outcomes for all public tag operations. */
export type FirmTagErrorCode =
  | 'workspace_unavailable'
  | 'invalid_name'
  | 'invalid_color'
  | 'duplicate_name'
  | 'not_found'
  | 'retired'
  | 'persistence_failed';

/**
 * A public failure whose `code` is safe for callers to branch on. Its message
 * is for diagnostics only and must never be used as an application contract.
 */
export class FirmTagError extends Error {
  readonly code: FirmTagErrorCode;

  constructor(code: FirmTagErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'FirmTagError';
    this.code = code;
  }
}

/** The reusable tag value read by tasks, workflows, events, files, and bulk tools. */
export interface FirmTag {
  /** Stable identifier. It never changes after the tag is created. */
  id: string;
  /** Current display name offered by the firm. */
  name: string;
  /** Current approved display color. */
  color: FirmTagColor;
  /** Retired tags remain readable so saved tag IDs continue to resolve. */
  status: FirmTagStatus;
}

/** The complete firm-managed tag list, including retired historical tags. */
export interface FirmTagCatalog {
  version: 1;
  tags: readonly FirmTag[];
}

/** Input used only when firm administrators create a reusable tag. */
export interface CreateFirmTagInput {
  name: string;
  color: FirmTagColor;
}

/**
 * The only tag read/write operations shared with later feature lanes.
 *
 * Consumers read `list()` to resolve saved IDs and call these operations only
 * from firm administration. They must never rewrite their saved tag IDs after
 * a rename or retirement.
 */
export interface FirmTagStore {
  /** The current canonical CRM snapshot. It changes when any CRM peer writes. */
  readonly catalog: FirmTagCatalog;
  /** Distinguishes an empty catalog from a CRM workspace that cannot be used. */
  readonly errorCode: 'workspace_unavailable' | 'persistence_failed' | null;
  list(): Promise<FirmTagCatalog>;
  create(input: CreateFirmTagInput): Promise<FirmTagCatalog>;
  rename(id: string, name: string): Promise<FirmTagCatalog>;
  setColor(id: string, color: FirmTagColor): Promise<FirmTagCatalog>;
  retire(id: string): Promise<FirmTagCatalog>;
}
