import { describe, expect, it, vi } from 'vitest';

import {
  requestRedlineEditsWithAudit,
  type RedlineEgressAuditContext,
} from '@/features/documents/docx/redline';
import type { AuditEntry } from '@/platform/types/audit';
import type { Provider } from '@/platform/providers/Provider';
import type { DocumentJson } from '@/platform/types/docx';

function noEditProvider(): Provider {
  return {
    getMetadata: () => ({ providerId: 'openai', model: 'gpt-4o-mini' }),
    sendMessage: vi.fn(),
    structuredOutput: vi.fn(async () => ({ edits: [] })),
    formatAttachmentForRequest: vi.fn(),
    supportsAttachment: vi.fn(() => true),
  } as unknown as Provider;
}

function sampleDoc(): DocumentJson {
  return {
    body: [
      {
        kind: 'paragraph',
        styleId: 'Normal',
        inlines: [{ kind: 'run', text: 'Privileged settlement analysis.' }],
      },
    ],
    comments: [],
  };
}

describe('BUG-081 redline egress audit', () => {
  it('records egress even when the model returns no edits', async () => {
    const auditEntries: Omit<AuditEntry, 'id' | 'timestamp'>[] = [];
    const context: RedlineEgressAuditContext = {
      providerId: 'openai',
      model: 'gpt-4o-mini',
      mode: 'direct',
      fileName: 'settlement.docx',
      scope: { kind: 'matter', matterId: 'matter-123' },
      onAuditLog: (entry) => auditEntries.push(entry),
    };

    const edits = await requestRedlineEditsWithAudit(
      noEditProvider(),
      'tighten this',
      sampleDoc(),
      context,
    );

    expect(edits).toEqual([]);
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatchObject({
      action: 'egress',
      metadata: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        mode: 'direct',
        destination: 'provider-direct',
        dataLeaves: true,
        file: 'settlement.docx',
        feature: 'docx_redline',
        scope: { kind: 'matter', matterId: 'matter-123' },
      },
    });
  });
});
