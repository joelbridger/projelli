// src/platform/clientMap/updater.ts
import { MemoryService } from '@/platform/rag/MemoryService';
import type { ClientMap, ClientMapItem, ClientMapSection, DismissedSignature, ProposedUpdate, SourceRef } from './types';

const BROAD_QUERY = 'client matter overview documents people dates issues';
export const CLIENT_MAP_SECTION_ITEM_CAP = 12;
const NEAR_DUPLICATE_JACCARD_THRESHOLD = 0.8;
const NEAR_DUPLICATE_OVERLAP_THRESHOLD = 0.8;
const MIN_NEAR_DUPLICATE_TOKENS = 3;

const LOW_SIGNAL_WORDS = new Set([
  'a', 'about', 'after', 'again', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'been', 'being', 'but', 'by', 'client', 'clients', 'did', 'do', 'does', 'for',
  'from', 'had', 'has', 'have', 'he', 'her', 'his', 'household', 'households', 'in',
  'into', 'is', 'it', 'its', 'matter', 'matters', 'of', 'on', 'or', 'our', 'she',
  'so', 'that', 'the', 'their', 'them', 'these', 'they', 'this', 'those', 'to', 'was',
  'were', 'will', 'with',
]);

const TOKEN_ALIASES: Record<string, string> = {
  expectations: 'expect',
  expected: 'expect',
  expects: 'expect',
  holding: 'hold',
  holds: 'hold',
  held: 'hold',
  intended: 'intend',
  intends: 'intend',
  planning: 'plan',
  planned: 'plan',
  plans: 'plan',
  preserving: 'preserve',
  preservation: 'preserve',
  preserves: 'preserve',
  retirement: 'retire',
  retired: 'retire',
  retiring: 'retire',
};

/**
 * Cheap staleness fingerprint of a matter's indexed content.
 *
 * BUG-102: it folds in each hit's content-addressed chunk `id` (which DOES
 * change when a file is edited in place and re-indexed), not just the set of
 * unique source paths. That way an in-place edit of an existing file (same path,
 * new content -> new chunk id) changes the fingerprint and triggers an update
 * pass, instead of being invisible because the path set is unchanged.
 */
export async function computeSourceFingerprint(matterId: string): Promise<string> {
  const hits = await MemoryService.retrieve(BROAD_QUERY, 200, { kind: 'matter', matterId }, false);
  const sources = Array.from(new Set(hits.map((h) => h.sourceId ?? h.path))).sort();
  // Content-addressed chunk ids change on every in-place edit; include them so
  // an edited-but-same-path file is detected. Fall back to a path:paragraph
  // locator for any pre-id row so those still contribute some content signal.
  const chunkKeys = Array.from(
    new Set(hits.map((h) => h.id ?? `${h.sourceId ?? h.path}#${String(h.paragraphIndex)}`)),
  ).sort();
  return `${String(sources.length)}:${sources.join('|')}::${String(chunkKeys.length)}:${chunkKeys.join('|')}`;
}

