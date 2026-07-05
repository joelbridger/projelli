import '@/i18n';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WholePracticeSendConfirm } from '@/features/ask/book/WholePracticeSendConfirm';

describe('WholePracticeSendConfirm (R6)', () => {
  it('names the real client count and provider, and confirms only on Continue', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <WholePracticeSendConfirm
        open
        clientCount={12}
        providerName="Anthropic"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const body = screen.getByTestId('whole-practice-confirm-body').textContent ?? '';
    expect(body).toContain('12');
    expect(body).toContain('Anthropic');

    // Nothing sent until the advisor presses Continue.
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('whole-practice-confirm-continue'));
    // remember defaults to false (default ask)
    expect(onConfirm).toHaveBeenCalledWith({ remember: false });
  });

  it('passes the remember choice through when the box is checked', () => {
    const onConfirm = vi.fn();
    render(
      <WholePracticeSendConfirm
        open
        clientCount={3}
        providerName="OpenAI"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('whole-practice-confirm-remember'));
    fireEvent.click(screen.getByTestId('whole-practice-confirm-continue'));
    expect(onConfirm).toHaveBeenCalledWith({ remember: true });
  });

  it('falls back to a generic provider label when the provider is unknown', () => {
    render(
      <WholePracticeSendConfirm
        open
        clientCount={5}
        providerName={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const body = screen.getByTestId('whole-practice-confirm-body').textContent ?? '';
    expect(body).toContain('5');
    // A non-empty destination label always renders (never a blank).
    expect(body.trim().length).toBeGreaterThan(10);
  });
});
