/**
 * Email reading view from an Ask result — Wave 2 email relocation.
 *
 * Clicking an email citation in an Ask answer must open the light EmailViewer
 * reading view. The mechanism is the existing `keepance:open-email` event
 * (sourceId = the `mail:<id>` path) → useOpenEmailListener opens the email tab.
 * These tests prove BOTH entry points dispatch it:
 *   - the inline citation chip (CitationText, via onOpenFileAtPath)
 *   - the SourcePanel "Open email" button
 * and that a document citation keeps its (separate) editor escalation, gated on
 * onOpenFile so it's never a dead button.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SourcePanel } from '@/features/ask/SourcePanel';
import { CitationText } from '@/features/ask/CitationText';
import type { AnswerCitation } from '@/features/ask/askHelpers';

// The relocated citation-open actions are gated on newNav; flag-OFF keeps the
// shipped (no-op) "Open in editor" button. Toggle the flag per test.
const nav = vi.hoisted(() => ({ on: true }));
vi.mock('@/platform/flags/newNav', () => ({
  useNewNav: () => nav.on,
  isNewNavEnabled: () => nav.on,
}));

beforeEach(() => { nav.on = true; });
afterEach(() => { cleanup(); });

const emailCite: AnswerCitation = {
  n: 1, label: 'Re: Trust funding', excerpt: 'As discussed, the trust...',
  path: 'mail:abc123', locator: '', verified: true,
};
const docCite: AnswerCitation = {
  n: 1, label: 'lease.docx', excerpt: 'The tenant shall...',
  path: 'Contracts/lease.docx', locator: 'p.2', verified: true, paragraphIndex: 1,
};
const docCiteWithMatter: AnswerCitation = { ...docCite, matterId: 'matter_demo_brennan' };

describe('SourcePanel — email reading view', () => {
  it('renders an "Open email" action for an email citation and dispatches keepance:open-email', () => {
    const onOpen = vi.fn();
    window.addEventListener('keepance:open-email', onOpen as EventListener);
    render(<SourcePanel cite={emailCite} />);
    const btn = screen.getByTestId('source-open-email');
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
    const detail = (onOpen.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail).toEqual({ sourceId: 'mail:abc123' });
    window.removeEventListener('keepance:open-email', onOpen as EventListener);
  });

  it('does NOT render the email button for a document citation', () => {
    render(<SourcePanel cite={docCite} />);
    expect(screen.queryByTestId('source-open-email')).not.toBeInTheDocument();
  });

  it('hides "Open in editor" for a document citation with no matterId (cannot be scoped)', () => {
    render(<SourcePanel cite={docCite} />);
    expect(screen.queryByTestId('source-open-document')).not.toBeInTheDocument();
  });

  it('opens a document citation via keepance:matter-launch (matter-scoped, scrolls to passage)', () => {
    const onLaunch = vi.fn();
    window.addEventListener('keepance:matter-launch', onLaunch as EventListener);
    render(<SourcePanel cite={docCiteWithMatter} />);
    fireEvent.click(screen.getByTestId('source-open-document'));
    expect(onLaunch).toHaveBeenCalledTimes(1);
    const detail = (onLaunch.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail).toEqual({
      matterId: 'matter_demo_brennan',
      surface: 'files',
      source: { kind: 'document', ref: 'Contracts/lease.docx', snippet: 'The tenant shall...' },
    });
    window.removeEventListener('keepance:matter-launch', onLaunch as EventListener);
  });

  it('does NOT render the document button for an email citation', () => {
    render(<SourcePanel cite={emailCite} />);
    expect(screen.queryByTestId('source-open-document')).not.toBeInTheDocument();
  });

  it('does NOT render the document opener for a CRM citation (crm: has its own route)', () => {
    const crmCite: AnswerCitation = {
      n: 1, label: 'Household', excerpt: 'AUM $2.1M', path: 'crm:household:abc123',
      locator: '', verified: true, matterId: 'matter_demo_brennan',
    };
    render(<SourcePanel cite={crmCite} />);
    expect(screen.queryByTestId('source-open-document')).not.toBeInTheDocument();
  });
});

describe('SourcePanel — flag-OFF keeps the shipped (no-op) button', () => {
  it('renders a single legacy "Open in editor" button and none of the new actions', () => {
    nav.on = false;
    render(<SourcePanel cite={docCiteWithMatter} />);
    // The relocated newNav actions are absent.
    expect(screen.queryByTestId('source-open-document')).not.toBeInTheDocument();
    expect(screen.queryByTestId('source-open-email')).not.toBeInTheDocument();
    // The shipped button is present (no-op without onOpenFile — byte-for-byte).
    expect(screen.getByText('Open in editor')).toBeInTheDocument();
  });

  it('flag-OFF email citation shows the shipped button, not "Open email"', () => {
    nav.on = false;
    render(<SourcePanel cite={emailCite} />);
    expect(screen.queryByTestId('source-open-email')).not.toBeInTheDocument();
    expect(screen.getByText('Open in editor')).toBeInTheDocument();
  });
});

describe('CitationText — email chip opens the reading view', () => {
  it('calls onOpenFileAtPath with the mail: path when an email chip is clicked', () => {
    const onOpenFileAtPath = vi.fn();
    render(
      <CitationText
        text="The trust is funded {1}."
        citations={[emailCite]}
        selected={null}
        onSelect={vi.fn()}
        onOpenFileAtPath={onOpenFileAtPath}
      />,
    );
    fireEvent.click(screen.getByTestId('ask-citation-chip-1'));
    expect(onOpenFileAtPath).toHaveBeenCalledWith('mail:abc123', 0, expect.anything());
  });
});
