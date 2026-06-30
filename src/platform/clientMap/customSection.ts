// src/platform/clientMap/customSection.ts
import { MemoryService } from '@/platform/rag/MemoryService';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import { filterHitsForExportConsent } from '@/platform/rag/exportConsent';
import { buildResolvedProviderForClientMap } from './provider';
import { assertLocalOnlyAllowsSend } from '@/platform/privacy/localOnlyGuard';
import { parseItems, itemsFromRaw, aiSectionPrompt } from './aiSection';
import type { ClientMapSection } from './types';

export async function buildCustomSection(
  matterId: string,
  sectionId: string,
  title: string,
  prompt: string,
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
  // Race guard (defense-in-depth; the cloud providers also fail-closed centrally):
  // re-check the mode AFTER the awaits, immediately before the send, so a custom
  // Client Map section never sends this client's context to a cloud AI in private mode.
  assertLocalOnlyAllowsSend(resolved.providerId);
  const res = await resolved.provider.sendMessage('Build this section.', {
    systemPrompt: aiSectionPrompt(title, buildWorkspaceContextBlock(hits)),
    maxTokens: 500,
  });
  return { ...base, items: itemsFromRaw(parseItems(res.content), hits) };
}
