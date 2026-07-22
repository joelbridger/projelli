import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDevFlagOverride } from '@/platform/flags';
import { ScopeToggle } from './ScopeToggle';

describe('ScopeToggle', () => {
  afterEach(() => {
    setDevFlagOverride('own-clients-permissions', undefined);
  });

  it('omits all-client and Whole book choices until staff permissions are ready', async () => {
    const onChange = vi.fn();
    render(
      <ScopeToggle
        scope="all-matters"
        onChange={onChange}
        hasMatter={false}
        isSample={false}
      />,
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('documents');
    });
    expect(screen.getByTestId('scope-toggle').textContent).toContain('Docs');
    expect(screen.queryByTestId('scope-option-all-matters')).toBeNull();

    fireEvent.pointerDown(screen.getByTestId('scope-toggle'), { button: 0, ctrlKey: false });

    expect(screen.queryByTestId('scope-option-this-matter')).toBeNull();
    expect(screen.queryByTestId('scope-option-all-matters')).toBeNull();
    expect(screen.getByTestId('scope-option-email')).toBeTruthy();
    expect(screen.getByTestId('scope-option-documents')).toBeTruthy();
    expect(screen.queryByTestId('scope-option-whole-practice')).toBeNull();
  });

  it('keeps the deferred scopes available once staff permissions are enabled', () => {
    setDevFlagOverride('own-clients-permissions', true);
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

    fireEvent.pointerDown(screen.getByTestId('scope-toggle'), { button: 0, ctrlKey: false });
    expect(screen.getByTestId('scope-option-all-matters')).toBeTruthy();
    expect(screen.getByTestId('scope-option-whole-practice')).toBeTruthy();
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
      expect(onChange).toHaveBeenCalledWith('documents');
    });
  });
});
