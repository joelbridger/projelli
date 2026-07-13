import '@/i18n';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CrmAskSurface } from './CrmAskSurface';

describe('CrmAskSurface answer scope', () => {
  beforeEach(() => {
    localStorage.setItem('lantern:ask-files-only', '1');
  });

  afterEach(() => {
    localStorage.removeItem('lantern:ask-files-only');
  });

  it('lets an advisor turn off files-only mode so CRM records can be used', () => {
    render(<CrmAskSurface />);

    fireEvent.click(screen.getByTestId('ask-answer-scope-chip'));
    const toggle = screen.getByTestId('ask-files-only-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(localStorage.getItem('lantern:ask-files-only')).toBe('0');
  });
});
