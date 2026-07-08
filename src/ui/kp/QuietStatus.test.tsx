import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuietStatus } from './QuietStatus';


describe('QuietStatus', () => {
  it('shows a quiet muted tick + text in the normal-good state', () => {
    render(<QuietStatus data-testid="qs">Saved</QuietStatus>);
    const el = screen.getByTestId('qs');
    expect(el.className).toContain('kp-quietstatus--ok');
    expect(el.textContent).toContain('Saved');
  });

  it('renders NOTHING when the state is ok and there is nothing to say', () => {
    const { container } = render(<QuietStatus state="ok" />);
    expect(container.firstChild).toBeNull();
  });

  it('gets loud only when the caller passes failure, as an alert', () => {
    const copy = "Couldn't save";
    render(
      <QuietStatus data-testid="qs" state="failure">
        {copy}
      </QuietStatus>,
    );
    const el = screen.getByTestId('qs');
    expect(el.className).toContain('kp-quietstatus--failure');
    expect(el.getAttribute('role')).toBe('alert');
  });

  it('stays quiet (status role) in the pending state', () => {
    render(
      <QuietStatus data-testid="qs" state="pending">
        Indexing
      </QuietStatus>,
    );
    const el = screen.getByTestId('qs');
    expect(el.className).toContain('kp-quietstatus--pending');
    expect(el.getAttribute('role')).toBe('status');
  });
});
