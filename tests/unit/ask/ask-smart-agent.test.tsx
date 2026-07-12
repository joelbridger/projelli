/**
 * Ask-smart — the source-aware advisor agent.
 *
 * Ask is no longer files-only: by default it answers general questions and
 * writes drafts, while keeping the cited-trust moat by splitting every answer
 * into provenance-labelled blocks. These tests drive the REAL Ask pipeline
 * (useAsk.handleAsk + the real block binder), mocking only retrieval and the AI
 * provider (made to emit block markers).
 *
 * What we require in SMART mode (the default):
 *   1. Empty retrieval no longer dead-ends — the model is called and the answer
 *      renders a nothing-found block + a clearly-labelled general block.
 *   2. The grounding net still holds: a fabricated citation in an empty/general
 *      context never becomes a green chip or a "from your files" attestation.
 *   3. A mixed answer shows the From-your-files + General labels and the
 *      per-answer tally (cited count + "verify current rules").
 *   4. The Files-only lock reverts to the strict decline behaviour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Ask } from '@/features/ask/Ask';
import { BLOCK_MARKERS } from '@/features/ask/answerBlockMarkers';
import type { RagHit } from '@/platform/utils/tauri-commands';
import { BRAND } from '@/config/brand';

const h = vi.hoisted(() => ({
  answer: { text: '' },
  retrieve: vi.fn<(...a: unknown[]) => Promise<unknown[]>>(),
  initSession: vi.fn(),
  addMessage: vi.fn(),
  sessions: {} as Record<string, unknown>,
}));

vi.mock('@/i18n', () => ({ default: { t: (k: string) => k } }));

vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: () => null,
  SAMPLE_MATTER_ID: 'matter_sample_garcia_v_meridian',
}));
vi.mock('@/platform/fs/workspaceStore', () => {
  const wsState = { rootPath: null };
  const useWorkspaceStore = (selector: (s: { rootPath: string | null }) => unknown) => selector(wsState);
  useWorkspaceStore.getState = () => wsState;
  return { useWorkspaceStore };
});
vi.mock('@/platform/profile/professionStore', () => ({
  useProfessionStore: (selector: (s: { profession: string }) => unknown) =>
    selector({ profession: 'advisor' }),
  getProfession: () => 'advisor',
}));
vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: (m: unknown) => String(m),
}));
vi.mock('@/platform/matter/samples/sampleMatterDemo', () => ({
  getDemoAnswerForWorkspace: vi.fn().mockReturnValue(null),
  getDemoQuestions: vi.fn().mockReturnValue(['q1', 'q2', 'q3', 'q4']),
  DEMO_QUESTIONS: ['q1', 'q2', 'q3', 'q4'],
}));
vi.mock('@/platform/privacy/ui/EgressIndicator', () => ({
  EgressIndicator: () => null,
}));
vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => 'local',
  useConfidentialityMode: () => 'local',
}));
vi.mock('@/platform/privacy/localOnlyGuard', async (orig) => {
  const real = await orig<typeof import('@/platform/privacy/localOnlyGuard')>();
  return { ...real, assertCloudGenerationAllowed: vi.fn() };
});

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: (...args: unknown[]) => h.retrieve(...args) },
  isMemoryEnabled: () => true,
}));

vi.mock('@/platform/providers/ClaudeProvider', () => {
  class StubProvider {
    sendMessageStreaming(_q: string, opts: { onChunk: (c: string) => void }) {
      opts.onChunk(h.answer.text);
      return Promise.resolve({ content: h.answer.text });
    }
    getMetadata() { return { provider: 'anthropic', model: 'stub' }; }
  }
  return { ClaudeProvider: StubProvider };
});
vi.mock('@/platform/providers/OpenAIProvider', () => ({ OpenAIProvider: class {} }));
vi.mock('@/platform/providers/GeminiProvider', () => ({ GeminiProvider: class {} }));
vi.mock('@/platform/providers/OllamaProvider', () => ({ OllamaProvider: class {} }));

vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: vi.fn().mockImplementation(function () {
    return {
      getKey: (p: string) => Promise.resolve(p === 'anthropic' ? 'sk-ant-test' : null),
      hasKey: (p: string) => Promise.resolve(p === 'anthropic'),
    };
  }),
}));

vi.mock('@/platform/state/aiChatStore', () => {
  const state = { initSession: h.initSession, setSessionWorkspaceRoot: () => undefined, addMessage: h.addMessage, sessions: h.sessions };
  const hook = (selector: (s: unknown) => unknown) => selector(state);
  hook.getState = () => state;
  return {
    useAIChatStore: hook,
    // F2.5 — Ask reads per-conversation file-access consent; granted (all-clients)
    // here so these tests still exercise the consented retrieval path.
    useFileAccessConsent: () => ({ state: "granted", grantedScope: { kind: "allMatters" } }),
    getFileAccessConsent: () => ({ state: "granted", grantedScope: { kind: "allMatters" } }),
  };
});

async function ask(question: string) {
  render(<Ask />);
  const input = screen.getByTestId('ask-composer-input');
  fireEvent.change(input, { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
}

const geicoHit: RagHit = {
  path: '/ws/geico-demand.docx',
  chunkText: 'GEICO tendered its policy limit of $100.65 in response to the demand.',
  score: 0.93,
  paragraphIndex: 2,
  id: 'chunk-geico',
  matterId: 'matter-1',
  sourceType: 'docx',
};

describe('Ask-smart (source-aware advisor agent)', () => {
  beforeEach(() => {
    h.retrieve.mockReset();
    h.initSession.mockReset();
    h.addMessage.mockReset();
    h.answer.text = '';
    h.retrieve.mockResolvedValue([]);
    localStorage.removeItem('lantern:ask-files-only'); // smart by default
  });
  afterEach(() => {
    localStorage.removeItem('lantern:ask-files-only');
  });

  it('empty retrieval no longer dead-ends — it leads with nothing-found + labelled general help', async () => {
    h.retrieve.mockResolvedValue([]);
    h.answer.text = [
      BLOCK_MARKERS.nothingFound,
      "I didn't find anything in this client's files about long-term care insurance.",
      BLOCK_MARKERS.general,
      'Advisors usually weigh cash flow and family health history before choosing coverage.',
    ].join('\n');

    await ask('Should the Webbs get long-term care insurance?');

    await waitFor(() => {
      expect(screen.getByTestId('ask-block-label-nothing-found')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ask-block-label-general')).toBeInTheDocument();
    // The honest absence is shown; the general guidance is present and labelled.
    expect(document.body.textContent).toContain("didn't find anything");
    expect(document.body.textContent).toContain('cash flow');
    // It is NOT a flat refusal, and NOT a green "from your files" attestation.
    expect(screen.queryByTestId('ask-uncited-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ask-cited-attestation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ask-citation-chip-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('ask-answer-receipt').textContent).toContain(
      `0 claims verified against 0 local sources; sent direct to Anthropic; nothing to ${BRAND.name}`,
    );
    expect(screen.getByTestId('ask-answer-receipt').textContent).not.toContain(
      'source-grounded demo answer',
    );

    const assistantCalls = h.addMessage.mock.calls
      .map((c) => c[1] as { role: string; askProviderId?: string; askEgressDestination?: string })
      .filter((m) => m.role === 'assistant');
    const msg = assistantCalls[assistantCalls.length - 1]!;
    expect(msg.askProviderId).toBe('anthropic');
    expect(msg.askEgressDestination).toBe('provider-direct');
  });

  it('grounding net holds in smart mode: a fabricated citation in a general block never becomes a chip', async () => {
    h.retrieve.mockResolvedValue([]);
    h.answer.text = [
      BLOCK_MARKERS.general,
      'The PURPLEWHALE settlement amount is $2,700,000 [PURPLEWHALE Settlement Filing paragraph 1].',
    ].join('\n');

    await ask('What is the PURPLEWHALE settlement amount?');

    await waitFor(() => {
      expect(screen.getByTestId('ask-block-label-general')).toBeInTheDocument();
    });
    // No green chip and no fabricated source title presented as a citation.
    expect(screen.queryByTestId('ask-citation-chip-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ask-cited-attestation')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('PURPLEWHALE Settlement Filing');
  });

  it('a FILES block whose citation is fabricated is downgraded — no green files label, no chip', async () => {
    // A real chunk is retrieved, but the model emits a files block citing a
    // DIFFERENT, non-retrieved file. The block must downgrade to general.
    h.retrieve.mockResolvedValue([geicoHit]);
    h.answer.text = [
      BLOCK_MARKERS.files,
      'The settlement was $2,700,000 [PURPLEWHALE Settlement Filing paragraph 1].',
    ].join('\n');

    await ask('What was the settlement?');

    await waitFor(() => {
      expect(screen.getByTestId('ask-block-label-general')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ask-block-label-files')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ask-cited-attestation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ask-citation-chip-1')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('PURPLEWHALE Settlement Filing');
  });

  it('a mixed answer shows From-your-files + General labels and the per-answer tally', async () => {
    h.retrieve.mockResolvedValue([geicoHit]);
    h.answer.text = [
      BLOCK_MARKERS.files,
      'GEICO tendered its policy limit of $100.65 [geico-demand.docx paragraph 2].',
      BLOCK_MARKERS.general,
      'A policy-limit tender is often a signal to evaluate the demand quickly.',
    ].join('\n');

    await ask('What did GEICO tender and what does it mean?');

    await waitFor(() => {
      // lp/badge-consistency tri-state: with no settled verdict (jsdom never
      // verifies), the grounding label renders its 'checking' variant.
      expect(screen.getByTestId(/^ask-block-label-files(-checking)?$/)).toBeInTheDocument();
    });
    expect(screen.getByTestId('ask-block-label-general')).toBeInTheDocument();
    // Cited claim chip in the files block; tally pills below.
    expect(screen.getByTestId('ask-citation-chip-1')).toBeInTheDocument();
    expect(screen.getByTestId(/^ask-tally-(cited|checking)$/)).toBeInTheDocument();
    expect(screen.getByTestId('ask-tally-general')).toBeInTheDocument();
    expect(document.body.textContent).toContain('$100.65');
  });

  it('keeps a retrieved citation when a cloud answer mislabels file evidence as general', async () => {
    // Anthropic and OpenAI can follow the smart-answer block protocol but put a
    // file-backed statement under GENERAL. The real Ask pipeline must recover
    // the valid citation instead of silently presenting the answer as uncited.
    h.retrieve.mockResolvedValue([geicoHit]);
    h.answer.text = [
      BLOCK_MARKERS.general,
      'GEICO tendered its policy limit of $100.65 [geico-demand.docx paragraph 2].',
    ].join('\n');

    await ask('What did GEICO tender?');

    await waitFor(() => {
      expect(screen.getByTestId(/^ask-block-label-files(-checking)?$/)).toBeInTheDocument();
    });
    expect(screen.getByTestId('ask-citation-chip-1')).toBeInTheDocument();
    expect(document.body.textContent).toContain('$100.65');
  });

  it('splits a trailing general sentence out of a files block (mixed-block guard)', async () => {
    h.retrieve.mockResolvedValue([geicoHit]);
    h.answer.text = [
      BLOCK_MARKERS.files,
      'GEICO tendered its policy limit of $100.65 [geico-demand.docx paragraph 2]. ' +
        'Generally, a policy-limit tender is a signal to evaluate the demand quickly and carefully.',
    ].join('\n');

    await ask('What did GEICO tender?');

    await waitFor(() => {
      // lp/badge-consistency tri-state: with no settled verdict (jsdom never
      // verifies), the grounding label renders its 'checking' variant.
      expect(screen.getByTestId(/^ask-block-label-files(-checking)?$/)).toBeInTheDocument();
    });
    // The trailing general claim is demoted to its own general block.
    expect(screen.getByTestId('ask-block-label-general')).toBeInTheDocument();
    // The cited fact keeps its chip; the general tail has none.
    expect(screen.getByTestId('ask-citation-chip-1')).toBeInTheDocument();
    expect(document.body.textContent).toContain('$100.65');
  });

  it('does NOT persist retrieved chunks for an uncited (general) answer', async () => {
    // Retrieval runs before every smart answer; a general reply has nothing to
    // cite and must not store the raw client chunks (review P2).
    h.retrieve.mockResolvedValue([geicoHit]);
    h.answer.text = `${BLOCK_MARKERS.general}\nGenerally, a policy-limit tender is a strong settlement signal.`;

    await ask('What does a policy-limit tender mean in general?');

    await waitFor(() => {
      expect(screen.getByTestId('ask-block-label-general')).toBeInTheDocument();
    });
    // Find the persisted assistant message and assert it carries NO askSources.
    const assistantCalls = h.addMessage.mock.calls
      .map((c) => c[1] as { role: string; askSources?: unknown[]; askCitations?: unknown[]; askBlocks?: unknown[] })
      .filter((m) => m.role === 'assistant');
    expect(assistantCalls.length).toBeGreaterThan(0);
    const msg = assistantCalls[assistantCalls.length - 1]!;
    expect(msg.askSources).toBeUndefined();
    expect(msg.askCitations).toBeUndefined();
    // But the provenance labels are still persisted.
    expect(msg.askBlocks).toBeDefined();
  });

  it('Files-only lock reverts to the strict decline on empty retrieval', async () => {
    localStorage.setItem('lantern:ask-files-only', '1');
    h.retrieve.mockResolvedValue([]);
    h.answer.text = `${BLOCK_MARKERS.general}\nGeneral stuff that should never appear.`;

    await ask('Anything about a topic not in the files?');

    // Files-only empty retrieval is the strict decline — shown as the calm
    // "this is on purpose" decline note, never the smart general-help path.
    await waitFor(() => {
      expect(screen.getByTestId('ask-decline-note')).toBeInTheDocument();
    });
    // Files-only: model is not consulted for general help, so no general block.
    expect(screen.queryByTestId('ask-block-label-general')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('General stuff that should never appear');
  });
});
