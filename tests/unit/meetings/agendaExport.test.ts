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
import type { AuditEntry } from '@/platform/types/audit';
import { agendaMarkdownFromBrief, fallbackAgenda } from '@/features/meetings/agendaExport';

vi.mock('@/platform/privacy/localOnlyGuard', () => ({
  assertLocalOnlyAllowsSend: vi.fn(),
}));

const buildResolvedProviderForGlanceMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/matter/matterAtAGlance', async () => {
  const actual = await vi.importActual<typeof import('@/platform/matter/matterAtAGlance')>(
    '@/platform/matter/matterAtAGlance',
  );
  return { ...actual, buildResolvedProviderForGlance: buildResolvedProviderForGlanceMock };
});

function fakeProvider(sendMessage: ReturnType<typeof vi.fn>): Provider {
  return {
    sendMessage,
    getMetadata: () => ({ model: 'test-model', providerId: 'anthropic' }),
  } as unknown as Provider;
}

type AuditLogArgs = Parameters<AuditService['log']>;

function fakeAuditEntry(
  action: AuditLogArgs[0],
  description: AuditLogArgs[1],
  options: AuditLogArgs[2] = {},
): AuditEntry {
  return {
    id: `audit-test-${action}`,
    timestamp: '2026-07-10T00:00:00.000Z',
    action,
    description,
    model: options.model,
    inputs: options.inputs ?? {},
    outputs: options.outputs ?? {},
    userDecision: options.userDecision,
    metadata: options.metadata ?? {},
    ...(options.tokensIn !== undefined ? { tokensIn: options.tokensIn } : {}),
    ...(options.tokensOut !== undefined ? { tokensOut: options.tokensOut } : {}),
    ...(options.costUsd !== undefined ? { costUsd: options.costUsd } : {}),
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
  };
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
    const logSpy = vi.spyOn(AuditService.prototype, 'log').mockImplementation((action, description, options) => {
      if (action === 'egress') order.push('egress-audit');
      return fakeAuditEntry(action, description, options);
    });

    const md = await agendaMarkdownFromBrief(
      { markdown: '- Talk about the Roth conversion.' },
      { clientLabel: 'Robert Johnson', eventTitle: 'Q3 review', matterId: 'matter_johnson_123', provider: fakeProvider(sendMessage) },
    );

    // Errors degrade to the deterministic fallback rather than throwing.
    expect(md).toBe(fallbackAgenda('- Talk about the Roth conversion.', 'Q3 review'));
    expect(order).toEqual(['egress-audit', 'send']);
    logSpy.mockRestore();
  });

  it('records the real resolved providerId in the egress audit for the default (non-injected) provider path', async () => {
    // codex-review catch (round 2): getMetadata().providerId is unset on the
    // real cloud providers (Claude/OpenAI/Gemini only expose name/model), so
    // the default path must use buildResolvedProviderForGlance()'s own
    // providerId, not provider.getMetadata().providerId ?? 'unknown' — else
    // every real cloud agenda export logs egress with provider: "unknown".
    const sendMessage = vi.fn().mockResolvedValue({ content: 'irrelevant, malformed on purpose' });
    buildResolvedProviderForGlanceMock.mockResolvedValue({
      provider: { sendMessage, getMetadata: () => ({ model: 'claude-sonnet-4-6' }) },
      providerId: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
    let loggedProvider: string | undefined;
    const logSpy = vi.spyOn(AuditService.prototype, 'log').mockImplementation((action, _description, options) => {
      if (action === 'egress') {
        loggedProvider = options?.metadata?.['provider'] as string | undefined;
      }
      return fakeAuditEntry(action, _description, options);
    });

    await agendaMarkdownFromBrief(
      { markdown: '- Talk about the Roth conversion.' },
      { clientLabel: 'Robert Johnson', eventTitle: 'Q3 review', matterId: 'matter_johnson_123' },
    );

    expect(loggedProvider).toBe('anthropic');
    logSpy.mockRestore();
  });

  it('includes the matter scope in the egress audit entry, so the send appears in that client\'s confidentiality report', async () => {
    // Coordinator review catch: scope was omitted entirely, so this send only
    // ever showed up in the all-matters Activity Log view — never in the
    // specific client's own confidentiality report.
    const sendMessage = vi.fn().mockResolvedValue({ content: 'irrelevant, malformed on purpose' });
    let loggedScope: unknown;
    const logSpy = vi.spyOn(AuditService.prototype, 'log').mockImplementation((action, _description, options) => {
      if (action === 'egress') {
        loggedScope = options?.metadata?.['scope'];
      }
      return fakeAuditEntry(action, _description, options);
    });

    await agendaMarkdownFromBrief(
      { markdown: '- Talk about the Roth conversion.' },
      {
        clientLabel: 'Robert Johnson',
        eventTitle: 'Q3 review',
        matterId: 'matter_johnson_123',
        provider: fakeProvider(sendMessage),
      },
    );

    expect(loggedScope).toEqual({ kind: 'matter', matterId: 'matter_johnson_123' });
    logSpy.mockRestore();
  });

  it('still logs a model_call entry after a successful send', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      content: '## Topics to cover\n- Roth conversion\n\n## Documents to bring\n- None\n\n## Since we last met\n- Nothing new',
    });
    const logSpy = vi.spyOn(AuditService.prototype, 'log');

    await agendaMarkdownFromBrief(
      { markdown: '- Talk about the Roth conversion.' },
      { clientLabel: 'Robert Johnson', eventTitle: 'Q3 review', matterId: 'matter_johnson_123', provider: fakeProvider(sendMessage) },
    );

    expect(logSpy).toHaveBeenCalledWith(
      'model_call',
      expect.stringContaining('Q3 review'),
      expect.any(Object),
    );
    logSpy.mockRestore();
  });
});
