// Wave 0 — imported-meeting-note visibility on the Client Map.
//
// Reuses the existing sourceProvenance recognizer (which already knows Jump
// exports by filename) instead of re-implementing recognition. Zocks content
// needs no recognizer: it arrives via the Zocks connector and is already
// tagged SourceRef.kind === 'zocks'.
import { recognizeProvenance } from '@/platform/rag/sourceProvenance';
import type { ClientMapItem, SourceRef } from './types';

/**
 * Human label for a Client Map source chip. Imported meeting notes are called
 * out by tool ("Jump meeting note", "Zocks meeting note") so an advisor can
 * see at a glance which facts came from their notetaker's exports; everything
 * else keeps the pre-Wave-0 generic labels ("email", "source").
 */
export function sourceChipLabel(source: SourceRef): string {
  const locator = source.locator != null ? ` ${source.locator}` : '';
  if (source.kind === 'zocks') return `Zocks meeting note${locator}`;
  if (source.kind === 'meeting') return `meeting${locator}`;
  if (source.kind === 'email') return `email${locator}`;
  if (source.kind === 'document') {
    const prov = recognizeProvenance({ path: source.ref, sourceType: 'document' });
    if (prov?.kind === 'meeting-note') return `${prov.toolLabel} meeting note${locator}`;
  }
  return `source${locator}`;
}

/** True when this source is an imported meeting note (Zocks connector, a
 * meeting source, or a document recognized as a notetaker export). */
export function isImportedMeetingNoteSource(source: SourceRef): boolean {
  if (source.kind === 'zocks' || source.kind === 'meeting') return true;
  if (source.kind !== 'document') return false;
  return (
    recognizeProvenance({ path: source.ref, sourceType: 'document' })?.kind === 'meeting-note'
  );
}

/** True when any of the item's cited sources is an imported meeting note. */
export function hasImportedMeetingNoteSource(item: ClientMapItem): boolean {
  return item.sources.some(isImportedMeetingNoteSource);
}
