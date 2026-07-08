import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrustNote } from './TrustNote';

describe('TrustNote', () => {
  it('renders the one-line trust copy, quiet (default variant) by default', () => {
    render(<TrustNote data-testid="tn">Review first. Sends by your email.</TrustNote>);
    const el = screen.getByTestId('tn');
    expect(el.className).toContain('kp-trustnote');
    expect(el.className).toContain('kp-trustnote--default');
    expect(el.textContent).toContain('Review first. Sends by your email.');
  });

  it('applies the amber warning variant', () => {
    render(
      <TrustNote data-testid="tn" variant="warning">
        This sends to everyone.
      </TrustNote>,
    );
    expect(screen.getByTestId('tn').className).toContain('kp-trustnote--warning');
  });

  it('exposes the blocker variant as an alert region', () => {
    render(
      <TrustNote data-testid="tn" variant="blocker">
        Recording is not allowed here.
      </TrustNote>,
    );
    const el = screen.getByTestId('tn');
    expect(el.className).toContain('kp-trustnote--blocker');
    expect(el.getAttribute('role')).toBe('alert');
  });

  it('keeps the long explanation on demand: details becomes the line tooltip', () => {
    render(
      <TrustNote data-testid="tn" details="The request goes to your provider with your own key.">
        Sent to your AI provider.
      </TrustNote>,
    );
    const el = screen.getByTestId('tn');
    expect(el.getAttribute('title')).toBe(
      'The request goes to your provider with your own key.',
    );
  });
});
