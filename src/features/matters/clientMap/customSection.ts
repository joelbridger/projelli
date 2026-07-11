// src/platform/clientMap/customSection.ts
import { MemoryService } from '@/platform/rag/MemoryService';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import { filterHitsForExportConsent } from '@/platform/rag/exportConsent';
import { buildResolvedProviderForClientMap } from './provider';
import { parseItems, itemsFromRaw, aiSectionPrompt } from './aiSection';
import type { ClientMapSection } from '@/platform/clientMap/types';
import { sendPreparedMessageWithEgressAudit } from '@/platform/privacy/promptPreparation';
import type { AuditEntry } from '@/platform/types/audit';

export interface BuildCustomSectionOptions {
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
}

export async function buildCustomSection(
  matterId: string,
  sectionId: string,
  title: string,
  prompt: string,
  options?: BuildCustomSectionOptions,
): Promise<ClientMapSection> {
  // Connector-access: drop unconsented RightCapital/Jump exports at the source so
  // the prompt context and the section items' citations use the same set.
  const hits = filterHitsForExportConsent(
    await MemoryService.retrieve(prompt, 8, { kind: 'matter', matterId }, false),
  );
  const base: ClientMapSection = {
    id: sectionId,
    kind: 'custom',
    key: sectionId,
    title,
    prompt,
    scope: 'matter',
    items: [],
  };
  if (hits.length === 0) return base;
  const resolved = await buildResolvedProviderForClientMap();
  const systemPrompt = aiSectionPrompt(title, buildWorkspaceContextBlock(hits));
  const res = await sendPreparedMessageWithEgressAudit({
    provider: resolved.provider,
    providerId: resolved.providerId,
    model: resolved.model,
    prompt: 'Build this section.',
    options: {
      systemPrompt,
      maxTokens: 500,
    },
    surface: 'client_map_custom_section',
    parts: [
      // This is the text actually sent as the user prompt. The custom query
      // only selects local retrieval results; it is not cloud-bound.
      { id: 'prompt', origin: 'client_map', label: 'Custom section request', text: 'Build this section.' },
      { id: 'client-map-context', origin: 'client_map', label: 'Client Map source context', text: systemPrompt },
    ],
    ...(options?.onAuditLog ? { onAuditLog: options.onAuditLog } : {}),
    scope: { kind: 'matter', matterId },
    modelCall: (response) => ({ action: 'model_call', description: `Client Map custom section (${title}) to ${resolved.model}`, model: resolved.model, inputs: { matterId, sectionId }, outputs: { contentLength: response.content.length }, userDecision: 'auto', metadata: { feature: 'client_map', step: 'custom_section', sectionId }, tokensIn: response.usage?.inputTokens ?? 0, tokensOut: response.usage?.outputTokens ?? 0, costUsd: response.cost ?? 0, provider: resolved.providerId }),
  });
  return { ...base, items: itemsFromRaw(parseItems(res.content), hits) };
}
