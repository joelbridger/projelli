/**
 * Task 4 — Onboarding step circles digit centering.
 *
 * Verifies that the numbered span in the demo step circles uses `inline-flex`
 * with proper centering utilities and does NOT use `inline-block` (which
 * causes top-left digit misalignment on scaled Windows displays).
 *
 * The demo step is reached by rendering FirstRunWizard and clicking through
 * the wizard steps. AiSetupStep is mocked to skip the heavy AI setup UI.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { FirstRunWizard } from '@/features/onboarding/FirstRunWizard';

// Prevent any real side effects from the wizard
vi.mock('@/onboarding/samples', () => ({
  writeSampleFiles: vi.fn(),
  getSamplesForProfession: vi.fn(() => []),
}));

vi.mock('@/onboarding/professionModel', () => ({
  persistProfessionModelDefault: vi.fn(),
  getModelForProfession: vi.fn(() => ({
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
  })),
}));

vi.mock('@/features/onboarding/aiSetupState', () => ({
  markAiSetupDeferred: vi.fn(),
}));

// Mock AiSetupStep so we don't need to render its full implementation
// (avoids deep import chains for the AI setup components).
vi.mock('@/features/onboarding/AiSetupStep', () => ({
  AiSetupStep: ({ onSkip }: { onSkip: () => void }) => (
    <div>
      <button type="button" onClick={onSkip}>Set up later</button>
    </div>
  ),
}));

describe('onboarding step circles — digit centering (Task 4)', () => {
  it('step circles use inline-flex + items-center + justify-center + leading-none, no inline-block', async () => {
    const { container } = render(
      <FirstRunWizard
        onComplete={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    // Navigate to demo step:
    // Welcome → Let's go
    await act(async () => {
      screen.getByRole('button', { name: /let's go/i }).click();
    });

    // Profession → Skip for now (last button = primary CTA, not the header link)
    await act(async () => {
      const skipBtns = screen.getAllByRole('button', { name: /skip for now/i });
      skipBtns[skipBtns.length - 1].click();
    });

    // Workspace → Got it
    await act(async () => {
      screen.getByRole('button', { name: /got it/i }).click();
    });

    // Data → "Got it, connect an AI"
    await act(async () => {
      screen.getByRole('button', { name: /got it, connect an ai/i }).click();
    });

    // AI setup (mocked) → "Set up later"
    await act(async () => {
      screen.getByRole('button', { name: /set up later/i }).click();
    });

    // Now on demo step — find the numbered step-circle badge spans
    const badges = container.querySelectorAll('span.rounded-full');
    expect(badges.length, 'should have at least 3 numbered step circles').toBeGreaterThanOrEqual(3);

    for (const badge of badges) {
      const cls = badge.className;
      expect(cls, `badge "${badge.textContent}" should contain inline-flex`).toContain('inline-flex');
      expect(cls, `badge "${badge.textContent}" should contain items-center`).toContain('items-center');
      expect(cls, `badge "${badge.textContent}" should contain justify-center`).toContain('justify-center');
      expect(cls, `badge "${badge.textContent}" should contain leading-none`).toContain('leading-none');
      expect(cls, `badge "${badge.textContent}" should NOT contain inline-block`).not.toMatch(
        /\binline-block\b/,
      );
    }
  });
});
