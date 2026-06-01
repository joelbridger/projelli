/**
 * Q11 (Wave 1.5) — FirstRunWizard sample-population integration.
 *
 * Verifies the "Populate workspace with samples" toggle in FirstRunWizard:
 *   - Renders with the correct data-testid
 *   - Defaults to ON
 *   - When ON, finishing the wizard calls workspace.writeFile three times
 *     (one per sample)
 *   - When OFF, finishing the wizard does NOT call writeFile
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FirstRunWizard } from '@/components/onboarding/FirstRunWizard';

function makeMockWorkspace() {
  return {
    writeFile: vi.fn(async (_path: string, _content: string) => {}),
    exists: vi.fn(async (_path: string) => false),
  };
}

// Several steps render a header "Skip for now" (which aborts the whole wizard)
// alongside an in-step "Skip for now" (which advances). The in-step one is
// rendered after the header in the DOM, so we always click the LAST match.
function clickLastSkip() {
  const skips = screen.getAllByRole('button', { name: /^Skip for now$/i });
  fireEvent.click(skips[skips.length - 1]!);
}

function advanceToDemoStep() {
  // welcome -> profession
  fireEvent.click(screen.getByRole('button', { name: /let's go/i }));
  // profession -> workspace (no profession picked, so the in-step CTA reads "Skip for now")
  clickLastSkip();
  // workspace -> apikey
  fireEvent.click(screen.getByRole('button', { name: /^Got it$/i }));
  // apikey -> demo (skip entering a key)
  clickLastSkip();
}

describe('FirstRunWizard sample population (Q11)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the samples toggle, defaulting to ON', () => {
    const workspace = makeMockWorkspace();
    render(
      <FirstRunWizard
        onComplete={vi.fn()}
        onSkip={vi.fn()}
        workspace={workspace}
      />
    );
    advanceToDemoStep();
    const toggle = screen.getByTestId('first-run-samples-toggle') as HTMLInputElement;
    expect(toggle).toBeInTheDocument();
    expect(toggle.checked).toBe(true);
  });

  it('calls workspace.writeFile 3 times when the toggle is on and wizard finishes', async () => {
    const workspace = makeMockWorkspace();
    const onComplete = vi.fn();
    render(
      <FirstRunWizard onComplete={onComplete} onSkip={vi.fn()} workspace={workspace} />
    );
    advanceToDemoStep();

    // toggle defaults to ON. Click the final CTA.
    const finishBtn = screen.getByRole('button', { name: /open my workspace/i });
    fireEvent.click(finishBtn);

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(workspace.writeFile).toHaveBeenCalledTimes(3);

    // Verify each written file is one of the expected samples.
    const writtenNames = workspace.writeFile.mock.calls.map((c) => c[0]).sort();
    expect(writtenNames).toEqual([
      'Sample - Client Intake.md',
      'Sample - Pricing Strategy.md',
      'Sample - Weekly Review.md',
    ]);
  });

  it('does NOT write samples when the toggle is turned off', async () => {
    const workspace = makeMockWorkspace();
    const onComplete = vi.fn();
    render(
      <FirstRunWizard onComplete={onComplete} onSkip={vi.fn()} workspace={workspace} />
    );
    advanceToDemoStep();

    // Turn the toggle off
    const toggle = screen.getByTestId('first-run-samples-toggle');
    fireEvent.click(toggle);

    fireEvent.click(screen.getByRole('button', { name: /open my workspace/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(workspace.writeFile).not.toHaveBeenCalled();
  });

  it('marks onboarding complete in localStorage after finish', async () => {
    const workspace = makeMockWorkspace();
    render(
      <FirstRunWizard onComplete={vi.fn()} onSkip={vi.fn()} workspace={workspace} />
    );
    advanceToDemoStep();
    fireEvent.click(screen.getByRole('button', { name: /open my workspace/i }));

    await waitFor(() =>
      expect(localStorage.getItem('keepance_onboarding_complete')).toBe('true')
    );
  });
});
