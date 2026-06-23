// src/platform/clientMap/aiSection.ts
// Shared helpers extracted from generator.ts so customSection.ts can reuse them
// without duplication (DRY refactor — Task E1).
import type { RagHit } from '@/platform/utils/tauri-commands';
import { sourceRefFromRagHit } from './types';
import type { ClientMapItem } from './types';

export interface RawItem { text: string; sourceNumbers: number[]; assumption: boolean }

export function parseItems(content: string): RawItem[] {
  let raw = content.trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(raw) as unknown;
    const items = (parsed as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    return items
      .filter((i): i is RawItem => typeof i === 'object' && i !== null && typeof (i as RawItem).text === 'string')
      .map((i) => ({
        text: i.text,
        sourceNumbers: Array.isArray(i.sourceNumbers) ? i.sourceNumbers.filter((n) => typeof n === 'number') : [],
        assumption: (i as { assumption?: unknown }).assumption === true,
      }));
  } catch {
    return [];
  }
}

export function itemsFromRaw(raw: RawItem[], hits: RagHit[]): ClientMapItem[] {
  const now = new Date().toISOString();
  return raw.map((r, idx) => {
    const sources = r.sourceNumbers
      .map((n) => hits[n - 1])
      .filter((h): h is RagHit => h !== undefined)
      .map(sourceRefFromRagHit);
    return {
      id: `${now}-${String(idx)}-${String(Math.round(r.text.length))}`,
      text: r.text,
      origin: 'ai' as const,
      isAssumption: sources.length === 0 ? true : r.assumption,
      sources,
      updatedAt: now,
    };
  });
}

export const aiSectionPrompt = (title: string, ctx: string): string =>
  `You are a private assistant building a client/household profile section: "${title}".\n${ctx}\nReturn ONLY JSON (no fences): {"items":[{"text":"one short factual sentence","sourceNumbers":[1],"assumption":false}]}. Cite supporting [N] numbers; if you infer without a source set assumption true and sourceNumbers []; under 20 words each; no em dashes; empty items if nothing applies.`;
