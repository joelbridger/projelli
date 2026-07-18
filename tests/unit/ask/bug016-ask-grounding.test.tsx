/**
 * BUG-016 — Ask must not fabricate a confident answer + fake citation for
 * content that isn't in the indexed corpus.
 *
 * Repro (real Windows, 2026-06-20): Documents scope, ask about a made-up
 * entity "PURPLEWHALE" → the model answered "$2,700,000 … filed March 21,
 * 2023" with a citation chip "1" pointing at a fabricated source
 * "PURPLEWHALE Settlement Filing", under the green banner "Answered over your
 * own files." The Verify button was disabled (the fake citation has no real
 * id), so the user couldn't even check the claim the banner said was checkable.
 *
 * These tests drive the REAL Ask pipeline (useAsk.handleAsk + the real
 * workspaceCommand citation helpers). Only retrieval (MemoryService) and the
 * AI provider are mocked. The provider is deliberately made to MISBEHAVE
 * (return a fabricated answer) so we prove the grounding safety net holds even
 * when the model hallucinates.
 *
 * Ask-smart note: this suite runs in FILES-ONLY mode (the strict, cited-or-
 * decline lock, set via localStorage in beforeEach). That is exactly the mode
 * whose contract is "answer only from the files or decline" — so the original
 * BUG-016 guarantees are tested verbatim. The new SMART-mode behaviour (the
 * source-aware agent that, on empty retrieval, leads with a nothing-found block
 * and clearly-labelled general help — never a green, fake-cited claim) is
 * covered separately in `ask-smart-agent.test.tsx`.
 *
 * Behaviour we require (files-only):
 *   1. Indexing on but retrieval empty → DECLINE before calling the model
 *      (no fabricated figure, no banner, uncited state).
 *   2. Model cites a source that wasn't retrieved → that citation is DROPPED
 *      (no chip, no fabricated source title, no "Answered over your own files"
 *      banner, uncited state shown).
 *   3. Regression guard: a real answer that cites a genuinely retrieved file
 *      still renders its chip + the green attestation after the live verifier
 *      confirms it (no over-tightening, no free green badge).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Ask } from '@/features/ask/Ask';
import { reconstructTurns } from '@/features/ask/askHelpers';
import { resetCitationVerificationForTests } from '@/features/ask/citationVerification';
import type { ChatMessage } from '@/platform/types/ai';
import type { RagHit } from '@/platform/utils/tauri-commands';

// Shared mutable mock state. vi.mock factories are hoisted above all module
// init, so anything a factory touches eagerly must come from vi.hoisted.
const h = vi.hoisted(() => ({
  answer: { text: '' },              // the (possibly fabricated) model answer
  retrieve: vi.fn<(...a: unknown[]) => Promise<unknown[]>>(),
  initSession: vi.fn(),
  addMessage: vi.fn(),
  verifyCitations: vi.fn<(...a: unknown[]) => Promise<unknown[]>>(),
  sessions: {} as Record<string, unknown>,
}));

// Suppress i18n import errors in unit context.
vi.mock('@/i18n', () => ({ default: { t: (k: string) => k } }));

/* ----- stores / environment (mirrors reimagined-ask.test.tsx) ------------- */

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: () => null, // no active matter → all-matters scope
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
    selector({ profession: 'legal' }),
  getProfession: () => 'legal',
}));
vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: (m: unknown) => String(m),
}));
vi.mock('@/platform/matter/samples/sampleMatterDemo', () => ({
  getDemoAnswerForWorkspace: vi.fn().mockReturnValue(null),
  getDemoQuestions: vi.fn().mockReturnValue([
    'q1', 'q2', 'q3', 'q4',
  ]),
  DEMO_QUESTIONS: ['q1', 'q2', 'q3', 'q4'],
}));
vi.mock('@/platform/privacy/ui/EgressIndicator', () => ({
  EgressIndicator: () => null,
}));
vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => 'local',
  useConfidentialityMode: () => 'local',
}));
// The personal-install choice gate (Task 1.3) lives in localOnlyGuard.
// Stub assertCloudGenerationAllowed as a no-op here — these tests focus on
// grounding correctness, not on the confidentiality-choice gate itself.
vi.mock('@/platform/privacy/localOnlyGuard', async (orig) => {
  const real = await orig<typeof import('@/platform/privacy/localOnlyGuard')>();
  return {
    ...real,
    assertCloudGenerationAllowed: vi.fn(),
  };
});

