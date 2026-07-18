/**
 * QA-90 — zero retrieval hits WHILE a content import (email/CRM/OneDrive/file
 * indexing) is actively running is ambiguous: it could mean "nothing about
 * this exists" or it could just mean "not indexed yet." An adversarial review
 * found that Ask was answering the generic way either time — during a demo,
 * that reads as a broken/incomplete product rather than "still importing."
 *
 * These tests drive the REAL Ask pipeline (useAsk.handleAsk), mocking only
 * retrieval, the AI provider, and useStillImporting (mirrors
 * bug016-ask-grounding.test.tsx's scaffolding). They pin down:
 *   1. Zero hits + importing → the deterministic STILL_IMPORTING_DECLINE,
 *      with NO model call at all (files-only mode).
 *   2. Same, in the default SMART mode — a confident "nothing found, here's
 *      general advice" answer would be actively misleading mid-import, so
 *      this gate applies there too, ahead of the smart-mode AI continuation.
 *   3. Zero hits + NOT importing → the existing plain NO_EVIDENCE_DECLINE
 *      (regression guard — this fix must not change the normal case).
 *   4. Hits present + importing → a normal answer, not a decline (the gate
 *      must not fire just because an import happens to be running).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Ask } from '@/features/ask/Ask';
import type { RagHit } from '@/platform/utils/tauri-commands';

const h = vi.hoisted(() => ({
  answer: { text: '' },
  retrieve: vi.fn<(...a: unknown[]) => Promise<unknown[]>>(),
  initSession: vi.fn(),
  addMessage: vi.fn(),
  sessions: {} as Record<string, unknown>,
  // Tri-state (QA-90 round 3): 'idle' | 'importing' | 'unknown'. Tests below
  // only ever need 'idle'/'importing' — 'unknown' is exercised by
  // useStillImporting's own unit tests.
  stillImporting: { value: 'idle' as 'idle' | 'importing' | 'unknown' },
}));

vi.mock('@/i18n', () => ({ default: { t: (k: string) => k } }));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
}));
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
    selector({ profession: 'legal' }),
  getProfession: () => 'legal',
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
  return {
    ...real,
    assertCloudGenerationAllowed: vi.fn(),
  };
});

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: (...args: unknown[]) => h.retrieve(...args) },
  isMemoryEnabled: () => true,
}));

// QA-90: the signal this fix is built on — stubbed so each test controls it
// directly instead of standing up real Tauri events/backend state. Keeps the
// REAL isImportStatusUnsettled (SourcePanel/useAsk both call it) so this mock
// can't drift from the tri-state contract those consumers actually use.
vi.mock('@/features/ask/useStillImporting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/ask/useStillImporting')>();
  return {
    ...actual,
    useStillImporting: () => h.stillImporting.value,
  };
});

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
  const hook = (selector: (s: unknown) => unknown) =>
    selector({ initSession: h.initSession, setSessionWorkspaceRoot: () => undefined, addMessage: h.addMessage, sessions: h.sessions });
  hook.getState = () => ({ initSession: h.initSession, setSessionWorkspaceRoot: () => undefined, addMessage: h.addMessage, sessions: h.sessions });
  return {
    useAIChatStore: hook,
    useFileAccessConsent: () => ({ state: 'granted', grantedScope: { kind: 'allMatters' } }),
    getFileAccessConsent: () => ({ state: 'granted', grantedScope: { kind: 'allMatters' } }),
  };
});

async function ask(question: string) {
  render(<Ask />);
  const input = screen.getByTestId('ask-composer-input');
  fireEvent.change(input, { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
}

describe('QA-90 — still-importing decline on zero hits', () => {
  beforeEach(() => {
    h.retrieve.mockReset();
    h.initSession.mockReset();
    h.addMessage.mockReset();
    h.answer.text = '';
    h.stillImporting.value = 'idle';
    localStorage.removeItem('lantern:ask-files-only');
  });
  afterEach(() => {
    localStorage.removeItem('lantern:ask-files-only');
  });

  it('files-only: zero hits + importing → the still-importing decline, no model call', async () => {
    localStorage.setItem('lantern:ask-files-only', '1');
    h.retrieve.mockResolvedValue([]);
    h.stillImporting.value = 'importing';
    // If the gate failed to short-circuit, this fabricated text would appear.
    h.answer.text = 'A confident but made-up answer.';

    await ask('What is the current retainer balance?');

    await waitFor(() => {
      expect(screen.getByText(/still importing your files and email/i)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('A confident but made-up answer.');
    expect(document.body.textContent).not.toContain("I couldn't find anything about that in your documents.");
    // The calm "this may just not be in yet" note, not the alarming red
    // "not cited, verify this" warning (this decline is deliberate, not an
    // uncited claim).
    expect(screen.getByTestId('ask-still-importing-decline-note')).toBeInTheDocument();
    expect(screen.queryByTestId('ask-uncited-warning')).not.toBeInTheDocument();
  });

  it('smart mode (default): zero hits + importing → the still-importing decline, no model call', async () => {
    h.retrieve.mockResolvedValue([]);
    h.stillImporting.value = 'importing';
    h.answer.text = 'A confident but made-up general answer.';

    await ask('What is the current retainer balance?');

    await waitFor(() => {
      expect(screen.getByText(/still importing your files and email/i)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('A confident but made-up general answer.');
    expect(screen.getByTestId('ask-still-importing-decline-note')).toBeInTheDocument();
    expect(screen.queryByTestId('ask-uncited-warning')).not.toBeInTheDocument();
  });

  it('regression: zero hits + NOT importing (files-only) → the plain no-evidence decline, unchanged', async () => {
    localStorage.setItem('lantern:ask-files-only', '1');
    h.retrieve.mockResolvedValue([]);
    h.stillImporting.value = 'idle';

    await ask('What is the current retainer balance?');

    await waitFor(() => {
      expect(screen.getByTestId('ask-decline-note')).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('still importing your files and email');
  });

  it('does not decline when hits ARE found, even while importing', async () => {
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
    h.stillImporting.value = 'importing';
    h.answer.text = 'The Garcia matter concerns a slip-and-fall [garcia-complaint.docx paragraph 1].';

    await ask('What is the Garcia matter about?');

    await waitFor(() => {
      expect(document.body.textContent).toContain('The Garcia matter concerns a slip-and-fall');
    });
    expect(document.body.textContent).not.toContain('still importing your files and email');
  });
});
