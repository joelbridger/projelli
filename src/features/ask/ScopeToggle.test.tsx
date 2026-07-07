import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScopeToggle } from './ScopeToggle';

describe('ScopeToggle', () => {
  it('does not render the hidden whole-practice entry point', () => {
    render(
      <ScopeToggle
        scope="all-matters"
        onChange={() => {}}
        hasMatter={false}
        isSample={false}
      />,
    );

    expect(screen.queryByTestId('scope-option-whole-practice')).toBeNull();
    expect(screen.getByTestId('scope-option-all-matters').className).toContain('kp-chip--pill');
    expect(screen.getByTestId('scope-option-email').className).toContain('kp-chip--pill');
    expect(screen.getByTestId('scope-option-documents').className).toContain('kp-chip--pill');
    expect(screen.getByTestId('scope-option-all-matters').getAttribute('style') ?? '').not.toContain('padding');
  });

  it('normalizes a stale whole-practice scope to the default visible choice', async () => {
    const onChange = vi.fn();

    render(
      <ScopeToggle
        scope="whole-practice"
        onChange={onChange}
        hasMatter={false}
        isSample={false}
      />,
    );

    expect(screen.getByTestId('scope-option-all-matters').getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('all-matters');
    });
  });
});
