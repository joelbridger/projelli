/// <reference types="@testing-library/jest-dom" />

/**
 * Ch5LocalSetup tests
 *
 * Verifies the full guided local-AI state machine:
 *   needs-install → "Set it up for me" calls openExternal + enters waiting
 *   waiting (reachable-no-model) → downloading shows progress bar
 *   success → ready state with "Use local AI" button
 *   "Use local AI" calls ctx.actions.setConfidentialityMode('local-only') and fires onReady
 *   error state shows "Try again" / "Open Ollama" but NO terminal/command text
 *
 * Mocking strategy:
 *   - detectOllama: vi.mock so tests control reachability / model lists
 *   - waitForOllama / pullOllamaModel: vi.mock ollamaSetup so tests drive state transitions
 *   - openExternal: vi.mock to assert calls without opening real browser windows
 *   - clearAiSetupDeferred: vi.mock to isolate localStorage side-effects
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ChapterContext, JourneyData } from '../engine/types';

// ---------------------------------------------------------------------------
// Module mocks (hoisted — must precede imports of the module under test)
// ---------------------------------------------------------------------------

// Mock openExternal
vi.mock('@/platform/utils/openExternal', () => ({
  openExternal: vi.fn().mockResolvedValue(undefined),
}));

// Mock clearAiSetupDeferred
vi.mock('@/features/onboarding/aiSetupState', () => ({
  clearAiSetupDeferred: vi.fn(),
  markAiSetupDeferred: vi.fn(),
  hasDeferredAiSetup: vi.fn(() => false),
}));

// Mock detectOllama (used in the initial mount detect)
const mockDetectOllama = vi.fn();
vi.mock('@/platform/providers/OllamaProvider', () => ({
  detectOllama: (...args: unknown[]) => mockDetectOllama(...args),
  OLLAMA_DEFAULT_BASE_URL: 'http://127.0.0.1:11434',
  OLLAMA_DEFAULT_MODEL: 'llama3.2:3b',
}));

// Mock the ollamaSetup helpers
const mockWaitForOllama = vi.fn();
const mockPullOllamaModel = vi.fn();
vi.mock('./ollamaSetup', () => ({
  waitForOllama: (...args: unknown[]) => mockWaitForOllama(...args),
  pullOllamaModel: (...args: unknown[]) => mockPullOllamaModel(...args),
  OLLAMA_DEFAULT_BASE_URL: 'http://127.0.0.1:11434',
  OLLAMA_DEFAULT_MODEL: 'llama3.2:3b',
}));

// Mock professionStore for the Ch5ChooseYourBrain integration test (hoisted)
vi.mock('@/platform/profile/professionStore', () => ({
  useProfessionStore: vi.fn((selector: (s: { profession: string }) => unknown) =>
    selector({ profession: 'legal' }),
  ),
  getProfession: vi.fn(() => 'legal'),
}));

// Mock KeychainService for the Ch5ChooseYourBrain integration test (hoisted)
vi.mock('@/platform/providers/KeychainService', () => {
  function KeychainService() { /* stub */ }
  KeychainService.prototype.setKey = vi.fn().mockResolvedValue(undefined);
  return { KeychainService };
});

