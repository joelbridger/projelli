// src/platform/clientMap/generator.ts
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import { filterHitsForExportConsent } from '@/platform/rag/exportConsent';
import { buildResolvedProviderForClientMap } from './provider';
import { deriveCompleteness } from './completeness';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import { resolveEgress } from '@/platform/privacy/egress';
import { assertLocalOnlyAllowsSend } from '@/platform/privacy/localOnlyGuard';
import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import {
  CORE_SECTION_ORDER, CORE_SECTION_TITLE, emptyClientMap,
} from './types';
import type { ClientMap, ClientMapSection, CoreSectionKey, GapQuestion } from './types';
import { parseItems, itemsFromRaw } from './aiSection';
import { capGeneratedSectionItems, dedupeAcrossSections } from './updater';
import type { AuditEntry } from '@/platform/types/audit';

// Gap questions are tagged with the section their answer belongs to so the
// Guided Interview can file the answer in the right section. Unknown / missing
// section names fall back to 'money'.
const VALID_GAP_SECTIONS = new Set<string>(CORE_SECTION_ORDER);
const DEFAULT_GAP_SECTION = 'money';
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
  household: 'household members spouse children dependents beneficiaries key contacts CPA estate attorney prior advisor life situation job change who the client is',
  goals: 'goals priorities objectives what they want retirement timeline values concerns risk tolerance risk profile',
  money: 'accounts assets liabilities net worth holdings balances custodian Schwab portfolio insurance estate documents beneficiary designations mortgage cash reserve time horizon',
  followups: 'prior advice recommendations decisions next steps follow up open items promises to do tasks rollover Roth conversion rebalancing upcoming reviews meetings deadlines key dates required minimum distributions',
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
  options?: {
    signal?: AbortSignal;
    onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  },
): Promise<ClientMap> {
  if (!isMemoryEnabled()) return { ...emptyClientMap(matterId), lastBuiltAt: new Date().toISOString() };
  const scope = { kind: 'matter' as const, matterId };

  // Retrieve per section first; if everything is empty, short-circuit.
  // Connector-access: filter recognized RightCapital/Jump exports at the
  // retrieval source when consent has not been given, so the prompt context, the
  // generated items' citations, and the "any content?" decision all use the same
  // consented set (no withheld export surfaces as a cited source).
  const perSection = await Promise.all(
    CORE_SECTION_ORDER.map(async (key) => ({ key, hits: filterHitsForExportConsent(await MemoryService.retrieve(SECTION_QUERIES[key], TOP_K, scope, false)) })),
  );
  const askHits = filterHitsForExportConsent(await MemoryService.retrieve(ASK_QUERY, TOP_K, scope, false));
  const anyContent = perSection.some((p) => p.hits.length > 0) || askHits.length > 0;
  const totalHits = perSection.reduce((sum, p) => sum + p.hits.length, 0) + askHits.length;
  const topScore = [...perSection.flatMap((p) => p.hits), ...askHits].reduce<number | null>(
    (max, hit) => (max === null ? hit.score : Math.max(max, hit.score)),
    null,
  );
  options?.onAuditLog?.(auditEventToEntry({
    type: 'retrieval_executed',
    timestamp: new Date().toISOString(),
    payload: {
      query: 'Client Map build',
      scope,
      hitCount: totalHits,
      topScore,
    },
  }));
  if (!anyContent || options?.signal?.aborted) {
    return { ...emptyClientMap(matterId), lastBuiltAt: new Date().toISOString() };
  }

  const resolvedProvider = await buildResolvedProviderForClientMap();
  const provider = resolvedProvider.provider;
  const emitAiAudit = (
    label: string,
    response: { content: string; usage?: { inputTokens?: number; outputTokens?: number }; cost?: number },
  ) => {
    const egress = resolveEgress({
      provider: resolvedProvider.providerId,
      mode: getConfidentialityMode(),
      isDemo: false,
      assuredAvailable: false,
    });
    options?.onAuditLog?.(auditEventToEntry({
      type: 'egress',
      timestamp: new Date().toISOString(),
      payload: {
        provider: egress.provider,
        model: resolvedProvider.model,
        mode: getConfidentialityMode(),
        destination: egress.destination,
        dataLeaves: egress.dataLeaves,
        scope,
      },
    }));
    options?.onAuditLog?.({
      action: 'model_call',
      description: `Client Map ${label} to ${resolvedProvider.model}`,
      model: resolvedProvider.model,
      inputs: { matterId, step: label },
      outputs: { contentLength: response.content.length },
      userDecision: 'auto',
      metadata: { feature: 'client_map', step: label },
      tokensIn: response.usage?.inputTokens ?? 0,
      tokensOut: response.usage?.outputTokens ?? 0,
      costUsd: response.cost ?? 0,
      provider: resolvedProvider.providerId,
    });
  };
  const sections: ClientMapSection[] = [];
  for (const { key, hits } of perSection) {
    if (hits.length === 0) { sections.push({ id: key, kind: 'core', key, title: CORE_SECTION_TITLE[key], items: [] }); continue; }
    const ctx = buildWorkspaceContextBlock(hits);
    // Race guard (Ask's gold pattern): re-check the CURRENT mode AFTER all awaits,
    // immediately before each send — a flip to Local-only mid-build must never
    // send this client's context to the cloud. Re-checked per section because the
    // prior section's await is itself a window for the mode to change.
    assertLocalOnlyAllowsSend(resolvedProvider.providerId);
    const res = await provider.sendMessage('Build this section.', { systemPrompt: sectionPrompt(CORE_SECTION_TITLE[key], ctx), maxTokens: 500 });
    emitAiAudit(key, res);
    sections.push({
      id: key,
      kind: 'core',
      key,
      title: CORE_SECTION_TITLE[key],
      items: capGeneratedSectionItems(itemsFromRaw(parseItems(res.content), hits)),
    });
  }

  // Gap questions for Context Completeness. Each gap carries the section its
  // answer belongs to, so the Guided Interview files the answer in the right place.
  let ask: GapQuestion[] = [];
  if (askHits.length > 0) {
    const ctx = buildWorkspaceContextBlock(askHits);
    // Same race guard immediately before the gap-questions send.
    assertLocalOnlyAllowsSend(resolvedProvider.providerId);
    const res = await provider.sendMessage('List the gap questions.', {
      systemPrompt: `Given this client context, list up to 5 short questions whose answers are missing and that you would need to ask the client. For each question name the section its answer belongs to: one of ${SECTION_NAME_LIST}. ${ctx} Return ONLY JSON (no fences): {"questions":[{"text":"...","section":"money"}]}. No em dashes.`,
      maxTokens: 400,
    });
    emitAiAudit('gap_questions', res);
    ask = parseGapQuestions(res.content);
  }

  // B6: collapse facts that surfaced in more than one section (e.g. the same fact
  // from a file source AND a CRM source on a merged client) so it shows once.
  const dedupedSections = dedupeAcrossSections(sections);

  return {
    matterId,
    sections: dedupedSections,
    completeness: deriveCompleteness(dedupedSections, ask),
    pendingUpdates: [],
    lastBuiltAt: new Date().toISOString(),
    lastSourceFingerprint: '',
  };
}
