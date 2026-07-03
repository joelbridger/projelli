// Wave 0 — imported-meeting-note visibility on the Client Map.
//
// Reuses the existing sourceProvenance recognizer (which already knows Jump
// exports by filename or body branding) instead of re-implementing
// recognition. Zocks content needs no recognizer: it arrives via the Zocks
// connector and is already tagged SourceRef.kind === 'zocks'.
import { recognizeProvenance } from '@/platform/rag/sourceProvenance';
import type { ClientMapItem, SourceRef } from './types';

/** Source kinds a Jump/RightCapital export can arrive as, per
 * docs/features/keep-your-notetaker.md's three recipes: a local file
 * (document), a Wealthbox-synced CRM note (crm), or a watched OneDrive/
 * SharePoint folder (onedrive). Codex-review catch: the recognizer used to
 * run only for 'document', silently missing the other two documented routes. */
const RECOGNIZABLE_KINDS = new Set<SourceRef['kind']>(['document', 'crm', 'onedrive']);

function recognizedTool(source: SourceRef): { toolLabel: string } | null {
  if (!RECOGNIZABLE_KINDS.has(source.kind)) return null;
  const prov = recognizeProvenance({
    path: source.ref,
    text: source.snippet,
    sourceType: source.kind,
  });
  return prov?.kind === 'meeting-note' ? { toolLabel: prov.toolLabel } : null;
}

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
  const tool = recognizedTool(source);
  if (tool) return `${tool.toolLabel} meeting note${locator}`;
  return `source${locator}`;
}

/** True when this source is an imported meeting note (Zocks connector, a
 * meeting source, or a document/CRM-note/OneDrive-file recognized as a
 * notetaker export). */
export function isImportedMeetingNoteSource(source: SourceRef): boolean {
  if (source.kind === 'zocks' || source.kind === 'meeting') return true;
  return recognizedTool(source) !== null;
}

/** True when any of the item's cited sources is an imported meeting note. */
export function hasImportedMeetingNoteSource(item: ClientMapItem): boolean {
  return item.sources.some(isImportedMeetingNoteSource);
}
