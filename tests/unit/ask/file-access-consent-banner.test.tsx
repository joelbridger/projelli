/**
 * F2.5 — the inline file-access consent affordance (FileAccessConsentBanner).
 *
 * Locks: self-hides for local / no provider; shows the "Allow" prompt for a
 * cloud provider when file access is gated off; shows the "on" state when
 * granted; re-asks after a client switch and on an all-clients turn; wires the
 * right consent object (with the current scope) to onChange.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileAccessConsentBanner } from '@/features/ask/chat/FileAccessConsentBanner';
import type { ConsentScope } from '@/platform/ai/fileAccessConsent';

const A: ConsentScope = { kind: 'matter', matterId: 'client-A' };
const B: ConsentScope = { kind: 'matter', matterId: 'client-B' };
const ALL: ConsentScope = { kind: 'allMatters' };

const base = {
  consentScope: A,
  scopeLabel: 'Acme Corp',
  onChange: () => {},
};

describe('FileAccessConsentBanner — visibility', () => {
  it('renders nothing for a local provider', () => {
    const { container } = render(
      <FileAccessConsentBanner {...base} effectiveProvider="ollama" consent={{ state: 'unasked' }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
  it('renders nothing when no provider', () => {
    const { container } = render(
      <FileAccessConsentBanner {...base} effectiveProvider="none" consent={{ state: 'unasked' }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('FileAccessConsentBanner — cloud, gated off', () => {
  it('shows the Allow prompt when unasked, and grants with the current scope', () => {
    const onChange = vi.fn();
    render(
      <FileAccessConsentBanner
        {...base}
        onChange={onChange}
        effectiveProvider="anthropic"
        consent={{ state: 'unasked' }}
      />,
    );
    expect(screen.getByTestId('chat-file-access-consent')).toHaveAttribute('data-state', 'unasked');
    fireEvent.click(screen.getByTestId('chat-file-access-allow'));
    expect(onChange).toHaveBeenCalledWith({ state: 'granted', grantedScope: A });
  });

  it('"Not now" records a denial', () => {
    const onChange = vi.fn();
    render(
      <FileAccessConsentBanner
        {...base}
        onChange={onChange}
        effectiveProvider="openai"
        consent={{ state: 'unasked' }}
      />,
    );
    fireEvent.click(screen.getByTestId('chat-file-access-deny'));
    expect(onChange).toHaveBeenCalledWith({ state: 'denied' });
  });

  it('denied shows the compact "off · Allow" line', () => {
    render(
      <FileAccessConsentBanner
        {...base}
        effectiveProvider="anthropic"
        consent={{ state: 'denied' }}
      />,
    );
    expect(screen.getByTestId('chat-file-access-consent')).toHaveAttribute('data-state', 'denied');
    expect(screen.getByTestId('chat-file-access-allow')).toBeInTheDocument();
  });
});

describe('FileAccessConsentBanner — granted', () => {
  it('shows the "on" state and can turn off (reset to unasked)', () => {
    const onChange = vi.fn();
    render(
      <FileAccessConsentBanner
        {...base}
        onChange={onChange}
        effectiveProvider="google"
        consent={{ state: 'granted', grantedScope: A }}
      />,
    );
    expect(screen.getByTestId('chat-file-access-consent')).toHaveAttribute('data-state', 'granted');
    fireEvent.click(screen.getByTestId('chat-file-access-turn-off'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('FileAccessConsentBanner — scope re-confirm', () => {
  it('re-asks after switching to a DIFFERENT client (grant does not widen)', () => {
    const onChange = vi.fn();
    render(
      <FileAccessConsentBanner
        effectiveProvider="anthropic"
        consentScope={B}
        scopeLabel="Beta LLC"
        consent={{ state: 'granted', grantedScope: A }}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId('chat-file-access-consent')).toHaveAttribute('data-state', 'reconfirm');
    fireEvent.click(screen.getByTestId('chat-file-access-allow'));
    expect(onChange).toHaveBeenCalledWith({ state: 'granted', grantedScope: B });
  });

  it('re-asks on an all-clients turn after a single-client grant', () => {
    const onChange = vi.fn();
    render(
      <FileAccessConsentBanner
        effectiveProvider="anthropic"
        consentScope={ALL}
        scopeLabel="all your clients"
        consent={{ state: 'granted', grantedScope: A }}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId('chat-file-access-consent')).toHaveAttribute('data-state', 'reconfirm');
    fireEvent.click(screen.getByTestId('chat-file-access-allow'));
    expect(onChange).toHaveBeenCalledWith({ state: 'granted', grantedScope: ALL });
  });

  it('treats an all-clients grant as on for an all-clients turn', () => {
    render(
      <FileAccessConsentBanner
        effectiveProvider="anthropic"
        consentScope={ALL}
        scopeLabel="all your clients"
        consent={{ state: 'granted', grantedScope: ALL }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId('chat-file-access-consent')).toHaveAttribute('data-state', 'granted');
  });
});
