/// <reference types="@testing-library/jest-dom" />

/**
 * Ch5ChooseYourBrain tests
 *
 * Mocking strategy:
 *  - KeychainService: vi.mock the module; the mock's setKey is a spy that resolves.
 *  - detectOllama: vi.mock the OllamaProvider module so we can control
 *    whether Ollama is detected.
 *  - openExternal: vi.mock so tests don't open browser windows.
 *  - professionStore: vi.mock so useProfessionCopy returns predictable copy.
 *  - ctx: a plain stub object — no host is needed; chapters render standalone.
 *
 * Test pattern follows JourneyHost.test.tsx: stub ctx, render chapter.render(ctx).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ChapterContext, JourneyData } from '../engine/types';

// ---------------------------------------------------------------------------
// Module mocks (must be top-level before any imports that use them)
// ---------------------------------------------------------------------------

// Mock KeychainService so we never touch real storage
const mockSetKey = vi.fn().mockResolvedValue(undefined);
vi.mock('@/platform/providers/KeychainService', () => {
  function KeychainService() { /* constructor stub */ }
  KeychainService.prototype.setKey = (...args: unknown[]) => mockSetKey(...args);
  return { KeychainService };
});

// Mock openExternal so no real browser window opens
vi.mock('@/platform/utils/openExternal', () => ({
  openExternal: vi.fn().mockResolvedValue(undefined),
}));

// Mock professionStore so useProfessionCopy has a stable return
vi.mock('@/platform/profile/professionStore', () => ({
  useProfessionStore: vi.fn((selector: (s: { profession: string }) => unknown) =>
    selector({ profession: 'legal' }),
  ),
  getProfession: vi.fn(() => 'legal'),
}));

// Default: Ollama not detected
const mockDetectOllama = vi.fn().mockResolvedValue({ reachable: false, models: [] });
vi.mock('@/platform/providers/OllamaProvider', () => ({
  detectOllama: (...args: unknown[]) => mockDetectOllama(...args),
  OLLAMA_DEFAULT_BASE_URL: 'http://127.0.0.1:11434',
}));

// Mock clearAiSetupDeferred so localStorage side effects are isolated
vi.mock('@/features/onboarding/aiSetupState', () => ({
  clearAiSetupDeferred: vi.fn(),
  markAiSetupDeferred: vi.fn(),
  hasDeferredAiSetup: vi.fn(() => false),
}));

