/**
 * WS-E / E1 — rebuilt onboarding AI-setup step.
 *
 * UX research found the #1 first-run drop-off was the "paste your API key"
 * step. These tests pin the fix:
 *
 *   1. The AI-setup step leads with a plain-English explanation BEFORE any key
 *      field or the jargon "API key".
 *   2. The research-praised "Test this key" button shows success AND failure
 *      states (mocked validation).
 *   3. "Set this up later" skips without blocking and sets the reminder flag;
 *      the AI pane reminder then surfaces and clears once a model connects.
 *   4. The local / Ollama path appears and ties to Local-only confidentiality
 *      mode, detecting Ollama via detectOllama().
 *   5. The data map is reachable from onboarding.
 *   6. The profession picker sets a sensible default model.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// --- Mocks -----------------------------------------------------------------

// openExternal must never try to open a real URL in jsdom.
vi.mock('@/platform/utils/openExternal', () => ({
  openExternal: vi.fn(async () => {}),
}));

// The "Test this key" button calls validateApiKeyLive. Mock it so we control
// the success/failure outcome without a network call.
const mockValidate = vi.fn();
vi.mock('@/platform/providers/apiKeyValidation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/providers/apiKeyValidation')>();
  return {
    ...actual,
    validateApiKeyLive: (...args: unknown[]) => mockValidate(...args),
  };
});

// detectOllama drives the local path. Default to "reachable with a model";
// individual tests override.
const mockDetectOllama = vi.fn(async () => ({ reachable: true, models: ['llama3.2:3b'] }));
vi.mock('@/platform/providers/OllamaProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/providers/OllamaProvider')>();
  return {
    ...actual,
    detectOllama: (...args: unknown[]) => mockDetectOllama(...args),
  };
});

import { AiSetupStep, type AiSetupStepProps } from '@/features/onboarding/AiSetupStep';
import { AiSetupReminder } from '@/features/onboarding/AiSetupReminder';
import { hasDeferredAiSetup, clearAiSetupDeferred } from '@/features/onboarding/aiSetupState';
import {
  getModelForProfession,
  persistProfessionModelDefault,
  PROFESSION_MODEL_STORAGE_KEY,
  PROFESSION_PROVIDER_STORAGE_KEY,
} from '@/platform/profile/professionModel';
import { DEFAULT_ANTHROPIC_PAID } from '@/platform/utils/defaultModel';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import {
  CONFIDENTIALITY_MODE_SETTING_KEY,
} from '@/platform/privacy/egress';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  useSettingsStore.setState({ values: {} });
  mockDetectOllama.mockResolvedValue({ reachable: true, models: ['llama3.2:3b'] });
});

function renderStep(overrides: Partial<AiSetupStepProps> = {}) {
  const props = {
    onBack: vi.fn(),
    onSaveKey: vi.fn(async () => {}),
    onUseLocal: vi.fn(),
    onSkip: vi.fn(),
    onOpenDataMap: vi.fn(),
    ...overrides,
  };
  render(<AiSetupStep {...props} />);
  return props;
}

// ---------------------------------------------------------------------------
// 1. Plain English BEFORE jargon
// ---------------------------------------------------------------------------

describe('AiSetupStep — plain English before jargon', () => {
  it('leads with a plain-English explanation and the three paths, with no key field visible', () => {
    renderStep();

    // The simplified subtitle is present up front.
    expect(
      screen.getByText(/Advisor Prep Hero connects to your own AI account/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/never through us/i)).toBeInTheDocument();

    // All three paths are offered as cards.
    expect(screen.getByTestId('ai-path-own-account')).toBeInTheDocument();
    expect(screen.getByTestId('ai-path-local')).toBeInTheDocument();
    expect(screen.getByTestId('ai-path-later')).toBeInTheDocument();

    // The key field and the word "API key" are NOT shown until the user opts in.
    expect(screen.queryByTestId('ai-setup-key-input')).not.toBeInTheDocument();
  });

  it('only introduces the key field (and the "what is that?" line) after choosing "use your own account"', () => {
    renderStep();
    fireEvent.click(screen.getByTestId('ai-path-own-account'));

    // Now the key field exists, and the plain-language "what is that?" appears.
    expect(screen.getByTestId('ai-setup-key-input')).toBeInTheDocument();
    expect(screen.getByText(/What is that\?/i)).toBeInTheDocument();
    expect(screen.getByText(/like a password that lets your computer talk directly/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. Test-this-key success + failure
// ---------------------------------------------------------------------------

describe('AiSetupStep — "Test this key" states', () => {
  it('shows the success state when the key validates', async () => {
    mockValidate.mockResolvedValue({ outcome: 'ok', message: 'This key works.' });
    renderStep();
    fireEvent.click(screen.getByTestId('ai-path-own-account'));

    fireEvent.change(screen.getByTestId('ai-setup-key-input'), {
      target: { value: 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    fireEvent.click(await screen.findByTestId('api-key-tester-button'));

    expect(await screen.findByTestId('api-key-tester-result-ok')).toBeInTheDocument();
    expect(screen.getByText(/This key works\./i)).toBeInTheDocument();
  });

  it('shows a failure state when the provider rejects the key', async () => {
    mockValidate.mockResolvedValue({
      outcome: 'rejected',
      message: 'That key was refused by the provider.',
    });
    renderStep();
    fireEvent.click(screen.getByTestId('ai-path-own-account'));

    fireEvent.change(screen.getByTestId('ai-setup-key-input'), {
      target: { value: 'sk-ant-api03-badbadbadbadbadbadbadbad' },
    });
    fireEvent.click(await screen.findByTestId('api-key-tester-button'));

    expect(await screen.findByTestId('api-key-tester-result-rejected')).toBeInTheDocument();
  });

  it('saves the key and advances via onSaveKey, clearing any deferred flag', async () => {
    const onSaveKey = vi.fn(async () => {});
    renderStep({ onSaveKey });
    fireEvent.click(screen.getByTestId('ai-path-own-account'));

    fireEvent.change(screen.getByTestId('ai-setup-key-input'), {
      target: { value: '  sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa  ' },
    });
    fireEvent.click(screen.getByTestId('ai-setup-save-key'));

    await waitFor(() => {
      expect(onSaveKey).toHaveBeenCalledWith(
        'anthropic',
        'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa',
      );
    });
    expect(hasDeferredAiSetup()).toBe(false);
  });

  it('honors the profession default provider in the own-account flow', () => {
    renderStep({ defaultProvider: 'openai' });
    fireEvent.click(screen.getByTestId('ai-path-own-account'));
    // The OpenAI tab is selected (aria-selected) when seeded as the default.
    expect(screen.getByTestId('ai-provider-tab-openai')).toHaveAttribute('aria-selected', 'true');
  });
});

// ---------------------------------------------------------------------------
// 3. "Set this up later" — no block, sets reminder flag
// ---------------------------------------------------------------------------

describe('AiSetupStep — "Set this up later" never blocks', () => {
  it('calls onSkip and sets the deferred reminder flag', () => {
    const onSkip = vi.fn();
    renderStep({ onSkip });

    // The skip path is reachable directly from the first screen (no key needed).
    fireEvent.click(screen.getByTestId('ai-path-later'));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// WS5 Task 3 — AiSetupReminder BYOK-first nudge copy
// ---------------------------------------------------------------------------

describe('AiSetupReminder — WS5 BYOK-first nudge copy', () => {
  it('reminder text mentions Claude or OpenAI (BYOK-first nudge)', () => {
    localStorage.setItem('keepance_ai_setup_deferred', 'true');
    render(<AiSetupReminder hasModelConnected={false} onConnect={vi.fn()} />);
    const reminder = screen.getByTestId('ai-setup-reminder');
    expect(reminder.textContent).toMatch(/Claude|OpenAI/i);
  });

  it('reminder names the work concretely, profession-aware (default advisor → "client work"), not legacy "legal" copy', () => {
    localStorage.setItem('keepance_ai_setup_deferred', 'true');
    render(<AiSetupReminder hasModelConnected={false} onConnect={vi.fn()} />);
    const reminder = screen.getByTestId('ai-setup-reminder');
    // Default profession is 'advisor' → profession-aware copy via professionCopy.
    expect(reminder.textContent).toMatch(/client work/i);
    expect(reminder.textContent).not.toMatch(/legal work|legal analysis/i);
  });

  it('reminder text does NOT contain "whenever you are ready" (old generic copy)', () => {
    localStorage.setItem('keepance_ai_setup_deferred', 'true');
    render(<AiSetupReminder hasModelConnected={false} onConnect={vi.fn()} />);
    const reminder = screen.getByTestId('ai-setup-reminder');
    expect(reminder.textContent).not.toMatch(/whenever you are ready/i);
  });

  it('reminder text does NOT contain an em dash', () => {
    localStorage.setItem('keepance_ai_setup_deferred', 'true');
    render(<AiSetupReminder hasModelConnected={false} onConnect={vi.fn()} />);
    const reminder = screen.getByTestId('ai-setup-reminder');
    expect(reminder.textContent).not.toContain('—');
  });
});

describe('AiSetupReminder', () => {
  it('shows after a deferral and links to connect, then hides once dismissed', () => {
    // Simulate the skip path having set the flag.
    localStorage.setItem('keepance_ai_setup_deferred', 'true');
    const onConnect = vi.fn();

    const { rerender } = render(
      <AiSetupReminder hasModelConnected={false} onConnect={onConnect} />,
    );
    expect(screen.getByTestId('ai-setup-reminder')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('ai-setup-reminder-connect'));
    expect(onConnect).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('ai-setup-reminder-dismiss'));
    rerender(<AiSetupReminder hasModelConnected={false} onConnect={onConnect} />);
    expect(screen.queryByTestId('ai-setup-reminder')).not.toBeInTheDocument();
  });

  it('never shows once a model is connected, even if the flag is set', () => {
    localStorage.setItem('keepance_ai_setup_deferred', 'true');
    render(<AiSetupReminder hasModelConnected={true} onConnect={vi.fn()} />);
    expect(screen.queryByTestId('ai-setup-reminder')).not.toBeInTheDocument();
  });

  it('does not show when the user never deferred', () => {
    clearAiSetupDeferred();
    render(<AiSetupReminder hasModelConnected={false} onConnect={vi.fn()} />);
    expect(screen.queryByTestId('ai-setup-reminder')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4. Local / Ollama path ties to Local-only
// ---------------------------------------------------------------------------

describe('AiSetupStep — local (Ollama) path', () => {
  it('appears as a path and detects a ready Ollama install', async () => {
    renderStep();
    fireEvent.click(screen.getByTestId('ai-path-local'));

    expect(screen.getByTestId('ai-setup-local-view')).toBeInTheDocument();
    expect(await screen.findByTestId('ollama-status-ready')).toBeInTheDocument();
    expect(mockDetectOllama).toHaveBeenCalled();
  });

  it('guides the user when Ollama is not installed', async () => {
    mockDetectOllama.mockResolvedValue({ reachable: false, models: [] });
    renderStep();
    fireEvent.click(screen.getByTestId('ai-path-local'));

    expect(await screen.findByTestId('ollama-status-missing')).toBeInTheDocument();
    expect(screen.getByTestId('ollama-download-link')).toBeInTheDocument();
    // "Use local AI" stays disabled until a model is ready.
    expect(screen.getByTestId('ai-setup-use-local')).toBeDisabled();
  });

  it('turning on local AI sets Local-only confidentiality mode and continues', async () => {
    const onUseLocal = vi.fn();
    renderStep({ onUseLocal });
    fireEvent.click(screen.getByTestId('ai-path-local'));

    const confirm = await screen.findByTestId('ai-setup-use-local');
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

    expect(onUseLocal).toHaveBeenCalledTimes(1);
    expect(
      useSettingsStore.getState().getSetting(CONFIDENTIALITY_MODE_SETTING_KEY),
    ).toBe('local-only');
  });
});

// ---------------------------------------------------------------------------
// 5. Data map reachable from onboarding
// ---------------------------------------------------------------------------

describe('AiSetupStep — data map is reachable', () => {
  it('exposes a "Where does my data go?" link on the first screen', () => {
    const onOpenDataMap = vi.fn();
    renderStep({ onOpenDataMap });
    fireEvent.click(screen.getByTestId('ai-setup-data-map-link-choose'));
    expect(onOpenDataMap).toHaveBeenCalledTimes(1);
  });

  it('exposes a data-map link inside the own-account flow too', () => {
    const onOpenDataMap = vi.fn();
    renderStep({ onOpenDataMap });
    fireEvent.click(screen.getByTestId('ai-path-own-account'));
    fireEvent.click(screen.getByTestId('ai-setup-data-map-link-own'));
    expect(onOpenDataMap).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// WS5 Task 1 — BYOK-first card ordering and badge copy
// ---------------------------------------------------------------------------

describe('AiSetupStep — WS5 BYOK-first ordering and badges', () => {
  it('BYOK card appears before local card in the DOM', () => {
    renderStep();
    const ownAccount = screen.getByTestId('ai-path-own-account');
    const local = screen.getByTestId('ai-path-local');
    const allInteractive = screen.getAllByRole('button');
    const ownIdx = allInteractive.indexOf(ownAccount);
    const localIdx = allInteractive.indexOf(local);
    expect(ownIdx).toBeLessThan(localIdx);
  });

  it('BYOK badge text does NOT contain "when ready"', () => {
    renderStep();
    const ownAccount = screen.getByTestId('ai-path-own-account');
    expect(ownAccount.textContent).not.toMatch(/when ready/i);
  });

  it('BYOK badge is profession-aware (default advisor → "Recommended for client work"), not legacy "legal work"', () => {
    renderStep();
    const ownAccount = screen.getByTestId('ai-path-own-account');
    // Default profession is 'advisor' → routed through professionCopy.clientWorkNoun.
    expect(ownAccount.textContent).toMatch(/Recommended for client work/i);
    expect(ownAccount.textContent).not.toMatch(/Recommended for legal work/i);
  });

  it('local card carries the quality caveat in its badge', () => {
    renderStep();
    const local = screen.getByTestId('ai-path-local');
    // Badge must mention quality trade-off
    expect(local.textContent).toMatch(/less capable/i);
  });

  it('local card badge text does NOT say "Most private" alone — must include caveat', () => {
    renderStep();
    const local = screen.getByTestId('ai-path-local');
    // "Most private" alone was the old badge; it should now include quality caveat
    expect(local.textContent).toMatch(/Maximum privacy/i);
  });

  it('skip card (ai-path-later) renders last among the three path cards', () => {
    renderStep();
    const ownAccount = screen.getByTestId('ai-path-own-account');
    const local = screen.getByTestId('ai-path-local');
    const later = screen.getByTestId('ai-path-later');
    const allInteractive = screen.getAllByRole('button');
    const ownIdx = allInteractive.indexOf(ownAccount);
    const localIdx = allInteractive.indexOf(local);
    const laterIdx = allInteractive.indexOf(later);
    expect(laterIdx).toBeGreaterThan(ownIdx);
    expect(laterIdx).toBeGreaterThan(localIdx);
  });
});

// ---------------------------------------------------------------------------
// 6. Profession sets a sensible default model
// ---------------------------------------------------------------------------

describe('professionModel — profession sets a default model', () => {
  it('legal defaults to a strong Claude model on Anthropic', () => {
    const def = getModelForProfession('legal');
    expect(def.provider).toBe('anthropic');
    expect(def.model).toBe(DEFAULT_ANTHROPIC_PAID);
  });

  it('persists the default into localStorage for the AI pane to pick up', () => {
    persistProfessionModelDefault('legal');
    expect(localStorage.getItem(PROFESSION_PROVIDER_STORAGE_KEY)).toBe('anthropic');
    expect(localStorage.getItem(PROFESSION_MODEL_STORAGE_KEY)).toBe(DEFAULT_ANTHROPIC_PAID);
  });

  it('never overrides a model the user already chose', () => {
    localStorage.setItem(PROFESSION_MODEL_STORAGE_KEY, 'gpt-4o');
    localStorage.setItem(PROFESSION_PROVIDER_STORAGE_KEY, 'openai');
    persistProfessionModelDefault('legal');
    expect(localStorage.getItem(PROFESSION_MODEL_STORAGE_KEY)).toBe('gpt-4o');
    expect(localStorage.getItem(PROFESSION_PROVIDER_STORAGE_KEY)).toBe('openai');
  });

  it('falls back to the generic default for unknown professions', () => {
    const def = getModelForProfession('something-unknown');
    expect(def.provider).toBe('anthropic');
  });
});
