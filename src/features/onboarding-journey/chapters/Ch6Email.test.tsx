/// <reference types="@testing-library/jest-dom" />

/**
 * Ch6Email tests
 *
 * Mocking strategy:
 * - MailConnect, MailGmailConnect, MailImapConnect are mocked to simple stubs
 *   that render a visible label. This prevents the real Tauri-command calls
 *   (outlookConnect, gmailConnect, etc.) from running in jsdom.
 * - We assert tab switching swaps the mounted connector, that "Continue" calls
 *   ctx.setData({ emailConnected: true }) + ctx.advance(), and that
 *   "Connect later" calls ctx.advance() without setting emailConnected.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChapterContext, JourneyData } from '../engine/types';

// ---------------------------------------------------------------------------
// Mock the mail connector modules
// ---------------------------------------------------------------------------

vi.mock('@/features/settings/MailConnect', () => ({
  MailConnect: () => <div data-testid="mock-mail-connect">M365 panel</div>,
}));

vi.mock('@/features/settings/MailGmailConnect', () => ({
  MailGmailConnect: () => <div data-testid="mock-mail-gmail">Gmail panel</div>,
}));

vi.mock('@/features/settings/MailImapConnect', () => ({
  MailImapConnect: () => <div data-testid="mock-mail-imap">IMAP panel</div>,
}));

// ---------------------------------------------------------------------------
// Import the module under test (after mocks)
// ---------------------------------------------------------------------------

import { ch6Email } from './Ch6Email';

// ---------------------------------------------------------------------------
// Helper: stub ChapterContext
// ---------------------------------------------------------------------------

function makeCtx(data: JourneyData = {}): ChapterContext {
  return {
    advance: vi.fn(),
    goBack: vi.fn(),
    skipAll: vi.fn(),
    complete: vi.fn(),
    setData: vi.fn(),
    data,
    reducedMotion: true,
    actions: {
      saveApiKey: vi.fn().mockResolvedValue(undefined),
      setConfidentialityMode: vi.fn(),
      chooseWorkspaceFolder: vi.fn().mockResolvedValue('/tmp/ws'),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ch6Email — metadata', () => {
  it('has id "email"', () => {
    expect(ch6Email.id).toBe('email');
  });

  it('has title "Email"', () => {
    expect(ch6Email.title).toBe('Email');
  });
});

describe('ch6Email — initial render', () => {
  it('renders the chapter title', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Bring in your email');
  });

  it('renders body copy about inbox search', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    expect(screen.getByText(/No more fighting slow inbox search/i)).toBeInTheDocument();
  });

  it('shows the three provider tabs', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    expect(screen.getByTestId('ch6-tab-m365')).toBeInTheDocument();
    expect(screen.getByTestId('ch6-tab-gmail')).toBeInTheDocument();
    expect(screen.getByTestId('ch6-tab-imap')).toBeInTheDocument();
  });

  it('defaults to the Microsoft 365 tab', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    expect(screen.getByTestId('mock-mail-connect')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-mail-gmail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-mail-imap')).not.toBeInTheDocument();
  });
});

describe('ch6Email — tab switching', () => {
  it('clicking Gmail tab shows the Gmail panel', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    fireEvent.click(screen.getByTestId('ch6-tab-gmail'));
    expect(screen.getByTestId('mock-mail-gmail')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-mail-connect')).not.toBeInTheDocument();
  });

  it('clicking IMAP tab shows the IMAP panel', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    fireEvent.click(screen.getByTestId('ch6-tab-imap'));
    expect(screen.getByTestId('mock-mail-imap')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-mail-connect')).not.toBeInTheDocument();
  });

  it('switching back to M365 tab shows the M365 panel', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    fireEvent.click(screen.getByTestId('ch6-tab-gmail'));
    fireEvent.click(screen.getByTestId('ch6-tab-m365'));
    expect(screen.getByTestId('mock-mail-connect')).toBeInTheDocument();
  });
});

describe('ch6Email — Connect later', () => {
  it('renders a "Connect later" button', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    expect(screen.getByTestId('ch6-connect-later')).toBeInTheDocument();
  });

  it('"Connect later" calls ctx.advance() without setting emailConnected', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    fireEvent.click(screen.getByTestId('ch6-connect-later'));
    expect(ctx.advance).toHaveBeenCalledOnce();
    // setData should NOT have been called with emailConnected (may be called with other patches)
    const setDataCalls = (ctx.setData as ReturnType<typeof vi.fn>).mock.calls as unknown as [Partial<JourneyData>][];
    const calledWithEmailConnected = setDataCalls.some(
      ([patch]) => 'emailConnected' in patch,
    );
    expect(calledWithEmailConnected).toBe(false);
  });
});

describe('ch6Email — Continue (after connecting)', () => {
  it('renders a "Continue" button', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    expect(screen.getByTestId('ch6-continue')).toBeInTheDocument();
  });

  it('"Continue" calls ctx.setData({ emailConnected: true }) then ctx.advance()', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    fireEvent.click(screen.getByTestId('ch6-continue'));
    expect(ctx.setData).toHaveBeenCalledWith({ emailConnected: true });
    expect(ctx.advance).toHaveBeenCalledOnce();
  });
});

describe('ch6Email — Back navigation', () => {
  it('renders a Back button', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    expect(screen.getByTestId('chapter-back')).toBeInTheDocument();
  });

  it('clicking Back calls ctx.goBack()', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    fireEvent.click(screen.getByTestId('chapter-back'));
    expect(ctx.goBack).toHaveBeenCalledOnce();
  });
});

describe('ch6Email — accessibility', () => {
  it('focuses the h2 heading on mount', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    const heading = screen.getByTestId('ch6-heading');
    expect(document.activeElement).toBe(heading);
  });

  it('the h2 has tabIndex=-1', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    expect(screen.getByTestId('ch6-heading')).toHaveAttribute('tabindex', '-1');
  });

  it('email provider buttons use aria-pressed, not role="tab"', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    const m365Btn = screen.getByTestId('ch6-tab-m365');
    expect(m365Btn).not.toHaveAttribute('role', 'tab');
    expect(m365Btn).toHaveAttribute('aria-pressed');
  });

  it('the active provider button has aria-pressed="true", others have aria-pressed="false"', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    // M365 is selected by default
    expect(screen.getByTestId('ch6-tab-m365')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('ch6-tab-gmail')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('ch6-tab-imap')).toHaveAttribute('aria-pressed', 'false');
  });

  it('the container uses role="group" not role="tablist"', () => {
    const ctx = makeCtx();
    render(ch6Email.render(ctx));
    const group = screen.getByTestId('ch6-provider-group');
    expect(group).toHaveAttribute('role', 'group');
    expect(group).not.toHaveAttribute('role', 'tablist');
  });
});
