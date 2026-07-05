// src/platform/clientMap/customSection.ts
import { MemoryService } from '@/platform/rag/MemoryService';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import { filterHitsForExportConsent } from '@/platform/rag/exportConsent';
import { buildResolvedProviderForClientMap } from './provider';
import { assertLocalOnlyAllowsSend } from '@/platform/privacy/localOnlyGuard';
import { parseItems, itemsFromRaw, aiSectionPrompt } from './aiSection';
import type { ClientMapSection } from '@/platform/clientMap/types';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import { resolveEgress } from '@/platform/privacy/egress';
import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
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
  // Race guard (defense-in-depth; the cloud providers also fail-closed centrally):
  // re-check the mode AFTER the awaits, immediately before the send, so a custom
  // Client Map section never sends this client's context to a cloud AI in private mode.
  assertLocalOnlyAllowsSend(resolved.providerId);
  // Trust-fixes finding #1: this call site had NO audit logging at all. Log
  // egress IMMEDIATELY BEFORE the send (not only after success), so a
  // timeout or provider error still leaves a record that this client's
  // context left the machine, matching generator.ts's core-section pattern.
  const egress = resolveEgress({
    provider: resolved.providerId,
    mode: getConfidentialityMode(),
    isDemo: false,
    assuredAvailable: false,
  });
  options?.onAuditLog?.(auditEventToEntry({
    type: 'egress',
    timestamp: new Date().toISOString(),
    payload: {
      provider: egress.provider,
      model: resolved.model,
      mode: getConfidentialityMode(),
      destination: egress.destination,
      dataLeaves: egress.dataLeaves,
      scope: { kind: 'matter', matterId },
    },
  }));
  const res = await resolved.provider.sendMessage('Build this section.', {
    systemPrompt: aiSectionPrompt(title, buildWorkspaceContextBlock(hits)),
    maxTokens: 500,
  });
  options?.onAuditLog?.({
    action: 'model_call',
    description: `Client Map custom section (${title}) to ${resolved.model}`,
    model: resolved.model,
    inputs: { matterId, sectionId },
    outputs: { contentLength: res.content.length },
    userDecision: 'auto',
    metadata: { feature: 'client_map', step: 'custom_section', sectionId },
    tokensIn: res.usage.inputTokens,
    tokensOut: res.usage.outputTokens,
    costUsd: res.cost,
    provider: resolved.providerId,
  });
  return { ...base, items: itemsFromRaw(parseItems(res.content), hits) };
}
