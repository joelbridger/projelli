/**
 * WS-E / E1 — FirstRunWizard flow (the rebuilt onboarding shell).
 *
 * Verifies the new sequence and that it never dead-ends on the key step:
 *   - welcome -> profession (sets a default model) -> workspace -> data (the
 *     plain-English data map) -> ai-setup (plain English before any key field)
 *     -> demo -> done.
 *   - Picking a profession persists a sensible default model.
 *   - The data map is reachable as a dedicated onboarding step.
 *   - "Set this up later" on the AI step advances without blocking and sets the
 *     deferred reminder flag; the wizard can still complete.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/platform/utils/openExternal', () => ({
  openExternal: vi.fn(async () => {}),
}));

// Keep the local-path detection deterministic; this flow test doesn't drive it.
vi.mock('@/platform/providers/OllamaProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/providers/OllamaProvider')>();
  return { ...actual, detectOllama: vi.fn(async () => ({ reachable: false, models: [] })) };
});

import { FirstRunWizard } from '@/features/onboarding/FirstRunWizard';
import { hasDeferredAiSetup } from '@/features/onboarding/aiSetupState';
import {
  PROFESSION_MODEL_STORAGE_KEY,
  PROFESSION_PROVIDER_STORAGE_KEY,
} from '@/platform/profile/professionModel';
import { DEFAULT_ANTHROPIC_PAID } from '@/platform/utils/defaultModel';
import { useSettingsStore } from '@/platform/settings/settingsStore';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  useSettingsStore.setState({ values: {} });
});

/** Click through welcome -> profession(legal) -> workspace -> data -> ai-setup. */
function advanceToData() {
  // Welcome
  fireEvent.click(screen.getByRole('button', { name: "Let's go" }));
  // Profession: pick legal, then continue ("Got it")
  fireEvent.click(screen.getByTestId('profession-card-legal'));
  fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
  // Workspace -> data ("Got it")
  fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
}

function advanceToAiSetup() {
  advanceToData();
  // Data step -> ai-setup
  fireEvent.click(screen.getByRole('button', { name: /connect an ai/i }));
}

describe('FirstRunWizard — rebuilt flow', () => {
  it('reaches the data-map step and shows the plain-English data story', () => {
    render(<FirstRunWizard onComplete={vi.fn()} onSkip={vi.fn()} />);
    advanceToData();

    // The data step is present and renders the reusable data-map content.
    expect(screen.getByTestId('onboarding-data-step')).toBeInTheDocument();
    expect(screen.getByTestId('data-map-content')).toBeInTheDocument();
    expect(
      screen.getByText(/Where your data lives and who can see it/i),
    ).toBeInTheDocument();
  });

  it('picking a profession persists a sensible default model', () => {
    render(<FirstRunWizard onComplete={vi.fn()} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: "Let's go" }));
    fireEvent.click(screen.getByTestId('profession-card-legal'));

    expect(localStorage.getItem(PROFESSION_PROVIDER_STORAGE_KEY)).toBe('anthropic');
    expect(localStorage.getItem(PROFESSION_MODEL_STORAGE_KEY)).toBe(DEFAULT_ANTHROPIC_PAID);
  });

  it('leads the AI step with plain English and no key field by default', () => {
    render(<FirstRunWizard onComplete={vi.fn()} onSkip={vi.fn()} />);
    advanceToAiSetup();

    expect(screen.getByTestId('ai-setup-step')).toBeInTheDocument();
    expect(
      screen.getByText(/Advisor Prep Hero connects to your own AI account/i),
    ).toBeInTheDocument();
    // No raw key field until the user opts into the own-account path.
    expect(screen.queryByTestId('ai-setup-key-input')).not.toBeInTheDocument();
  });

  it('"Set this up later" advances without blocking and sets the deferred flag, and the wizard can complete', async () => {
    const onComplete = vi.fn();
    render(<FirstRunWizard onComplete={onComplete} onSkip={vi.fn()} />);
    advanceToAiSetup();

    // Skip the AI step.
    fireEvent.click(screen.getByTestId('ai-path-later'));
    expect(hasDeferredAiSetup()).toBe(true);

    // We land on the demo step (samples toggle present), and can finish.
    expect(await screen.findByTestId('first-run-samples-toggle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open my workspace' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it('opens the always-available data-map dialog from the AI step link', () => {
    render(<FirstRunWizard onComplete={vi.fn()} onSkip={vi.fn()} />);
    advanceToAiSetup();
    fireEvent.click(screen.getByTestId('ai-setup-data-map-link-choose'));
    expect(screen.getByTestId('data-map-dialog')).toBeInTheDocument();
  });
});
