// src/platform/clientMap/updater.ts
import { MemoryService } from '@/platform/rag/MemoryService';
import type { ClientMap, ClientMapItem, ClientMapSection, DismissedSignature, ProposedUpdate, SourceRef } from './types';

const BROAD_QUERY = 'client matter overview documents people dates issues';

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
  const normalized = normalizeText(text);
  return (section?.items ?? []).some((item) => normalizeText(item.text) === normalized);
}

function isAutoApplicableAdd(map: ClientMap, update: ProposedUpdate): update is ProposedUpdate & { draft: ClientMapItem } {
  if (update.op !== 'add' || update.draft === undefined) return false;
  if (update.draft.origin !== 'ai' || update.draft.isAssumption) return false;
  if (!hasStrongSource(update.draft)) return false;

  const section = map.sections.find((sec) => sec.key === update.sectionKey);
  if (!section) return false;
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
    const existingText = new Set((curSec?.items ?? []).map((i) => normalizeText(i.text)));
    for (const item of builtSec.items) {
      if (existingText.has(normalizeText(item.text))) continue; // already present (incl. user-origin copies)

      const signature = draftSignature(builtSec.key, 'add', item);
      const sourceSignature = proposalSourceSignature(item.sources, matterFingerprint);
      // BUG-100: if the user dismissed this exact proposal AND its source has not
      // changed since, do not re-propose it. (Composite key so the same text from
      // a different source is judged independently.)
      if (dismissedKeys.has(dismissalKey(signature, sourceSignature))) continue;

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
