import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrustNote } from './TrustNote';

const DEFAULT_NOTE = 'Review first. Sends by your email.';
const WARNING_NOTE = 'This sends to everyone.';
const BLOCKER_NOTE = 'Recording is not allowed here.';
const PROVIDER_NOTE = 'Sent to your AI provider.';
const PROVIDER_DETAILS = 'The request goes to your provider with your own key.';

describe('TrustNote', () => {
  it('renders the one-line trust copy, quiet (default variant) by default', () => {
    render(<TrustNote data-testid="tn">{DEFAULT_NOTE}</TrustNote>);
    const el = screen.getByTestId('tn');
    expect(el.className).toContain('kp-trustnote');
    expect(el.className).toContain('kp-trustnote--default');
    expect(el.textContent).toContain(DEFAULT_NOTE);
  });

  it('applies the amber warning variant', () => {
    render(
      <TrustNote data-testid="tn" variant="warning">
        {WARNING_NOTE}
      </TrustNote>,
    );
    expect(screen.getByTestId('tn').className).toContain('kp-trustnote--warning');
  });

  it('exposes the blocker variant as an alert region', () => {
    render(
      <TrustNote data-testid="tn" variant="blocker">
        {BLOCKER_NOTE}
      </TrustNote>,
    );
    const el = screen.getByTestId('tn');
    expect(el.className).toContain('kp-trustnote--blocker');
    expect(el.getAttribute('role')).toBe('alert');
  });

  it('keeps the long explanation on demand: details becomes the line tooltip', () => {
    render(
      <TrustNote data-testid="tn" details={PROVIDER_DETAILS}>
        {PROVIDER_NOTE}
      </TrustNote>,
    );
    const el = screen.getByTestId('tn');
    expect(el.getAttribute('title')).toBe(PROVIDER_DETAILS);
  });
});
