// src/platform/clientMap/types.ts
import type { RagHit } from '@/platform/utils/tauri-commands';

export type CompletenessLevel = 'thin' | 'getting-there' | 'solid';
export type ItemOrigin = 'ai' | 'user';
export type SectionScope = 'matter' | 'personal-template'; // 'firm' added in v2

/** The five core CONTENT sections, in display order. "What I'm missing"
 *  (Context Completeness) is rendered from ClientMap.completeness, not from a
 *  section in this list. */
export type CoreSectionKey = 'story' | 'people' | 'standing' | 'upcoming' | 'next';
export const CORE_SECTION_ORDER: CoreSectionKey[] = [
  'story',
  'people',
  'standing',
  'upcoming',
  'next',
];
export const CORE_SECTION_TITLE: Record<CoreSectionKey, string> = {
  story: 'The story so far',
  people: 'Key people',
  standing: 'Where things stand',
  upcoming: "What's coming",
  next: 'Next actions',
};

export interface SourceRef {
  kind: 'document' | 'email';
  /** Resolvable origin: a workspace path or `mail:<id>` (from RagHit.sourceId). */
  ref: string;
  /** The supporting quote (from RagHit.chunkText). */
  snippet: string;
  /** Content-addressed chunk id (RagHit.id) for ragVerifyCitation. */
  citationId?: string;
  /** Display locator label (page/paragraph), if known. */
  locator?: string;
}

export interface ClientMapItem {
  id: string;
  text: string;
  origin: ItemOrigin;
  /** true => no strong supporting source; feeds the "what I'm assuming" list. */
  isAssumption: boolean;
  sources: SourceRef[];
  updatedAt: string; // ISO 8601
}

export interface ClientMapSection {
  id: string;
  kind: 'core' | 'custom';
  /** A CoreSectionKey for core sections; a uuid for custom sections. */
  key: string;
  title: string;
  /** Custom sections only: the user's plain-language description of what to track. */
  prompt?: string;
  /** Custom sections only. */
  scope?: SectionScope;
  items: ClientMapItem[];
}

export interface ProposedUpdate {
  id: string;
  sectionKey: string;
  op: 'add' | 'change' | 'remove';
  itemId?: string; // for change/remove
  draft?: ClientMapItem; // for add/change
  reason: string;
  createdAt: string;
}

/** A gap question plus the section its answer should file into. The Guided
 *  Interview routes the user's answer to `sectionKey` so it lands in the right
 *  section (not always 'standing'). For AI-generated completeness gaps the
 *  generator tags the most relevant core section; for empty custom sections the
 *  key is that custom section's own key. */
export interface GapQuestion {
  text: string;
  /** A CoreSectionKey or a custom section's uuid key. */
  sectionKey: string;
}

export interface ContextCompleteness {
  level: CompletenessLevel;
  know: ClientMapItem[]; // sourced facts (aggregated view)
  assuming: ClientMapItem[]; // isAssumption items
  ask: GapQuestion[]; // gap questions (with target section) -> feed the Guided Interview
}

export interface ClientMap {
  matterId: string; // isolation key — always exactly one matter
  sections: ClientMapSection[];
  completeness: ContextCompleteness;
  pendingUpdates: ProposedUpdate[];
  lastBuiltAt: string; // ISO 8601, '' when never built
  lastSourceFingerprint: string;
}

export interface CustomCategoryTemplate {
  id: string;
  title: string;
  prompt: string;
  scope: SectionScope; // 'personal-template' in v1
}

export interface ClientQuestion {
  id: string;
  text: string;
  askedSection?: string;
}

export function sourceRefFromRagHit(hit: RagHit): SourceRef {
  const ref = hit.sourceId ?? hit.path;
  const kind: SourceRef['kind'] = hit.sourceType === 'mail' ? 'email' : 'document';
  const locator =
    hit.locator ??
    (hit.pageNumber !== undefined ? `p. ${String(hit.pageNumber)}` : undefined);
  const out: SourceRef = { kind, ref, snippet: hit.chunkText };
  if (hit.id !== undefined) out.citationId = hit.id;
  if (locator !== undefined) out.locator = locator;
  return out;
}

export function emptyClientMap(matterId: string): ClientMap {
  return {
    matterId,
    sections: CORE_SECTION_ORDER.map((key) => ({
      id: key,
      kind: 'core' as const,
      key,
      title: CORE_SECTION_TITLE[key],
      items: [],
    })),
    completeness: { level: 'thin', know: [], assuming: [], ask: [] },
    pendingUpdates: [],
    lastBuiltAt: '',
    lastSourceFingerprint: '',
  };
}
