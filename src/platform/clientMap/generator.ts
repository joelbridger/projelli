// src/platform/clientMap/generator.ts
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import { buildProviderForClientMap } from './provider';
import { deriveCompleteness } from './completeness';
import {
  CORE_SECTION_ORDER, CORE_SECTION_TITLE, emptyClientMap,
} from './types';
import type { ClientMap, ClientMapSection, CoreSectionKey } from './types';
import { parseItems, itemsFromRaw } from './aiSection';

const SECTION_QUERIES: Record<CoreSectionKey, string> = {
  story: 'overview background what this matter is about who the client is',
  people: 'people involved parties opposing counsel judge witnesses key contacts',
  standing: 'open issues current status disputes problems loose ends',
  upcoming: 'deadlines key dates hearings filing dates court dates',
  next: 'next steps action items follow up tasks to do',
};
const ASK_QUERY = 'what key facts are still unknown or unclear about this client';
const TOP_K = 8;

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
