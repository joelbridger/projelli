/**
 * Small, stable vocabulary for firm tags.
 *
 * Consumers save only `FirmTag.id` on their own records. A rename, recolor,
 * or retirement changes this catalog only, so a saved tag id remains valid.
 * Keep this contract deliberately small: persistence timestamps and storage
 * formats belong to the private catalog adapter.
 */
export type FirmTagStatus = 'active' | 'retired';

/** The approved firm-tag colors. A tag's color is presentation data, not its ID. */
export type FirmTagColor =
  | 'blue'
  | 'green'
  | 'amber'
  | 'red'
  | 'purple'
  | 'slate';

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
  list(): FirmTagCatalog;
  create(input: CreateFirmTagInput): FirmTagCatalog;
  rename(id: string, name: string): FirmTagCatalog;
  setColor(id: string, color: FirmTagColor): FirmTagCatalog;
  retire(id: string): FirmTagCatalog;
}
