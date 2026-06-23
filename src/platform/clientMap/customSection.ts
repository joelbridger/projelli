// src/platform/clientMap/customSection.ts
import { MemoryService } from '@/platform/rag/MemoryService';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import { buildProviderForClientMap } from './provider';
import { parseItems, itemsFromRaw, aiSectionPrompt } from './aiSection';
import type { ClientMapSection } from './types';

export async function buildCustomSection(
  matterId: string,
  sectionId: string,
  title: string,
  prompt: string,
): Promise<ClientMapSection> {
  const hits = await MemoryService.retrieve(prompt, 8, { kind: 'matter', matterId }, false);
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
  const provider = await buildProviderForClientMap();
  const res = await provider.sendMessage('Build this section.', {
    systemPrompt: aiSectionPrompt(title, buildWorkspaceContextBlock(hits)),
    maxTokens: 500,
  });
  return { ...base, items: itemsFromRaw(parseItems(res.content), hits) };
}
