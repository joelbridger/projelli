/**
 * RecoveryPhraseCeremony.test.tsx
 * RTL tests for the mandatory confirmed recovery-phrase ceremony.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecoveryPhraseCeremony } from '@/features/firm/vault/RecoveryPhraseCeremony';

const PHRASE_24 = Array.from({ length: 24 }, (_, i) => `word${i + 1}`).join(' ');

describe('RecoveryPhraseCeremony', () => {
  it('(a) displays all 24 words of the phrase', () => {
    render(<RecoveryPhraseCeremony phrase={PHRASE_24} onConfirmed={vi.fn()} />);
    // Each word is displayed somewhere
    for (let i = 1; i <= 24; i++) {
      expect(screen.getByText(`word${i}`)).toBeDefined();
    }
  });

  it('(b) shows the "cannot recover" warning', () => {
    render(<RecoveryPhraseCeremony phrase={PHRASE_24} onConfirmed={vi.fn()} />);
    expect(screen.getByTestId('cannot-recover-warning')).toBeDefined();
    // The warning text must mention "cannot recover"
    const warning = screen.getByTestId('cannot-recover-warning');
    expect(warning.textContent?.toLowerCase()).toContain('cannot recover');
  });

  it('(c) Activate button is disabled initially (before correct entries)', () => {
    render(<RecoveryPhraseCeremony phrase={PHRASE_24} onConfirmed={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /activate/i });
    expect(btn).toBeDisabled();
  });

  it('(d) wrong entries keep the button disabled', () => {
    render(<RecoveryPhraseCeremony phrase={PHRASE_24} onConfirmed={vi.fn()} />);
    // Fill all 3 confirm inputs with the wrong value
    const inputs = screen.getAllByRole('textbox');
    // Filter to only the confirmation inputs (they have a placeholder with "Word #")
    const confirmInputs = inputs.filter((el) =>
      el.getAttribute('placeholder')?.toLowerCase().includes('word'),
    );
    for (const input of confirmInputs) {
      fireEvent.change(input, { target: { value: 'wrongword' } });
    }
    const btn = screen.getByRole('button', { name: /activate/i });
    expect(btn).toBeDisabled();
  });

  it('(e) correct entries enable the button and call onConfirmed when clicked', () => {
    const onConfirmed = vi.fn();
    render(<RecoveryPhraseCeremony phrase={PHRASE_24} onConfirmed={onConfirmed} />);

    // The component must expose data-testid attributes on each confirmation input
    // labeling which word position it asks for, so we can fill in the right word.
    const confirmInputs = screen.getAllByTestId(/^confirm-input-/);

    for (const input of confirmInputs) {
      const testId = input.getAttribute('data-testid') ?? '';
      // data-testid="confirm-input-3" means it asks for word at position 3 (1-indexed)
      const posMatch = testId.match(/confirm-input-(\d+)/);
      if (posMatch) {
        const pos = parseInt(posMatch[1], 10);
        const words = PHRASE_24.split(' ');
        const correctWord = words[pos - 1] ?? '';
        fireEvent.change(input, { target: { value: correctWord } });
      }
    }

    const btn = screen.getByRole('button', { name: /activate/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onConfirmed).toHaveBeenCalledOnce();
  });
});
