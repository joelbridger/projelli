import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrustNote } from './TrustNote';

describe('TrustNote', () => {
  it('renders the one-line trust copy, quiet (default variant) by default', () => {
    const copy = 'Review first. Sends by your email.';
    render(
      <TrustNote data-testid="tn">
        {copy}
      </TrustNote>,
    );
    const el = screen.getByTestId('tn');
    expect(el.className).toContain('kp-trustnote');
    expect(el.className).toContain('kp-trustnote--default');
    expect(el.textContent).toContain(copy);
  });

  it('applies the amber warning variant', () => {
    const copy = 'This sends to everyone.';
    render(
      <TrustNote data-testid="tn" variant="warning">
        {copy}
      </TrustNote>,
    );
    expect(screen.getByTestId('tn').className).toContain('kp-trustnote--warning');
  });

  it('exposes the blocker variant as an alert region', () => {
    const copy = 'Recording is not allowed here.';
    render(
      <TrustNote data-testid="tn" variant="blocker">
        {copy}
      </TrustNote>,
    );
    const el = screen.getByTestId('tn');
    expect(el.className).toContain('kp-trustnote--blocker');
    expect(el.getAttribute('role')).toBe('alert');
  });

  it('keeps the long explanation on demand: details becomes the line tooltip', () => {
    const copy = 'Sent to your AI provider.';
    render(
      <TrustNote data-testid="tn" details="The request goes to your provider with your own key.">
        {copy}
      </TrustNote>,
    );
    const el = screen.getByTestId('tn');
    expect(el.getAttribute('title')).toBe(
      'The request goes to your provider with your own key.',
    );
  });
});
