// src/platform/clientMap/types.ts
import type { RagHit } from '@/platform/utils/tauri-commands';
import type { EgressDestination } from '@/platform/privacy/egress';

export type CompletenessLevel = 'thin' | 'getting-there' | 'solid';
export type ItemOrigin = 'ai' | 'user';
export type SectionScope = 'matter' | 'personal-template'; // 'firm' added in v2

/** The four core CONTENT sections, in display order. "What I'm missing"
 *  (Context Completeness) is rendered from ClientMap.completeness, not from a
 *  section in this list.
 *
 *  The set (approved 2026-06-29) is grounded in how advisors actually organize a
 *  household (CFP data-gathering, Wealthbox / Redtail / FSC record models, Kitces
 *  review prep): WHO → WHY → WHAT-NOW → MY-TO-DOS. The old fifth bucket
 *  ("Coming up" / dated events) was folded into Follow-ups. The KEYS were
 *  renamed to match the labels (was people/story/standing/upcoming/next). */
export type CoreSectionKey = 'household' | 'goals' | 'money' | 'followups';
export const CORE_SECTION_ORDER: CoreSectionKey[] = [
  'household',
  'goals',
  'money',
  'followups',
];
export const CORE_SECTION_TITLE: Record<CoreSectionKey, string> = {
  household: 'Household',
  goals: 'Goals',
  money: 'Money and accounts',
  followups: 'Follow-ups',
};

export interface SourceRef {
  kind: 'document' | 'email' | 'crm' | 'onedrive' | 'esign' | 'meeting' | 'box' | 'jotform' | 'sharefile' | 'zocks' | 'addepar';
  /** Resolvable origin: a workspace path, `mail:<id>`, `crm:<kind>:<id>`, or another connector source id. */
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

export type ClientMapEditAction =
  | 'bullet_added'
  | 'bullet_edited'
  | 'bullet_removed'
  | 'section_removed';

export interface ClientMapEditHistoryEntry {
  id: string;
  action: ClientMapEditAction;
  actor: string;
  timestamp: string; // ISO 8601
  sectionId: string;
  sectionKey: string;
  sectionTitle: string;
  itemId?: string;
  beforeText?: string;
  afterText?: string;
  sources: SourceRef[];
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
  /** Stable content identity of THIS proposal (section + op + normalized text).
   *  Lets a proposal be deduped across passes and matched to a dismissal so it
   *  is not re-issued with a fresh id (which would reset an in-progress edit).
   *  Present on proposals from `proposeUpdates`; older persisted ones may omit it. */
  signature?: string;
  /** Fingerprint of the source(s) that produced this proposal. A dismissal is
   *  keyed to this so the proposal only reappears when ITS source changes. */
  sourceSignature?: string;
}

/** A proposal the user explicitly dismissed. Keyed by the proposal's stable
 *  `signature` plus the `sourceSignature` of the source that produced it, so the
 *  same proposal stays suppressed until THAT source changes again (spec §3.2). */
export interface DismissedSignature {
  signature: string;
  sourceSignature: string;
  dismissedAt: string;
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
  /** AI route used by the last successful build. Absent when no AI send ran. */
  buildEgress?: {
    provider: string;
    destination: EgressDestination;
    dataLeaves: boolean;
  };
  /** Proposals the user dismissed; suppresses re-proposing them until their
   *  source changes. Optional for back-compat with maps persisted before this. */
  dismissedSignatures?: DismissedSignature[];
  /** Normalized texts of gap questions the user has answered or flagged, so the
   *  Guided Interview does not replay them (BUG-106). Optional for back-compat. */
  resolvedGaps?: string[];
  /** Advisor-visible edit history for manual Client Map changes. */
  editHistory?: ClientMapEditHistoryEntry[];
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

function locatorFromRagHit(hit: RagHit): string | undefined {
  const explicit = hit.locator?.trim();
  if (explicit && !/^p(?:age)?\.?\s*0$/i.test(explicit)) return explicit;
  const pageNumber = hit.pageNumber;
  if (pageNumber !== undefined && Number.isFinite(pageNumber) && pageNumber >= 1) {
    return `p. ${String(pageNumber)}`;
  }
  return undefined;
}

export function sourceRefFromRagHit(hit: RagHit): SourceRef {
  const ref = hit.sourceId ?? hit.path;
  const kind: SourceRef['kind'] =
    hit.sourceType === 'crm'
      ? 'crm'
      : hit.sourceType === 'mail'
        ? 'email'
        : hit.sourceType === 'onedrive'
          ? 'onedrive'
          : hit.sourceType === 'esign'
            ? 'esign'
            : hit.sourceType === 'meeting'
              ? 'meeting'
              : hit.sourceType === 'box'
                ? 'box'
                : hit.sourceType === 'jotform'
                  ? 'jotform'
                  : hit.sourceType === 'sharefile'
                    ? 'sharefile'
                    : hit.sourceType === 'zocks'
                      ? 'zocks'
                      : hit.sourceType === 'addepar'
                        ? 'addepar'
                        : 'document';
  const locator = locatorFromRagHit(hit);
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
