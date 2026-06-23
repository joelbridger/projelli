// src/platform/clientMap/generator.ts
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import type { RagHit } from '@/platform/utils/tauri-commands';
import { buildProviderForClientMap } from './provider';
import { deriveCompleteness } from './completeness';
import {
  CORE_SECTION_ORDER, CORE_SECTION_TITLE, sourceRefFromRagHit, emptyClientMap,
} from './types';
import type { ClientMap, ClientMapItem, ClientMapSection, CoreSectionKey } from './types';

const SECTION_QUERIES: Record<CoreSectionKey, string> = {
  story: 'overview background what this matter is about who the client is',
  people: 'people involved parties opposing counsel judge witnesses key contacts',
  standing: 'open issues current status disputes problems loose ends',
  upcoming: 'deadlines key dates hearings filing dates court dates',
  next: 'next steps action items follow up tasks to do',
};
const ASK_QUERY = 'what key facts are still unknown or unclear about this client';
const TOP_K = 8;

interface RawItem { text: string; sourceNumbers: number[]; assumption: boolean }

function parseItems(content: string): RawItem[] {
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

function itemsFromRaw(raw: RawItem[], hits: RagHit[]): ClientMapItem[] {
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

const sectionPrompt = (title: string, ctx: string) =>
  `You are a private legal assistant building a client profile section: "${title}".
${ctx}
Return ONLY JSON (no fences): {"items":[{"text":"one short factual sentence","sourceNumbers":[1],"assumption":false}]}.
Rules: base every item ONLY on the context; cite the [N] numbers that support it in sourceNumbers; if you must infer without a source, set assumption true and sourceNumbers []; under 20 words each; no em dashes; empty items array if nothing applies.`;

export async function buildClientMap(
  matterId: string,
  options?: { signal?: AbortSignal },
): Promise<ClientMap> {
  if (!isMemoryEnabled()) return { ...emptyClientMap(matterId), lastBuiltAt: new Date().toISOString() };
  const scope = { kind: 'matter' as const, matterId };

  // Retrieve per section first; if everything is empty, short-circuit.
  const perSection = await Promise.all(
    CORE_SECTION_ORDER.map(async (key) => ({ key, hits: await MemoryService.retrieve(SECTION_QUERIES[key], TOP_K, scope, false) })),
  );
  const askHits = await MemoryService.retrieve(ASK_QUERY, TOP_K, scope, false);
  const anyContent = perSection.some((p) => p.hits.length > 0) || askHits.length > 0;
  if (!anyContent || options?.signal?.aborted) {
    return { ...emptyClientMap(matterId), lastBuiltAt: new Date().toISOString() };
  }

  const provider = await buildProviderForClientMap();
  const sections: ClientMapSection[] = [];
  for (const { key, hits } of perSection) {
    if (hits.length === 0) { sections.push({ id: key, kind: 'core', key, title: CORE_SECTION_TITLE[key], items: [] }); continue; }
    const ctx = buildWorkspaceContextBlock(hits);
    const res = await provider.sendMessage('Build this section.', { systemPrompt: sectionPrompt(CORE_SECTION_TITLE[key], ctx), maxTokens: 500 });
    sections.push({ id: key, kind: 'core', key, title: CORE_SECTION_TITLE[key], items: itemsFromRaw(parseItems(res.content), hits) });
  }

  // Gap questions for Context Completeness.
  let ask: string[] = [];
  if (askHits.length > 0) {
    const ctx = buildWorkspaceContextBlock(askHits);
    const res = await provider.sendMessage('List the gaps.', {
      systemPrompt: `Given this client context, list up to 5 short questions whose answers are missing and that you would need to ask the client. ${ctx} Return ONLY JSON (no fences): {"questions":["..."]}. No em dashes.`,
      maxTokens: 300,
    });
    try {
      const parsed = JSON.parse(res.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()) as { questions?: unknown };
      if (Array.isArray(parsed.questions)) ask = parsed.questions.filter((q): q is string => typeof q === 'string').slice(0, 5);
    } catch { ask = []; }
  }

  return {
    matterId,
    sections,
    completeness: deriveCompleteness(sections, ask),
    pendingUpdates: [],
    lastBuiltAt: new Date().toISOString(),
    lastSourceFingerprint: '',
  };
}