/* ----- retrieval: indexing ON, hits configured per test ------------------- */

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: (...args: unknown[]) => h.retrieve(...args) },
  isMemoryEnabled: () => true,
}));

vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/utils/tauri-commands')>();
  return {
    ...actual,
    ragVerifyCitationsBatch: (...args: unknown[]): unknown => h.verifyCitations(...args),
  };
});

/* ----- AI provider: returns a configurable (possibly fabricated) answer ---- */

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

// Keychain returns an Anthropic key so buildProviderAsync builds the (stubbed) cloud provider.
vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: vi.fn().mockImplementation(function () {
    return {
      getKey: (p: string) => Promise.resolve(p === 'anthropic' ? 'sk-ant-test' : null),
      hasKey: (p: string) => Promise.resolve(p === 'anthropic'),
    };
  }),
}));

/* ----- chat store (hook + getState, mirrors reimagined-ask.test.tsx) ------- */

vi.mock('@/platform/state/aiChatStore', () => {
  const hook = (selector: (s: unknown) => unknown) =>
    selector({ initSession: h.initSession, setSessionWorkspaceRoot: () => undefined, addMessage: h.addMessage, sessions: h.sessions });
  hook.getState = () => ({ initSession: h.initSession, setSessionWorkspaceRoot: () => undefined, addMessage: h.addMessage, sessions: h.sessions });
  return {
    useAIChatStore: hook,
    // F2.5 — Ask reads per-conversation file-access consent; granted (all-clients)
    // here so these tests still exercise the consented retrieval path.
    useFileAccessConsent: () => ({ state: "granted", grantedScope: { kind: "allMatters" } }),
    getFileAccessConsent: () => ({ state: "granted", grantedScope: { kind: "allMatters" } }),
  };
});

/* -------------------------------------------------------------------------- */