// Mock diagnostics for the Ch5ChooseYourBrain integration test (hoisted)
vi.mock('@/platform/utils/diagnostics', () => ({
  sendDiagnosticEvent: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import the module under test (after mocks are set up)
// ---------------------------------------------------------------------------
import { Ch5LocalSetup } from './Ch5LocalSetup';
import { openExternal } from '@/platform/utils/openExternal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<ChapterContext> & { data?: JourneyData } = {}): ChapterContext {
  return {
    advance: vi.fn(),
    goBack: vi.fn(),
    skipAll: vi.fn(),
    complete: vi.fn(),
    setData: vi.fn(),
    data: {},
    reducedMotion: true, // disable CSS animations in tests
    actions: {
      saveApiKey: vi.fn().mockResolvedValue(undefined),
      setConfidentialityMode: vi.fn(),
      chooseWorkspaceFolder: vi.fn().mockResolvedValue('/tmp/ws'),
    },
    ...overrides,
  };
}

function renderSetup(overrides: Partial<ChapterContext> = {}) {
  const ctx = makeCtx(overrides);
  const onBack = vi.fn();
  const onReady = vi.fn();
  const utils = render(<Ch5LocalSetup ctx={ctx} onBack={onBack} onReady={onReady} />);
  return { ctx, onBack, onReady, ...utils };
}

// ---------------------------------------------------------------------------
// Tests: checking state (initial)
// ---------------------------------------------------------------------------

describe('Ch5LocalSetup — checking state', () => {
  beforeEach(() => {
    // Keep detect pending (never resolves) so we can assert the checking state.
    mockDetectOllama.mockReturnValue(new Promise(() => { /* never resolves */ }));
  });

  it('shows "Checking your computer..." on mount', () => {
    renderSetup();
    expect(screen.getByTestId('ch5-local-checking')).toBeInTheDocument();
  });

  it('renders the ch5-local-view root', () => {
    renderSetup();
    expect(screen.getByTestId('ch5-local-view')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: needs-install state
// ---------------------------------------------------------------------------

describe('Ch5LocalSetup — needs-install state', () => {
  beforeEach(() => {
    mockDetectOllama.mockResolvedValue({ reachable: false, models: [] });
    // waitForOllama never resolves so we can assert the waiting state in a separate suite
    mockWaitForOllama.mockReturnValue(new Promise(() => { /* pending */ }));
  });

  it('shows "Let\'s set up your private AI" after detecting Ollama is missing', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByText(/Let's set up your private AI/)).toBeInTheDocument();
    });
  });

  it('shows the "Set it up for me" button', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-setup-btn')).toBeInTheDocument();
    });
  });

  it('clicking "Set it up for me" calls openExternal with the Ollama download URL', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-setup-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('ch5-local-setup-btn'));

    await waitFor(() => {
      expect(openExternal).toHaveBeenCalledWith('https://ollama.com/download');
    });
  });

  it('clicking "Set it up for me" enters waiting state', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-setup-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('ch5-local-setup-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-waiting')).toBeInTheDocument();
    });
  });

  it('shows the needs-install body copy in the header', async () => {
    renderSetup();
    await waitFor(() => {
      // The body copy appears exactly once, in the header paragraph
      const matches = screen.getAllByText(/We'll download a free AI that runs entirely on your computer/);
      expect(matches).toHaveLength(1);
    });
  });

  it('the "Other options" back button works in needs-install state', async () => {
    const { onBack } = renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-setup-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('ch5-local-back-btn'));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Tests: downloading state
// ---------------------------------------------------------------------------

describe('Ch5LocalSetup — downloading state (reachable, no model)', () => {
  beforeEach(() => {
    // Ollama reachable but no model yet
    mockDetectOllama.mockResolvedValue({ reachable: true, models: [] });
    // pullOllamaModel stays pending — we'll verify the progress bar appears
    mockPullOllamaModel.mockImplementation(
      (_model: string, opts: { onProgress: (p: { percent: number; status: string }) => void }) => {
        // Immediately call onProgress to simulate a download at 42%
        opts.onProgress({ percent: 42, status: 'downloading' });
        return new Promise(() => { /* never resolves */ });
      },
    );
  });

  it('shows a progress bar when downloading', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-progress-bar')).toBeInTheDocument();
    });
  });

  it('shows the percent value during download', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-percent')).toBeInTheDocument();
      expect(screen.getByTestId('ch5-local-percent').textContent).toContain('42');
    });
  });

  it('shows "Downloading your private AI" copy', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-downloading')).toBeInTheDocument();
    });
  });

  it('back button is disabled while downloading', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-downloading')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ch5-local-back-btn')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Tests: ready state
// ---------------------------------------------------------------------------

