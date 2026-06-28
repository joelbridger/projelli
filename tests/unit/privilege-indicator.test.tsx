/**
 * WS-PRIV — the PrivilegeIndicator reflects a source's privilege status: it
 * renders a labelled badge for privileged statuses and NOTHING for "none"
 * (non-privileged content gets no badge, to avoid noise).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PrivilegeIndicator } from '@/features/firm/privilege/PrivilegeIndicator';
import { useProfessionStore } from '@/platform/profile/professionStore';

describe('PrivilegeIndicator', () => {
  // The indicator labels are profession-aware (NEW-015): a law practice sees the
  // legal doctrine names; every other practice sees plain "Sensitive". Pin the
  // profession per block so the assertions are deterministic, and restore the
  // app default ('advisor') after each test so it never leaks to other suites.
  beforeEach(() => { useProfessionStore.getState().setProfession('legal'); });
  afterEach(() => { cleanup(); useProfessionStore.getState().setProfession('advisor'); });

  it('renders nothing for "none"', () => {
    const { container } = render(<PrivilegeIndicator privilege="none" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('privilege-indicator')).toBeNull();
  });

  it('renders an attorney-client badge (legal labels)', () => {
    render(<PrivilegeIndicator privilege="attorney-client" />);
    const el = screen.getByTestId('privilege-indicator');
    expect(el).toHaveAttribute('data-privilege', 'attorney-client');
    expect(el.getAttribute('title')).toContain('excluded from AI retrieval by default');
    expect(el.textContent).toContain('Privileged');
  });

  it('renders a work-product badge (legal labels)', () => {
    render(<PrivilegeIndicator privilege="work-product" />);
    const el = screen.getByTestId('privilege-indicator');
    expect(el).toHaveAttribute('data-privilege', 'work-product');
    expect(el.textContent).toContain('Work Product');
  });

  it('relabels privileged statuses as "Sensitive" for a non-legal practice (advisor)', () => {
    useProfessionStore.getState().setProfession('advisor');
    render(<PrivilegeIndicator privilege="attorney-client" />);
    const el = screen.getByTestId('privilege-indicator');
    expect(el.textContent).toContain('Sensitive');
    expect(el.textContent).not.toContain('Privileged');
    expect(el.getAttribute('title')).toContain('Sensitive');
  });

  it('compact mode hides the text label but keeps the data attribute', () => {
    render(<PrivilegeIndicator privilege="attorney-client" compact />);
    const el = screen.getByTestId('privilege-indicator');
    expect(el).toHaveAttribute('data-privilege', 'attorney-client');
    // Compact => icon only, no visible "Privileged" text.
    expect(el.textContent).toBe('');
  });
});