async function ask(question: string) {
  render(<Ask />);
  const input = screen.getByTestId('ask-composer-input');
  fireEvent.change(input, { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
}

describe('BUG-016 — Ask grounding', () => {
  beforeEach(() => {
    resetCitationVerificationForTests();
    h.retrieve.mockReset();
    h.initSession.mockReset();
    h.addMessage.mockReset();
    h.verifyCitations.mockReset();
    h.answer.text = '';
    h.retrieve.mockResolvedValue([]);
    h.verifyCitations.mockImplementation((...args: unknown[]) => {
      const citations = Array.isArray(args[0]) ? args[0] : [];
      return Promise.resolve(citations.map(() => ({ verdict: 'verified' })));
    });
    // Pin Files-only mode: this suite tests the strict cited-or-decline grounding
    // net, which is exactly Files-only mode's contract. (Smart mode is the
    // default and is covered in ask-smart-agent.test.tsx.)
    localStorage.setItem('lantern:ask-files-only', '1');
  });
  afterEach(() => {
    localStorage.removeItem('lantern:ask-files-only');
  });

  it('declines (no fabricated figure, no banner) when retrieval is empty', async () => {
    h.retrieve.mockResolvedValue([]);
    // Model would fabricate if we let it — but with no evidence we must not call it.
    h.answer.text =
      'The PURPLEWHALE settlement amount is $2,700,000 [PURPLEWHALE Settlement Filing paragraph 1]. It was filed March 21, 2023.';

    await ask('What is the PURPLEWHALE settlement amount and when was it filed?');

    await waitFor(() => {
      // A deliberate "I couldn't find that in your files" decline gets the calm
      // "this is on purpose" note, NOT the red "verify this" uncited warning — a
      // correct refusal is the trust behaviour working, not a weak answer.
      expect(screen.getByTestId('ask-decline-note')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ask-uncited-warning')).not.toBeInTheDocument();
    // No green "Answered over your own files" banner.
    expect(screen.queryByTestId('ask-cited-attestation')).not.toBeInTheDocument();
    // No fabricated figure anywhere on screen.
    expect(document.body.textContent).not.toContain('$2,700,000');
    expect(document.body.textContent).not.toContain('PURPLEWHALE Settlement Filing');
    // No citation chip.
    expect(screen.queryByTestId('ask-citation-chip-1')).not.toBeInTheDocument();
  });

  it('drops a citation that points at a source which was not retrieved', async () => {
    // A genuinely relevant chunk is retrieved (high score), but the model cites
    // a DIFFERENT, non-existent file. That fabricated citation must be dropped.
    h.retrieve.mockResolvedValue([
      {
        path: '/ws/garcia-complaint.docx',
        chunkText: 'The Garcia matter concerns a slip-and-fall at a Meridian property.',
        score: 0.92,
        paragraphIndex: 0,
        id: 'chunk-real',
        matterId: 'matter-1',
        sourceType: 'docx',
      } as RagHit,
    ]);
    h.answer.text =
      'The PURPLEWHALE settlement amount is $2,700,000 [PURPLEWHALE Settlement Filing paragraph 1].';

    await ask('What is the PURPLEWHALE settlement amount?');

    await waitFor(() => {
      expect(screen.getByTestId('ask-uncited-warning')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ask-cited-attestation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ask-citation-chip-1')).not.toBeInTheDocument();
    // The fabricated source title must not be presented as a citation.
    expect(document.body.textContent).not.toContain('PURPLEWHALE Settlement Filing');
  });

  it('regression guard: keeps a real citation to a retrieved file + shows the green attestation', async () => {
    h.retrieve.mockResolvedValue([
      {
        path: '/ws/geico-demand.docx',
        chunkText: 'GEICO tendered its policy limit of $100.65 in response to the demand.',
        score: 0.93,
        paragraphIndex: 2,
        id: 'chunk-geico',
        matterId: 'matter-1',
        sourceType: 'docx',
      } as RagHit,
    ]);
    h.answer.text = 'GEICO tendered its policy limit of $100.65 [geico-demand.docx paragraph 2].';

    await ask('What did GEICO tender?');

    await waitFor(() => {
      expect(screen.getByTestId('ask-cited-attestation')).toBeInTheDocument();
    });
    // Real cited answer: no uncited warning, the real figure is preserved, chip renders.
    expect(screen.queryByTestId('ask-uncited-warning')).not.toBeInTheDocument();
    expect(document.body.textContent).toContain('$100.65');
    expect(screen.getByTestId('ask-citation-chip-1')).toBeInTheDocument();
  });

  it('drops a citation to a REAL file at a paragraph that was not retrieved (no laundering a fabricated claim)', async () => {
    // A real retrieved file, but the model attaches a fabricated figure to a
    // paragraph (99) that was never in the context. A real filename must not be
    // able to launder a fabricated claim into a green, "verifiable" citation.
    h.retrieve.mockResolvedValue([
      {
        path: '/ws/garcia-complaint.docx',
        chunkText: 'The Garcia matter concerns a slip-and-fall at a Meridian property.',
        score: 0.92,
        paragraphIndex: 0,
        id: 'chunk-real',
        matterId: 'matter-1',
        sourceType: 'docx',
      } as RagHit,
    ]);
    h.answer.text = 'The settlement was $2,700,000 [garcia-complaint.docx paragraph 99].';

    await ask('What was the settlement?');

    await waitFor(() => {
      expect(screen.getByTestId('ask-uncited-warning')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ask-cited-attestation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ask-citation-chip-1')).not.toBeInTheDocument();
  });

  it('keeps a PDF citation written as "page N" (matches a retrieved chunk pageNumber)', async () => {
    h.retrieve.mockResolvedValue([
      {
        path: '/ws/filing.pdf',
        chunkText: 'The award totaled $73,250 as of November 3, 2026.',
        score: 0.93,
        paragraphIndex: 0,
        pageNumber: 2,
        id: 'chunk-pdf',
        matterId: 'matter-1',
        sourceType: 'pdf',
      } as RagHit,
    ]);
    h.answer.text = 'The award totaled $73,250 [filing.pdf page 2].';

    await ask('What was the award?');

    await waitFor(() => {
      expect(screen.getByTestId('ask-cited-attestation')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ask-uncited-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('ask-citation-chip-1')).toBeInTheDocument();
    expect(document.body.textContent).toContain('$73,250');
  });

  it('grounds a PDF citation even when the model writes "paragraph N" for a page-numbered source', async () => {
    h.retrieve.mockResolvedValue([
      {
        path: '/ws/filing.pdf',
        chunkText: 'The award totaled $73,250.',
        score: 0.93,
        paragraphIndex: 0,
        pageNumber: 2,
        id: 'chunk-pdf2',
        matterId: 'matter-1',
        sourceType: 'pdf',
      } as RagHit,
    ]);
    h.answer.text = 'The award totaled $73,250 [filing.pdf paragraph 2].';

    await ask('award?');

    await waitFor(() => {
      expect(screen.getByTestId('ask-cited-attestation')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ask-citation-chip-1')).toBeInTheDocument();
  });
});

describe('BUG-016 — reconstructTurns drops stale ungrounded citations on reload', () => {
  it('filters a persisted ungrounded citation and restores the answer as uncited', () => {
    const messages = [
      { role: 'user', content: 'What is the PURPLEWHALE settlement?', timestamp: 't' },
      {
        role: 'assistant',
        content: 'It is $2,700,000 {1}.',
        timestamp: 't',
        askCitations: [
          { n: 1, label: 'PURPLEWHALE Settlement Filing', excerpt: '', path: null, locator: 'x', verified: false },
        ],
        askSources: [],
      },
    ] as unknown as ChatMessage[];

    const turns = reconstructTurns(messages);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.citations).toHaveLength(0);
    expect(turns[0]!.answer).not.toContain('{1}');
    expect(turns[0]!.answer).not.toContain('PURPLEWHALE Settlement Filing');
  });

  it('keeps a persisted citation that re-grounds to a saved source at the exact locator', () => {
    const messages = [
      { role: 'user', content: 'fee?', timestamp: 't' },
      {
        role: 'assistant',
        content: 'The fee is $350/hr {1}.',
        timestamp: 't',
        askCitations: [
          { n: 1, label: 'fee.docx', excerpt: 'fee $350/hr', path: '/ws/fee.docx', locator: 'fee.docx §2', verified: true, paragraphIndex: 2, id: 'c1', matterId: 'm1' },
        ],
        askSources: [
          { path: '/ws/fee.docx', chunkText: 'fee $350/hr', score: 0.9, paragraphIndex: 2, id: 'c1', matterId: 'm1' },
        ],
      },
    ] as unknown as ChatMessage[];

    const turns = reconstructTurns(messages);
    expect(turns[0]!.citations).toHaveLength(1);
    expect(turns[0]!.answer).toContain('{1}');
  });

  it('downgrades a persisted FILES block to general on reload when its citation no longer re-grounds', () => {
    // A smart-mode turn saved with a files block + a citation, but the saved
    // sources no longer prove the locator → the block must lose its green
    // "From your files" label rather than render empty-but-green.
    const messages = [
      { role: 'user', content: 'settlement?', timestamp: 't' },
      {
        role: 'assistant',
        content: 'It settled for $2,700,000 {1}.',
        timestamp: 't',
        askBlocks: [{ kind: 'files', text: 'It settled for $2,700,000 {1}.' }],
        askCitations: [
          { n: 1, label: 'ghost.docx', excerpt: 'x', path: '/ws/ghost.docx', locator: 'ghost.docx §9', verified: true, paragraphIndex: 9, id: 'g', matterId: 'm' },
        ],
        askSources: [], // nothing proves the citation anymore
      },
    ] as unknown as ChatMessage[];

    const turns = reconstructTurns(messages);
    expect(turns[0]!.blocks).toHaveLength(1);
    expect(turns[0]!.blocks![0]!.kind).toBe('general');
    expect(turns[0]!.citations).toHaveLength(0);
    expect(turns[0]!.blocks![0]!.text).not.toContain('{1}');
  });

  it('downgrades a persisted FILES block on reload when its citation was originally unverified (cross-matter)', () => {
    // The citation exact-locator-matches a saved source (so BUG-065 would flip it
    // back to verified for the flat path), but it was persisted verified:false
    // (cross-matter). The smart block path must respect the original flag and NOT
    // restore a green "From your files" label over an out-of-matter citation.
    const messages = [
      { role: 'user', content: 'cross-matter?', timestamp: 't' },
      {
        role: 'assistant',
        content: 'Other client fact {1}.',
        timestamp: 't',
        askBlocks: [{ kind: 'files', text: 'Other client fact {1}.' }],
        askCitations: [
          { n: 1, label: 'other.docx', excerpt: 'x', path: '/ws/other.docx', locator: 'other.docx §1', verified: false, paragraphIndex: 1, id: 'o', matterId: 'other-matter' },
        ],
        askSources: [
          { path: '/ws/other.docx', chunkText: 'x', score: 0.9, paragraphIndex: 1, id: 'o', matterId: 'other-matter' },
        ],
      },
    ] as unknown as ChatMessage[];

    const turns = reconstructTurns(messages);
    expect(turns[0]!.blocks![0]!.kind).toBe('general');
    expect(turns[0]!.citations).toHaveLength(0);
  });

  it('keeps a persisted FILES block green when its citation still re-grounds', () => {
    const messages = [
      { role: 'user', content: 'fee?', timestamp: 't' },
      {
        role: 'assistant',
        content: 'The fee is $350/hr {1}.',
        timestamp: 't',
        askBlocks: [{ kind: 'files', text: 'The fee is $350/hr {1}.' }],
        askCitations: [
          { n: 1, label: 'fee.docx', excerpt: 'fee $350/hr', path: '/ws/fee.docx', locator: 'fee.docx §2', verified: true, paragraphIndex: 2, id: 'c1', matterId: 'm1' },
        ],
        askSources: [
          { path: '/ws/fee.docx', chunkText: 'fee $350/hr', score: 0.9, paragraphIndex: 2, id: 'c1', matterId: 'm1' },
        ],
      },
    ] as unknown as ChatMessage[];

    const turns = reconstructTurns(messages);
    expect(turns[0]!.blocks![0]!.kind).toBe('files');
    expect(turns[0]!.citations).toHaveLength(1);
    expect(turns[0]!.blocks![0]!.text).toContain('{1}');
  });

  it('drops a stale verified:true citation whose locator is NOT among the saved sources (old basename fallback)', () => {
    // The pre-fix binder could resolve a fabricated claim to a REAL file by
    // basename and persist it verified:true with a paragraph that was never
    // retrieved. Re-grounding against the saved sources must drop it on reload.
    const messages = [
      { role: 'user', content: 'settlement?', timestamp: 't' },
      {
        role: 'assistant',
        content: 'It settled for $2,700,000 {1}.',
        timestamp: 't',
        askCitations: [
          { n: 1, label: 'garcia-complaint.docx', excerpt: 'slip and fall', path: '/ws/garcia-complaint.docx', locator: 'garcia-complaint.docx §99', verified: true, paragraphIndex: 99, id: 'x', matterId: 'm' },
        ],
        askSources: [
          { path: '/ws/garcia-complaint.docx', chunkText: 'slip and fall', score: 0.9, paragraphIndex: 0, id: 'x', matterId: 'm' },
        ],
      },
    ] as unknown as ChatMessage[];

    const turns = reconstructTurns(messages);
    // Citation dropped, marker stripped → answer restores as uncited (the figure
    // stays in prose but is no longer presented as a verified, cited claim).
    expect(turns[0]!.citations).toHaveLength(0);
    expect(turns[0]!.answer).not.toContain('{1}');
  });
});
