/**
 * Task 12c — thin meeting-type detection + per-type output defaults. NOT a
 * rules-engine UI: types are detected from the calendar title, taught by
 * correction, and each type just remembers which outputs to prepare. All
 * types use the same Task 10 note template in v1 — only the follow-up-draft
 * / CRM-packet auto-prepare flags differ.
 */

export const BUILT_IN_TYPES = ['annual-review', 'intake', 'check-in'] as const;
export type BuiltInMeetingType = (typeof BUILT_IN_TYPES)[number];
/** A built-in id or a user-named custom type — widened to `string` (rather
 *  than `BuiltInMeetingType | string`, which TS flags as redundant since the
 *  literal union adds no type-checking value once unioned with `string`). */
export type MeetingTypeId = string;

export type LearnedTypeMap = Record<string, MeetingTypeId>;

interface Keyword {
  type: BuiltInMeetingType;
  patterns: RegExp[];
}

const KEYWORDS: Keyword[] = [
  { type: 'annual-review', patterns: [/annual review/i, /\breview\b/i] },
  { type: 'intake', patterns: [/\bintake\b/i, /new client/i] },
  { type: 'check-in', patterns: [/check[- ]?in/i, /quick call/i] },
];

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * Detects a meeting type from a calendar event title (or null for an ad-hoc
 * recording with no matched event). Learned corrections (exact normalized
 * title match) take precedence over keyword matching.
 */
export function detectMeetingType(title: string | null, learned: LearnedTypeMap): MeetingTypeId | null {
  if (!title) return null;
  const normalized = normalizeTitle(title);
  const taught = learned[normalized];
  if (taught) return taught;
  for (const { type, patterns } of KEYWORDS) {
    if (patterns.some((p) => p.test(title))) return type;
  }
  return null;
}

export interface MeetingTypeDefaults {
  templateId: string;
  prepareFollowupDraft: boolean;
  prepareCrmPacket: boolean;
}

const DEFAULT_TEMPLATE_ID = 'meeting-note-from-transcript';

/** v1 output defaults per built-in type. Unknown/custom types fall back to
 *  the same conservative defaults as check-in (no auto-prepare). */
export function typeDefaults(typeId: MeetingTypeId): MeetingTypeDefaults {
  if (typeId === 'annual-review' || typeId === 'intake') {
    return { templateId: DEFAULT_TEMPLATE_ID, prepareFollowupDraft: true, prepareCrmPacket: true };
  }
  return { templateId: DEFAULT_TEMPLATE_ID, prepareFollowupDraft: false, prepareCrmPacket: false };
}

export interface CustomMeetingType {
  id: string;
  label: string;
  defaults: MeetingTypeDefaults;
}

export interface MeetingTypesFile {
  learned: LearnedTypeMap;
  custom: CustomMeetingType[];
}

const EMPTY_FILE: MeetingTypesFile = { learned: {}, custom: [] };

/** The injected-pair storage interface, matching consentLedger.ts's pattern
 *  (Task 13) — a narrow read/write slice, not the concrete WorkspaceService. */
export interface MeetingTypesStorage {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface MeetingTypeMutationGuard {
  assertCurrentAccess(): Promise<void>;
}

const STORAGE_PATH = '.lantern/meeting-types.json';

export function makeMeetingTypesStore(ws: MeetingTypesStorage) {
  async function load(): Promise<MeetingTypesFile> {
    try {
      const raw = await ws.readFile(STORAGE_PATH);
      const parsed = JSON.parse(raw) as Partial<MeetingTypesFile>;
      return { learned: parsed.learned ?? {}, custom: parsed.custom ?? [] };
    } catch {
      return { ...EMPTY_FILE };
    }
  }

  async function learnCorrection(
    title: string,
    typeId: MeetingTypeId,
    guard?: MeetingTypeMutationGuard
  ): Promise<void> {
    await guard?.assertCurrentAccess();
    const file = await load();
    file.learned[normalizeTitle(title)] = typeId;
    await guard?.assertCurrentAccess();
    await ws.writeFile(STORAGE_PATH, JSON.stringify(file, null, 2));
  }

  async function addCustomType(type: CustomMeetingType): Promise<void> {
    const file = await load();
    file.custom = [...file.custom.filter((c) => c.id !== type.id), type];
    await ws.writeFile(STORAGE_PATH, JSON.stringify(file, null, 2));
  }

  return { load, learnCorrection, addCustomType };
}
