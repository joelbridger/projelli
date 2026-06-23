// src/platform/clientMap/updater.ts
import { MemoryService } from '@/platform/rag/MemoryService';
import type { ClientMap, ProposedUpdate } from './types';

const BROAD_QUERY = 'client matter overview documents people dates issues';

export async function computeSourceFingerprint(matterId: string): Promise<string> {
  const hits = await MemoryService.retrieve(BROAD_QUERY, 200, { kind: 'matter', matterId }, false);
  const ids = Array.from(new Set(hits.map((h) => h.sourceId ?? h.path))).sort();
  return `${String(ids.length)}:${ids.join('|')}`;
}

export function proposeUpdates(matterId: string, current: ClientMap, built: ClientMap): ProposedUpdate[] {
  const now = new Date().toISOString();
  const updates: ProposedUpdate[] = [];
  for (const builtSec of built.sections) {
    const curSec = current.sections.find((s) => s.key === builtSec.key);
    const existingText = new Set((curSec?.items ?? []).map((i) => i.text.trim().toLowerCase()));
    for (const item of builtSec.items) {
      if (existingText.has(item.text.trim().toLowerCase())) continue; // already present (incl. user-origin copies)
      updates.push({
        id: `${builtSec.key}-${String(updates.length)}-${now}`,
        sectionKey: builtSec.key,
        op: 'add',
        draft: item,
        reason: 'Found in new or updated files for this client',
        createdAt: now,
      });
    }
  }
  // matterId is the isolation key — required for matter scoping; used by callers to associate proposals
  void matterId;
  return updates;
}
