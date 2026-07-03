import { describe, expect, it, vi } from 'vitest';
import {
  agendaMarkdownFromBrief,
  fallbackAgenda,
} from '@/features/meetings/agendaExport';
import type { Provider } from '@/platform/providers/Provider';

const brief = {
  markdown:
    '# Briefing\n- Roth conversion came up last quarter\n- Client is anxious about market volatility (internal: risk tolerance mismatch)\n\n## What I am missing\n- No beneficiary designations on file',
  citations: [{ path: '/ws/H/estate.pdf', score: 0.9 }],
  generatedAt: '2026-07-02T08:02:00Z',
};

function fakeProvider(reply: string): Provider {
  return {
    getMetadata: () => ({ providerId: 'test', model: 'test-model' }),
    sendMessage: vi.fn(async () => ({ content: reply })),
  } as unknown as Provider;
}

describe('agendaMarkdownFromBrief', () => {
  it('returns the provider rewrite when the call succeeds', async () => {
    const reply =
      '## Topics to cover\n- Roth conversion options\n\n## Documents to bring\n- Latest IRA statement\n\n## Since we last met\n- We reviewed your plan in March';
    const md = await agendaMarkdownFromBrief(brief, {
      clientLabel: 'The Hendersons',
      eventTitle: 'Retirement plan review',
      matterId: 'matter_henderson_1',
      provider: fakeProvider(reply),
    });
    expect(md).toContain('## Topics to cover');
    expect(md).toContain('## Documents to bring');
    expect(md).toContain('## Since we last met');
    // Distinguishes the real provider rewrite from the fallback: the reply's
    // OWN wording ("Roth conversion options") only appears if the provider
    // path actually ran, not the fallback (which would say "came up last
    // quarter" instead — the brief's own bullet text).
    expect(md).toContain('Roth conversion options');
    expect(md).not.toContain('Roth conversion came up last quarter');
  });

  it('rejects a provider reply missing the required sections and falls back', async () => {
    const md = await agendaMarkdownFromBrief(brief, {
      clientLabel: 'The Hendersons',
      eventTitle: 'Retirement plan review',
      matterId: 'matter_henderson_1',
      provider: fakeProvider('Sure! Here is a poem about agendas.'),
    });
    // Malformed rewrite -> deterministic fallback, never a hard failure.
    expect(md).toContain('## Topics to cover');
    expect(md).toContain('Roth conversion came up last quarter');
  });

  it('falls back deterministically when the provider throws', async () => {
    const boom = {
      getMetadata: () => ({ providerId: 'test', model: 'test-model' }),
      sendMessage: vi.fn(async () => {
        throw new Error('offline');
      }),
    } as unknown as Provider;
    const md = await agendaMarkdownFromBrief(brief, {
      clientLabel: 'The Hendersons',
      eventTitle: 'Retirement plan review',
      matterId: 'matter_henderson_1',
      provider: boom,
    });
    expect(md).toContain('## Topics to cover');
    expect(md).toContain('- Roth conversion came up last quarter');
  });
});

describe('fallbackAgenda', () => {
  it('lifts brief bullets into Topics and never includes gap language', () => {
    const md = fallbackAgenda(brief.markdown, 'Retirement plan review');
    expect(md).toContain('## Topics to cover');
    expect(md).toContain('- Roth conversion came up last quarter');
    // Internal sections must not leak to the client-facing artifact.
    expect(md).not.toContain('What I am missing');
    expect(md).not.toContain('beneficiary designations');
  });
});