/** Normalize an item's text for stable comparison/signature. */
function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeToken(token: string): string {
  const alias = TOKEN_ALIASES[token];
  if (alias) return alias;
  if (token.length > 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

function contentWordSet(text: string): Set<string> {
  const tokens = normalizeText(text)
    .replace(/['’]s\b/g, '')
    .match(/[a-z0-9]+(?:\.[0-9]+)?/g) ?? [];
  return new Set(
    tokens
      .map(normalizeToken)
      .filter((token) => token.length > 1 && !LOW_SIGNAL_WORDS.has(token)),
  );
}

export function areNearDuplicateFacts(left: string, right: string): boolean {
  if (normalizeText(left) === normalizeText(right)) return true;

  const leftTokens = contentWordSet(left);
  const rightTokens = contentWordSet(right);
  const smallerSize = Math.min(leftTokens.size, rightTokens.size);
  if (smallerSize < MIN_NEAR_DUPLICATE_TOKENS) return false;

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  const unionSize = leftTokens.size + rightTokens.size - shared;
  const jaccard = unionSize === 0 ? 0 : shared / unionSize;
  const overlap = shared / smallerSize;
  return jaccard >= NEAR_DUPLICATE_JACCARD_THRESHOLD || overlap >= NEAR_DUPLICATE_OVERLAP_THRESHOLD;
}

function sourceStrength(item: ClientMapItem): number {
  const strongSources = item.sources.filter((source) => source.ref.trim() !== '' && source.snippet.trim() !== '');
  const citationCount = strongSources.filter((source) => source.citationId !== undefined).length;
  const locatorCount = strongSources.filter((source) => source.locator !== undefined).length;
  return (item.isAssumption ? -100 : 0) + strongSources.length * 10 + citationCount * 3 + locatorCount;
}

function strongerItem(left: ClientMapItem, right: ClientMapItem): ClientMapItem {
  const leftStrength = sourceStrength(left);
  const rightStrength = sourceStrength(right);
  if (leftStrength !== rightStrength) return leftStrength > rightStrength ? left : right;
  return left.sources.length >= right.sources.length ? left : right;
}

export function capGeneratedSectionItems(
  items: ClientMapItem[],
  cap: number = CLIENT_MAP_SECTION_ITEM_CAP,
): ClientMapItem[] {
  const deduped: Array<{ item: ClientMapItem; index: number }> = [];

  items.forEach((item, index) => {
    const existingIndex = deduped.findIndex((candidate) => areNearDuplicateFacts(candidate.item.text, item.text));
    if (existingIndex === -1) {
      deduped.push({ item, index });
      return;
    }

    const current = deduped[existingIndex];
    if (current === undefined) return;
    const stronger = strongerItem(current.item, item);
    if (stronger === item) deduped[existingIndex] = { item, index };
  });

  if (deduped.length <= cap) return deduped.map((entry) => entry.item);

  const selected = deduped
    .map((entry) => ({ ...entry, strength: sourceStrength(entry.item) }))
    .sort((a, b) => b.strength - a.strength || a.index - b.index)
    .slice(0, cap)
    .sort((a, b) => a.index - b.index);

  return selected.map((entry) => entry.item);
}

/** Merge two source lists, de-duping by content-addressed citation id (or ref).
 *  So a fact known from both a file and a CRM record ends up citing BOTH. */
function mergeSourceRefs(a: SourceRef[], b: SourceRef[]): SourceRef[] {
  const seen = new Set(a.map((s) => s.citationId ?? s.ref));
  const merged = [...a];
  for (const s of b) {
    const key = s.citationId ?? s.ref;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(s);
    }
  }
  return merged;
}

/**
 * Collapse facts that appear in MORE THAN ONE section. On a MERGED client the
 * same fact can surface from both a file source and a CRM source and land in two
 * different sections (e.g. "Key goals" and "Where things stand"), differing only
 * in casing/wording — the per-section dedup (`capGeneratedSectionItems`) can't see
 * across sections, so the user sees it twice. This keeps the first occurrence (in
 * section order) and drops later near-duplicates, merging the dropped item's
 * sources into the kept one so the single entry cites both the file and the CRM.
 */
export function dedupeAcrossSections(sections: ClientMapSection[]): ClientMapSection[] {
  interface Kept { sectionIdx: number; item: ClientMapItem; sources: SourceRef[] }
  const kept: Kept[] = [];
  sections.forEach((section, sectionIdx) => {
    for (const item of section.items) {
      const existing = kept.find((k) => areNearDuplicateFacts(k.item.text, item.text));
      if (existing) {
        // Cross-section duplicate: drop it, merge its sources into the kept one.
        existing.sources = mergeSourceRefs(existing.sources, item.sources);
      } else {
        kept.push({ sectionIdx, item, sources: item.sources });
      }
    }
  });
  return sections.map((section, sectionIdx) => ({
    ...section,
    items: kept
      .filter((k) => k.sectionIdx === sectionIdx)
      .map((k) => (k.sources === k.item.sources ? k.item : { ...k.item, sources: k.sources })),
  }));
}

/** Stable content identity of a proposal: section + op + normalized text.
 *  The same fact proposed across passes yields the same signature, so it can be
 *  deduped and matched to a dismissal regardless of the volatile `id`. */
export function proposalSignature(sectionKey: string, op: ProposedUpdate['op'], draftText: string): string {
  return `${sectionKey} | ${op} | ${normalizeText(draftText)}`;
}

/** Fingerprint of the source(s) backing a draft item. Uses the content-addressed
 *  citation id when present (so it changes when the file is re-indexed after an
 *  edit), else the resolvable ref. A dismissal keyed to this lifts only when the
 *  backing source actually changes (spec §3.2 / §6 rule 5). */
export function sourceSignatureFor(sources: SourceRef[]): string {
  if (sources.length === 0) return '';
  return Array.from(new Set(sources.map((s) => s.citationId ?? s.ref)))
    .sort()
    .join('|');
}

function draftSignature(sectionKey: string, op: ProposedUpdate['op'], draft: ClientMapItem | undefined): string {
  return proposalSignature(sectionKey, op, draft?.text ?? '');
}

function hasStrongSource(item: ClientMapItem): boolean {
  return item.sources.some((source) => source.ref.trim() !== '' && source.snippet.trim() !== '');
}

function sectionHasText(section: ClientMapSection | undefined, text: string): boolean {
  return (section?.items ?? []).some((item) => areNearDuplicateFacts(item.text, text));
}

function isAutoApplicableAdd(map: ClientMap, update: ProposedUpdate): update is ProposedUpdate & { draft: ClientMapItem } {
  if (update.op !== 'add' || update.draft === undefined) return false;
  if (update.draft.origin !== 'ai' || update.draft.isAssumption) return false;
  if (!hasStrongSource(update.draft)) return false;

  const section = map.sections.find((sec) => sec.key === update.sectionKey);
  if (!section) return false;
  if (section.items.length >= CLIENT_MAP_SECTION_ITEM_CAP) return false;
  return !sectionHasText(section, update.draft.text);
}

/** Composite dismissal key: a dismissal only suppresses the SAME proposal text
 *  backed by the SAME source. Keying by signature alone would let dismissing the
 *  same fact from source B drop an earlier dismissal of source A (Codex finding). */
function dismissalKey(signature: string, sourceSignature: string): string {
  return `${signature} || ${sourceSignature}`;
}

/** The set of dismissed (signature, sourceSignature) composite keys. */
function dismissedKeySet(dismissed: DismissedSignature[]): Set<string> {
  return new Set(dismissed.map((d) => dismissalKey(d.signature, d.sourceSignature)));
}

function dismissedDraftText(signature: string, sectionKey: string, op: ProposedUpdate['op']): string | undefined {
  const prefix = `${sectionKey} | ${op} | `;
  return signature.startsWith(prefix) ? signature.slice(prefix.length) : undefined;
}

function wasDismissed(
  dismissed: DismissedSignature[],
  dismissedKeys: Set<string>,
  sectionKey: string,
  op: ProposedUpdate['op'],
  item: ClientMapItem,
  sourceSignature: string,
): boolean {
  const signature = proposalSignature(sectionKey, op, item.text);
  if (dismissedKeys.has(dismissalKey(signature, sourceSignature))) return true;
  return dismissed.some((dismissal) => {
    if (dismissal.sourceSignature !== sourceSignature) return false;
    const dismissedText = dismissedDraftText(dismissal.signature, sectionKey, op);
    return dismissedText !== undefined && areNearDuplicateFacts(dismissedText, item.text);
  });
}

/** The sourceSignature recorded for a proposal. For a sourced item it is the set
 *  of its citation ids; for a source-less AI assumption it falls back to the
 *  matter's content fingerprint, so a dismissal of an unsourced item lifts when
 *  ANY matter content changes (not "never", which would suppress it forever). */
export function proposalSourceSignature(sources: SourceRef[], matterFingerprint: string): string {
  const own = sourceSignatureFor(sources);
  return own !== '' ? own : matterFingerprint;
}

/**
 * Compare a freshly-built map against the current one and emit add-proposals for
 * facts not already present. Suppresses any proposal the user has dismissed,
 * UNLESS that proposal's backing source has changed since the dismissal (so a
 * dismissed item does not reappear on an unrelated change — BUG-100). The
 * `matterFingerprint` (the map's current source fingerprint) backs source-less
 * AI assumptions so their dismissals are not permanent.
 */
export function proposeUpdates(
  matterId: string,
  current: ClientMap,
  built: ClientMap,
  dismissed: DismissedSignature[] = current.dismissedSignatures ?? [],
  matterFingerprint: string = current.lastSourceFingerprint,
): ProposedUpdate[] {
  const now = new Date().toISOString();
  const updates: ProposedUpdate[] = [];
  const dismissedKeys = dismissedKeySet(dismissed);

  for (const builtSec of built.sections) {
    const curSec = current.sections.find((s) => s.key === builtSec.key);
    const openSlots = Math.max(0, CLIENT_MAP_SECTION_ITEM_CAP - (curSec?.items.length ?? 0));
    if (openSlots === 0) continue;

    const candidates: ClientMapItem[] = [];
    for (const item of builtSec.items) {
      const sourceSignature = proposalSourceSignature(item.sources, matterFingerprint);
      if (sectionHasText(curSec, item.text)) continue; // already present or nearly present (incl. user-origin copies)
      // BUG-100: if the user dismissed this exact proposal AND its source has not
      // changed since, do not re-propose it. (Composite key so the same text from
      // a different source is judged independently.)
      if (wasDismissed(dismissed, dismissedKeys, builtSec.key, 'add', item, sourceSignature)) continue;
      candidates.push(item);
    }

    const selected = capGeneratedSectionItems(candidates, openSlots);
    for (const item of selected) {
      const signature = draftSignature(builtSec.key, 'add', item);
      const sourceSignature = proposalSourceSignature(item.sources, matterFingerprint);
      updates.push({
        id: `${builtSec.key}-${String(updates.length)}-${now}`,
        sectionKey: builtSec.key,
        op: 'add',
        draft: item,
        reason: 'Found in new or updated files for this client',
        createdAt: now,
        signature,
        sourceSignature,
      });
    }
  }
  // matterId is the isolation key — required for matter scoping; used by callers to associate proposals
  void matterId;
  return updates;
}

/**
 * Merge freshly-computed proposals into the existing pending tray instead of
 * replacing it wholesale (BUG-104). An un-reviewed proposal the user has not yet
 * accepted or dismissed survives the next pass; a fresh proposal that matches an
 * existing one (same signature) keeps the EXISTING entry (and its id), so an
 * in-progress edit in the tray row is not reset. Already-dismissed signatures are
 * never re-added here (proposeUpdates already filtered them, this is defense in depth).
 */
export function mergePendingUpdates(
  existing: ProposedUpdate[],
  fresh: ProposedUpdate[],
  dismissed: DismissedSignature[] = [],
): ProposedUpdate[] {
  const dismissedKeys = dismissedKeySet(dismissed);
  const sigOf = (u: ProposedUpdate): string => u.signature ?? draftSignature(u.sectionKey, u.op, u.draft);

  const merged: ProposedUpdate[] = [];
  const seen = new Set<string>();
  // Keep every existing proposal first (preserves order, id, and any edit).
  for (const u of existing) {
    merged.push(u);
    seen.add(sigOf(u));
  }
  // Add fresh proposals only when they are genuinely new and not dismissed.
  for (const u of fresh) {
    const sig = sigOf(u);
    if (seen.has(sig)) continue; // already pending — keep the existing one
    if (dismissedKeys.has(dismissalKey(sig, u.sourceSignature ?? ''))) continue;
    const draft = u.draft;
    if (
      u.op === 'add' &&
      draft !== undefined &&
      merged.some((existingUpdate) =>
        existingUpdate.op === 'add' &&
        existingUpdate.sectionKey === u.sectionKey &&
        existingUpdate.draft !== undefined &&
        areNearDuplicateFacts(existingUpdate.draft.text, draft.text),
      )
    ) {
      continue;
    }
    merged.push(u);
    seen.add(sig);
  }
  return merged;
}

/**
 * Quietly accept only the safest class of AI update: a brand-new, source-backed
 * ADD that does not duplicate text already in its target section. It never
 * accepts removals, changes, assumptions, unsourced items, or anything aimed at
 * a missing section.
 */
export function autoApplySafeAddUpdates(map: ClientMap): ClientMap {
  if (map.pendingUpdates.length === 0) return map;

  let sections = map.sections;
  const remaining: ProposedUpdate[] = [];

  for (const update of map.pendingUpdates) {
    if (!isAutoApplicableAdd({ ...map, sections }, update)) {
      remaining.push(update);
      continue;
    }

    sections = sections.map((section) =>
      section.key === update.sectionKey
        ? { ...section, items: [...section.items, update.draft] }
        : section,
    );
  }

  if (remaining.length === map.pendingUpdates.length) return map;
  return { ...map, sections, pendingUpdates: remaining };
}
