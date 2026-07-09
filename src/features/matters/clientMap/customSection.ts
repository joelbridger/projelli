// src/platform/clientMap/customSection.ts
import { MemoryService } from '@/platform/rag/MemoryService';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import { filterHitsForExportConsent } from '@/platform/rag/exportConsent';
import { buildResolvedProviderForClientMap } from './provider';
import { parseItems, itemsFromRaw, aiSectionPrompt } from './aiSection';
import type { ClientMapSection } from '@/platform/clientMap/types';
import { sendWithEgressAudit } from '@/platform/privacy/sendWithEgressAudit';
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
  const res = await sendWithEgressAudit({
    provider: resolved.provider,
    providerId: resolved.providerId,
    model: resolved.model,
    prompt: 'Build this section.',
    options: {
      systemPrompt: aiSectionPrompt(title, buildWorkspaceContextBlock(hits)),
      maxTokens: 500,
    },
    ...(options?.onAuditLog ? { onAuditLog: options.onAuditLog } : {}),
    scope: { kind: 'matter', matterId },
    modelCall: {
      description: `Client Map custom section (${title}) to ${resolved.model}`,
      inputs: { matterId, sectionId },
      outputs: (response) => ({ contentLength: response.content.length }),
      metadata: { feature: 'client_map', step: 'custom_section', sectionId },
    },
  });
  return { ...base, items: itemsFromRaw(parseItems(res.content), hits) };
}
