// src/platform/clientMap/generator.ts
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import { buildProviderForClientMap } from './provider';
import { deriveCompleteness } from './completeness';
import {
  CORE_SECTION_ORDER, CORE_SECTION_TITLE, emptyClientMap,
} from './types';
import type { ClientMap, ClientMapSection, CoreSectionKey, GapQuestion } from './types';
import { parseItems, itemsFromRaw } from './aiSection';

// Gap questions are tagged with the section their answer belongs to so the
// Guided Interview can file the answer in the right section. Unknown / missing
// section names fall back to 'standing'.
const VALID_GAP_SECTIONS = new Set<string>(CORE_SECTION_ORDER);
const DEFAULT_GAP_SECTION = 'standing';
const SECTION_NAME_LIST = CORE_SECTION_ORDER.join(', ');

/** Parse the gap-questions AI response. Accepts both the section-tagged shape
 *  ({text, section}) and a plain string list (back-compat); both are coerced to
 *  GapQuestion with a validated sectionKey. */
export function parseGapQuestions(content: string): GapQuestion[] {
  let raw = content.trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(raw) as { questions?: unknown };
    if (!Array.isArray(parsed.questions)) return [];
    const out: GapQuestion[] = [];
    for (const q of parsed.questions.slice(0, 5)) {
      if (typeof q === 'string') {
        const text = q.trim();
        if (text) out.push({ text, sectionKey: DEFAULT_GAP_SECTION });
        continue;
      }
      if (q && typeof q === 'object' && typeof (q as { text?: unknown }).text === 'string') {
        const text = (q as { text: string }).text.trim();
        if (!text) continue;
        const section = (q as { section?: unknown }).section;
        const sectionKey = typeof section === 'string' && VALID_GAP_SECTIONS.has(section) ? section : DEFAULT_GAP_SECTION;
        out.push({ text, sectionKey });
      }
    }
    return out;
  } catch {
    return [];
  }
}

const SECTION_QUERIES: Record<CoreSectionKey, string> = {
  story: 'overview background who the client is goals priorities retirement timeline objectives concerns',
  people: 'household members spouse children beneficiaries key contacts CPA estate attorney',
  standing: 'accounts assets liabilities net worth holdings custodian Schwab portfolio risk tolerance risk profile time horizon',
  upcoming: 'upcoming reviews meetings deadlines key dates next actions required minimum distributions',
  next: 'prior advice recommendations decisions Roth conversion rebalancing next steps follow up',
};
const ASK_QUERY = 'what key facts are still unknown or unclear about this client';
const TOP_K = 8;

const sectionPrompt = (title: string, ctx: string) =>
  `You are a private assistant building a client/household profile section: "${title}".
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

  // Gap questions for Context Completeness. Each gap carries the section its
  // answer belongs to, so the Guided Interview files the answer in the right place.
  let ask: GapQuestion[] = [];
  if (askHits.length > 0) {
    const ctx = buildWorkspaceContextBlock(askHits);
    const res = await provider.sendMessage('List the gap questions.', {
      systemPrompt: `Given this client context, list up to 5 short questions whose answers are missing and that you would need to ask the client. For each question name the section its answer belongs to: one of ${SECTION_NAME_LIST}. ${ctx} Return ONLY JSON (no fences): {"questions":[{"text":"...","section":"standing"}]}. No em dashes.`,
      maxTokens: 400,
    });
    ask = parseGapQuestions(res.content);
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