describe('Ch5LocalSetup — ready state', () => {
  beforeEach(() => {
    // Ollama already up with a model
    mockDetectOllama.mockResolvedValue({ reachable: true, models: ['llama3.2:3b'] });
  });

  it('shows "Your private AI is ready." when Ollama is already set up', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByText('Your private AI is ready.')).toBeInTheDocument();
    });
  });

  it('shows the "Use local AI" button in the ready state', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-use-local-btn')).toBeInTheDocument();
    });
  });

  it('clicking "Use local AI" calls ctx.actions.setConfidentialityMode("local-only")', async () => {
    const { ctx } = renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-use-local-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('ch5-use-local-btn'));
    expect(ctx.actions.setConfidentialityMode).toHaveBeenCalledWith('local-only');
  });

  it('clicking "Use local AI" calls onReady', async () => {
    const { onReady } = renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-use-local-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('ch5-use-local-btn'));
    expect(onReady).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Tests: ready state after download completes
// ---------------------------------------------------------------------------

describe('Ch5LocalSetup — ready state after download completes', () => {
  beforeEach(() => {
    // Ollama reachable but no model yet (triggers download path)
    mockDetectOllama.mockResolvedValue({ reachable: true, models: [] });
    // pullOllamaModel resolves successfully
    mockPullOllamaModel.mockResolvedValue(undefined);
  });

  it('transitions to ready state after pullOllamaModel resolves', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-use-local-btn')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: error state (triggered by pullOllamaModel failure)
// ---------------------------------------------------------------------------

describe('Ch5LocalSetup — error state', () => {
  // The error state is reached when pullOllamaModel rejects (download failure)
  // or when waitForOllama returns 'unreachable' after a timeout. A detectOllama
  // rejection on mount is treated as "needs-install" (can't reach = not installed).
  beforeEach(() => {
    // Ollama reachable but no model (triggers download path)
    mockDetectOllama.mockResolvedValue({ reachable: true, models: [] });
    // Download fails
    mockPullOllamaModel.mockRejectedValue(new Error('Connection refused'));
  });

  it('shows "Something interrupted the setup." when pull throws', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Something interrupted the setup.')).toBeInTheDocument();
  });

  it('shows "Try again" and "Open Ollama" buttons in error state', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-retry-btn')).toBeInTheDocument();
      expect(screen.getByTestId('ch5-local-open-btn')).toBeInTheDocument();
    });
  });

  it('"Try again" re-runs detect and recovers to ready if Ollama is now up', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-retry-btn')).toBeInTheDocument();
    });

    // After retry detect, Ollama is now fully ready
    mockDetectOllama.mockResolvedValue({ reachable: true, models: ['llama3.2:3b'] });
    fireEvent.click(screen.getByTestId('ch5-local-retry-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ch5-use-local-btn')).toBeInTheDocument();
    });
  });

  it('"Open Ollama" calls openExternal with the download URL', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-open-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('ch5-local-open-btn'));

    await waitFor(() => {
      expect(openExternal).toHaveBeenCalledWith('https://ollama.com/download');
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: error state when waitForOllama returns 'unreachable' (timeout)
// ---------------------------------------------------------------------------

describe('Ch5LocalSetup — error state from waitForOllama timeout', () => {
  beforeEach(() => {
    // Ollama not reachable (triggers needs-install)
    mockDetectOllama.mockResolvedValue({ reachable: false, models: [] });
    // waitForOllama eventually times out
    mockWaitForOllama.mockResolvedValue('unreachable');
  });

  it('transitions to error state when waitForOllama returns unreachable', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-setup-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('ch5-local-setup-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-error')).toBeInTheDocument();
    });
  });

  it('shows "Something interrupted the setup." on waitForOllama timeout', async () => {
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-setup-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('ch5-local-setup-btn'));

    await waitFor(() => {
      expect(screen.getByText('Something interrupted the setup.')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: no terminal commands / forbidden text
// ---------------------------------------------------------------------------

describe('Ch5LocalSetup — NO terminal instructions', () => {
  const FORBIDDEN_PATTERNS = [
    /ollama pull/i,
    /terminal/i,
    /command line/i,
    /command prompt/i,
    /run this/i,
    /open a terminal/i,
    /type in/i,
  ];

  // Test each state for forbidden text

  it('needs-install state contains no terminal/command text', async () => {
    mockDetectOllama.mockResolvedValue({ reachable: false, models: [] });
    mockWaitForOllama.mockReturnValue(new Promise(() => { /* pending */ }));
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-needs-install')).toBeInTheDocument();
    });

    const content = screen.getByTestId('ch5-local-view').textContent ?? '';
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(content).not.toMatch(pattern);
    }
  });

  it('downloading state contains no terminal/command text', async () => {
    mockDetectOllama.mockResolvedValue({ reachable: true, models: [] });
    mockPullOllamaModel.mockReturnValue(new Promise(() => { /* pending */ }));
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-downloading')).toBeInTheDocument();
    });

    const content = screen.getByTestId('ch5-local-view').textContent ?? '';
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(content).not.toMatch(pattern);
    }
  });

  it('ready state contains no terminal/command text', async () => {
    mockDetectOllama.mockResolvedValue({ reachable: true, models: ['llama3.2:3b'] });
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-use-local-btn')).toBeInTheDocument();
    });

    const content = screen.getByTestId('ch5-local-view').textContent ?? '';
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(content).not.toMatch(pattern);
    }
  });

  it('error state contains no terminal/command text', async () => {
    // Error state is reached via a failed download (detect works, pull fails)
    mockDetectOllama.mockResolvedValue({ reachable: true, models: [] });
    mockPullOllamaModel.mockRejectedValue(new Error('Connection refused'));
    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-error')).toBeInTheDocument();
    });

    const content = screen.getByTestId('ch5-local-view').textContent ?? '';
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(content).not.toMatch(pattern);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: accessibility — focus management
// ---------------------------------------------------------------------------

describe('Ch5LocalSetup — accessibility: focus management', () => {
  it('focuses the heading on mount (checking state)', () => {
    // Keep detect pending so we stay in checking state
    mockDetectOllama.mockReturnValue(new Promise(() => { /* pending */ }));
    renderSetup();
    const heading = screen.getByTestId('ch5-local-title');
    expect(document.activeElement).toBe(heading);
  });

  it('heading has tabIndex=-1', () => {
    mockDetectOllama.mockReturnValue(new Promise(() => { /* pending */ }));
    renderSetup();
    expect(screen.getByTestId('ch5-local-title')).toHaveAttribute('tabindex', '-1');
  });
});

// ---------------------------------------------------------------------------
// Tests: Ch5ChooseYourBrain integration — local card uses Ch5LocalSetup
// ---------------------------------------------------------------------------

describe('Ch5LocalSetup — integration with Ch5ChooseYourBrain', () => {
  beforeEach(() => {
    mockDetectOllama.mockReturnValue(new Promise(() => { /* pending */ }));
  });

  it('clicking card-local in Ch5 renders Ch5LocalSetup (ch5-local-view)', async () => {
    const { ch5ChooseYourBrain } = await import('./Ch5ChooseYourBrain');
    const ctx = makeCtx();
    render(ch5ChooseYourBrain.render(ctx));

    fireEvent.click(screen.getByTestId('ch5-card-local'));

    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-view')).toBeInTheDocument();
    });
  });
});