// Mock sendDiagnosticEvent (may be called on key save)
vi.mock('@/platform/utils/diagnostics', () => ({
  sendDiagnosticEvent: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import the module under test (after mocks are set up)
// ---------------------------------------------------------------------------
import { ch5ChooseYourBrain } from './Ch5ChooseYourBrain';

// ---------------------------------------------------------------------------
// Helper: build a stub ChapterContext
// ---------------------------------------------------------------------------
function makeCtx(overrides: Partial<ChapterContext> & { data?: JourneyData } = {}): ChapterContext {
  return {
    advance: vi.fn(),
    goBack: vi.fn(),
    skipAll: vi.fn(),
    complete: vi.fn(),
    setData: vi.fn(),
    data: {},
    reducedMotion: true, // disable animations in tests
    ...overrides,
  };
}

function renderCh5(ctx = makeCtx()) {
  render(ch5ChooseYourBrain.render(ctx));
  return { ctx };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ch5ChooseYourBrain — metadata', () => {
  it('has id "choose-brain"', () => {
    expect(ch5ChooseYourBrain.id).toBe('choose-brain');
  });

  it('has title "Choose your AI"', () => {
    expect(ch5ChooseYourBrain.title).toBe('Choose your AI');
  });
});

describe('ch5 — choose view (initial state)', () => {
  it('renders the three cards', () => {
    renderCh5();
    expect(screen.getByTestId('ch5-card-cloud')).toBeInTheDocument();
    expect(screen.getByTestId('ch5-card-local')).toBeInTheDocument();
    expect(screen.getByTestId('ch5-card-later')).toBeInTheDocument();
  });

  it('shows the chapter title and sub', () => {
    renderCh5();
    expect(screen.getByText('Choose your AI')).toBeInTheDocument();
    expect(screen.getByText("One quick choice. There's no wrong answer.")).toBeInTheDocument();
  });

  it('shows the "Best for legal work" badge on card 1', () => {
    renderCh5();
    expect(screen.getByText('Best for legal work')).toBeInTheDocument();
  });

  it('shows the "Most private. A bit less sharp." badge on card 2', () => {
    renderCh5();
    expect(screen.getByText('Most private. A bit less sharp.')).toBeInTheDocument();
  });
});

describe('ch5 — navigate from choose to cloud view', () => {
  it('clicking card 1 shows the provider picker', () => {
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-cloud'));
    // provider tabs should appear
    expect(screen.getByTestId('ch5-provider-tab-anthropic')).toBeInTheDocument();
    expect(screen.getByTestId('ch5-provider-tab-openai')).toBeInTheDocument();
    expect(screen.getByTestId('ch5-provider-tab-google')).toBeInTheDocument();
  });

  it('cloud view shows the ApiKeyExplainer callout', () => {
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-cloud'));
    // ApiKeyExplainer shows "What is an API key?"
    expect(screen.getByText('What is an API key?')).toBeInTheDocument();
  });

  it('cloud view shows the "Open [provider]" button for the selected provider', () => {
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-cloud'));
    // Default provider is anthropic; the tutorial open button should mention Claude
    expect(screen.getByTestId('ch5-open-console-anthropic')).toBeInTheDocument();
  });

  it('switching provider tabs changes the open-console button', () => {
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-cloud'));
    fireEvent.click(screen.getByTestId('ch5-provider-tab-openai'));
    expect(screen.getByTestId('ch5-open-console-openai')).toBeInTheDocument();
  });

  it('Back button returns to choose view', () => {
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-cloud'));
    fireEvent.click(screen.getByRole('button', { name: /other options/i }));
    expect(screen.getByTestId('ch5-card-cloud')).toBeInTheDocument();
  });
});

describe('ch5 — cloud view: save key', () => {
  beforeEach(() => {
    mockSetKey.mockClear();
    mockSetKey.mockResolvedValue(undefined);
  });

  it('Save and continue is disabled when the key input is empty', () => {
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-cloud'));
    const saveBtn = screen.getByTestId('ch5-save-key');
    expect(saveBtn).toBeDisabled();
  });

  it('enables Save and continue once a key is typed', () => {
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-cloud'));
    const input = screen.getByTestId('ch5-key-input');
    fireEvent.change(input, { target: { value: 'sk-ant-api03-test' } });
    expect(screen.getByTestId('ch5-save-key')).not.toBeDisabled();
  });

  it('on save calls KeychainService.setKey with the correct provider and key', async () => {
    const { ctx } = renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-cloud'));
    const input = screen.getByTestId('ch5-key-input');
    fireEvent.change(input, { target: { value: 'sk-ant-api03-abc' } });
    fireEvent.click(screen.getByTestId('ch5-save-key'));

    await waitFor(() => {
      expect(mockSetKey).toHaveBeenCalledWith('anthropic', 'sk-ant-api03-abc');
    });

    // After a successful save, ctx.setData should record aiChoice='cloud' and provider
    await waitFor(() => {
      expect(ctx.setData).toHaveBeenCalledWith(
        expect.objectContaining({ aiChoice: 'cloud', aiProvider: 'anthropic' }),
      );
    });
  });

  it('after save, navigates to the wrap view (465 MB copy)', async () => {
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-cloud'));
    const input = screen.getByTestId('ch5-key-input');
    fireEvent.change(input, { target: { value: 'sk-ant-api03-xyz' } });
    fireEvent.click(screen.getByTestId('ch5-save-key'));

    await waitFor(() => {
      expect(screen.getByTestId('ch5-wrap-view')).toBeInTheDocument();
    });
    expect(screen.getByText(/465 MB/)).toBeInTheDocument();
  });

  it('shows an error when KeychainService.setKey rejects', async () => {
    mockSetKey.mockRejectedValue(new Error('Keychain unavailable'));
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-cloud'));
    const input = screen.getByTestId('ch5-key-input');
    fireEvent.change(input, { target: { value: 'sk-ant-api03-fail' } });
    fireEvent.click(screen.getByTestId('ch5-save-key'));

    await waitFor(() => {
      expect(screen.getByTestId('ch5-save-error')).toBeInTheDocument();
    });
  });
});

describe('ch5 — navigate to local view', () => {
  it('clicking card 2 shows the local view', async () => {
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-local'));
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-view')).toBeInTheDocument();
    });
  });

  it('shows "We\'ll help you set this up in a moment." when Ollama is not detected', async () => {
    mockDetectOllama.mockResolvedValue({ reachable: false, models: [] });
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-local'));
    await waitFor(() => {
      expect(screen.getByText(/we'll help you set this up in a moment/i)).toBeInTheDocument();
    });
  });

  it('shows "Set it up for me" placeholder button when Ollama not detected (no-op)', async () => {
    mockDetectOllama.mockResolvedValue({ reachable: false, models: [] });
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-local'));
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-setup-placeholder')).toBeInTheDocument();
    });
  });

  it('shows "Use local AI" button when Ollama is ready', async () => {
    mockDetectOllama.mockResolvedValue({ reachable: true, models: ['llama3.2:3b'] });
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-local'));
    await waitFor(() => {
      expect(screen.getByTestId('ch5-use-local-btn')).toBeInTheDocument();
    });
  });

  it('Use local AI sets aiChoice=local and goes to wrap', async () => {
    mockDetectOllama.mockResolvedValue({ reachable: true, models: ['llama3.2:3b'] });
    const { ctx } = renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-local'));
    await waitFor(() => {
      expect(screen.getByTestId('ch5-use-local-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('ch5-use-local-btn'));
    expect(ctx.setData).toHaveBeenCalledWith(expect.objectContaining({ aiChoice: 'local' }));
    await waitFor(() => {
      expect(screen.getByTestId('ch5-wrap-view')).toBeInTheDocument();
    });
  });

  it('Back button in local view returns to choose view', async () => {
    mockDetectOllama.mockResolvedValue({ reachable: false, models: [] });
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-local'));
    await waitFor(() => {
      expect(screen.getByTestId('ch5-local-view')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /other options/i }));
    expect(screen.getByTestId('ch5-card-cloud')).toBeInTheDocument();
  });
});

describe('ch5 — Decide later path', () => {
  it('clicking Decide later sets aiChoice=later', () => {
    const { ctx } = renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-later'));
    expect(ctx.setData).toHaveBeenCalledWith(expect.objectContaining({ aiChoice: 'later' }));
  });

  it('clicking Decide later sets the localStorage deferred flag', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-later'));
    expect(setItemSpy).toHaveBeenCalledWith('keepance_ai_setup_deferred', 'true');
    setItemSpy.mockRestore();
  });

  it('clicking Decide later goes to the wrap view', () => {
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-later'));
    expect(screen.getByTestId('ch5-wrap-view')).toBeInTheDocument();
  });
});

describe('ch5 — wrap view', () => {
  it('wrap view shows the 465 MB copy', () => {
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-later'));
    expect(screen.getByText(/465 MB/)).toBeInTheDocument();
  });

  it('wrap view shows the "One quick thing" title', () => {
    renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-later'));
    expect(screen.getByText('One quick thing')).toBeInTheDocument();
  });

  it('Continue button in wrap view calls ctx.advance()', () => {
    const { ctx } = renderCh5();
    fireEvent.click(screen.getByTestId('ch5-card-later'));
    fireEvent.click(screen.getByTestId('ch5-wrap-continue'));
    expect(ctx.advance).toHaveBeenCalledOnce();
  });
});
