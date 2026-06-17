import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PdfModeChip } from '@/features/ask/chat/PdfModeChip';

describe('PdfModeChip', () => {
  it('renders "Native PDF" label for native mode', () => {
    render(<PdfModeChip mode="native" />);
    expect(screen.getByTestId('pdf-mode-chip').textContent).toContain('Native PDF');
  });

  it('renders "Text extract" label for text-extract mode', () => {
    render(<PdfModeChip mode="text-extract" />);
    expect(screen.getByTestId('pdf-mode-chip').textContent).toContain('Text extract');
  });

  it('chip has data-testid="pdf-mode-chip"', () => {
    render(<PdfModeChip mode="native" />);
    expect(screen.getByTestId('pdf-mode-chip')).toBeTruthy();
  });

  it('native chip has distinct styling class from text-extract chip', () => {
    const { container: c1, unmount: u1 } = render(<PdfModeChip mode="native" />);
    const nativeClass = c1.querySelector('[data-testid="pdf-mode-chip"]')?.className ?? '';
    u1();
    const { container: c2 } = render(<PdfModeChip mode="text-extract" />);
    const textClass = c2.querySelector('[data-testid="pdf-mode-chip"]')?.className ?? '';
    expect(nativeClass).not.toBe(textClass);
  });

  it('accepts optional className prop', () => {
    render(<PdfModeChip mode="native" className="test-extra" />);
    const chip = screen.getByTestId('pdf-mode-chip');
    expect(chip.className).toContain('test-extra');
  });
});
