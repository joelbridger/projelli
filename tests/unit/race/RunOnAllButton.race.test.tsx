/**
 * QA-59 (P2) — RunOnAllButton stale contradiction-analysis guard.
 *
 * "Run on all" sets results, then fires a slower contradiction analysis. If the
 * user starts a SECOND comparison before the first analysis returns, the first
 * analysis must NOT attach to the second comparison's results.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { RunOnAllButton } from '@/features/ask/chat/RunOnAllButton';
import type { Provider, ProviderResponse } from '@/platform/providers/Provider';
import type { ContradictionAnalysis } from '@/platform/analysis/ContradictionDetector';
import { useSettingsStore } from '@/platform/settings/settingsStore';

vi.mock('@/platform/privacy/localOnlyGuard', async (orig) => {
  const real = await orig<typeof import('@/platform/privacy/localOnlyGuard')>();
  return {
    ...real,
    assertCloudGenerationAllowed: vi.fn(),
    assertLocalOnlyAllowsSend: vi.fn(),
    assertLocalOnlyAllowsExternal: vi.fn(),
    isLocalOnlyModeFailClosed: vi.fn(() => false),
  };
});

const mockDetect = vi.fn();
vi.mock('@/platform/analysis/ContradictionDetector', async (orig) => {
  const real = await orig<typeof import('@/platform/analysis/ContradictionDetector')>();
  return {
    ...real,
    // Must be a real function (not an arrow) — the component calls it with `new`.
    ContradictionDetector: vi.fn(function () { return { detect: mockDetect }; }),
  };
});

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function makeProvider(id: string): Provider {
  return {
    getMetadata: () => ({ providerId: id, model: `${id}-model` }),
    sendMessage: vi.fn(async () => ({
      content: `hello from ${id}`,
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      cost: 0.001,
      latency: 5,
      model: `${id}-model`,
    } as ProviderResponse)) as Provider['sendMessage'],
    structuredOutput: vi.fn(async () => ({})) as unknown as Provider['structuredOutput'],
    formatAttachmentForRequest: vi.fn() as unknown as Provider['formatAttachmentForRequest'],
    supportsAttachment: vi.fn(() => true) as Provider['supportsAttachment'],
  };
}

function analysisWith(explanation: string): ContradictionAnalysis {
  return {
    contradictions: [
      {
        id: 'c1',
        type: 'factual',
        severity: 'major',
        statement1: { source: 'Claude', text: 's1' },
        statement2: { source: 'OpenAI', text: 's2' },
        explanation,
      },
    ],
    agreementScore: 0.5,
    keyAgreements: [],
    keyDisagreements: [],
  } as ContradictionAnalysis;
}

beforeEach(() => {
  mockDetect.mockReset();
  useSettingsStore.setState({ values: {} } as never);
});

describe('RunOnAllButton — QA-59 stale contradiction-analysis isolation', () => {
  it('does not attach comparison 1\'s late analysis to comparison 2', async () => {
    const firstDetect = deferred<ContradictionAnalysis>();
    let call = 0;
    mockDetect.mockImplementation(() => {
      call += 1;
      return call === 1 ? firstDetect.promise : Promise.resolve(analysisWith('RUN-2-ANALYSIS'));
    });

    const claude = makeProvider('claude');
    const openai = makeProvider('openai');
    const judge = makeProvider('judge');

    render(
      <RunOnAllButton
        tier="professional"
        providers={[
          { id: 'claude', label: 'Claude', provider: claude },
          { id: 'openai', label: 'OpenAI', provider: openai },
        ]}
        prompt="compare please"
        analysisProvider={judge}
      />,
    );

    // Comparison 1.
    fireEvent.click(screen.getByTestId('run-on-all-button'));
    await waitFor(() => expect(screen.getByTestId('run-on-all-panel')).toBeInTheDocument());

    // Comparison 2 (its analysis resolves immediately).
    fireEvent.click(screen.getByTestId('run-on-all-button'));
    await waitFor(() => expect(screen.getByText('RUN-2-ANALYSIS')).toBeInTheDocument());

    // Comparison 1's analysis resolves LATE.
    await act(async () => {
      firstDetect.resolve(analysisWith('RUN-1-ANALYSIS'));
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale analysis must not overwrite comparison 2's.
    expect(screen.queryByText('RUN-1-ANALYSIS')).toBeNull();
    expect(screen.getByText('RUN-2-ANALYSIS')).toBeInTheDocument();
  });
});
