// tests/unit/meetings/agendaExport.test.ts
//
// Trust-fixes finding #1: agendaMarkdownFromBrief logged a model_call audit
// entry only AFTER a successful provider.sendMessage, with no egress record
// at all. A timeout/error before that point (the common case, since this
// function silently degrades to a deterministic fallback) left the Activity
// Log with no trace that the client's brief was sent to a cloud provider.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Provider } from '@/platform/providers/Provider';
import { AuditService } from '@/platform/audit/AuditService';
import { agendaMarkdownFromBrief, fallbackAgenda } from '@/features/meetings/agendaExport';

vi.mock('@/platform/privacy/localOnlyGuard', () => ({
  assertLocalOnlyAllowsSend: vi.fn(),
}));

function fakeProvider(sendMessage: ReturnType<typeof vi.fn>): Provider {
  return {
    sendMessage,
    getMetadata: () => ({ model: 'test-model', providerId: 'anthropic' }),
  } as unknown as Provider;
}

describe('agendaMarkdownFromBrief — audit ordering', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('logs an egress audit entry BEFORE provider.sendMessage, not only after success', async () => {
    const order: string[] = [];
    const sendMessage = vi.fn().mockImplementation(() => {
      order.push('send');
      return Promise.reject(new Error('simulated timeout'));
    });
    const appendSpy = vi.spyOn(AuditService.prototype, 'append').mockImplementation((event) => {
      if (event.type === 'egress') order.push('egress-audit');
    });

    const md = await agendaMarkdownFromBrief(
      { markdown: '- Talk about the Roth conversion.' },
      { clientLabel: 'Robert Johnson', eventTitle: 'Q3 review', provider: fakeProvider(sendMessage) },
    );

    // Errors degrade to the deterministic fallback rather than throwing.
    expect(md).toBe(fallbackAgenda('- Talk about the Roth conversion.', 'Q3 review'));
    expect(order).toEqual(['egress-audit', 'send']);
    appendSpy.mockRestore();
  });

  it('still logs a model_call entry after a successful send', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      content: '## Topics to cover\n- Roth conversion\n\n## Documents to bring\n- None\n\n## Since we last met\n- Nothing new',
    });
    const logSpy = vi.spyOn(AuditService.prototype, 'log');

    await agendaMarkdownFromBrief(
      { markdown: '- Talk about the Roth conversion.' },
      { clientLabel: 'Robert Johnson', eventTitle: 'Q3 review', provider: fakeProvider(sendMessage) },
    );

    expect(logSpy).toHaveBeenCalledWith(
      'model_call',
      expect.stringContaining('Q3 review'),
      expect.any(Object),
    );
    logSpy.mockRestore();
  });
});
