import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScopeToggle } from './ScopeToggle';

describe('ScopeToggle', () => {
  it('renders one compact menu with every scope option', () => {
    render(
      <ScopeToggle
        scope="all-matters"
        onChange={() => {}}
        hasMatter={false}
        isSample={false}
      />,
    );

    expect(screen.getByTestId('scope-toggle').textContent).toContain('All');
    expect(screen.queryByTestId('scope-option-all-matters')).toBeNull();

    fireEvent.pointerDown(screen.getByTestId('scope-toggle'), { button: 0, ctrlKey: false });

    expect(screen.queryByTestId('scope-option-this-matter')).toBeNull();
    expect(screen.getByTestId('scope-option-all-matters')).toBeTruthy();
    expect(screen.getByTestId('scope-option-email')).toBeTruthy();
    expect(screen.getByTestId('scope-option-documents')).toBeTruthy();
    expect(screen.getByTestId('scope-option-whole-practice')).toBeTruthy();
  });

  it('keeps Book selected when whole-practice scope is active', () => {
    const onChange = vi.fn();

    render(
      <ScopeToggle
        scope="whole-practice"
        onChange={onChange}
        hasMatter={false}
        isSample={false}
      />,
    );

    expect(screen.getByTestId('scope-toggle').textContent).toContain('Book');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('normalizes a stale this-client scope to the default visible choice', async () => {
    const onChange = vi.fn();

    render(
      <ScopeToggle
        scope="this-matter"
        onChange={onChange}
        hasMatter={false}
        isSample={false}
      />,
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('all-matters');
    });
  });
});
