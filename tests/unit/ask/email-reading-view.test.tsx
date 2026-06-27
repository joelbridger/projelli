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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SourcePanel } from '@/features/ask/SourcePanel';
import { CitationText } from '@/features/ask/CitationText';
import type { AnswerCitation } from '@/features/ask/askHelpers';

afterEach(() => { cleanup(); });

const emailCite: AnswerCitation = {
  n: 1, label: 'Re: Trust funding', excerpt: 'As discussed, the trust...',
  path: 'mail:abc123', locator: '', verified: true,
};
const docCite: AnswerCitation = {
  n: 1, label: 'lease.docx', excerpt: 'The tenant shall...',
  path: 'Contracts/lease.docx', locator: 'p.2', verified: true, paragraphIndex: 1,
};

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

  it('hides the "Open in editor" doc button when onOpenFile is not wired (no dead click)', () => {
    render(<SourcePanel cite={docCite} />);
    expect(screen.queryByText('Open in editor')).not.toBeInTheDocument();
  });

  it('shows "Open in editor" for a document citation when onOpenFile IS wired', () => {
    const onOpenFile = vi.fn();
    render(<SourcePanel cite={docCite} onOpenFile={onOpenFile} />);
    const btn = screen.getByText('Open in editor');
    fireEvent.click(btn);
    expect(onOpenFile).toHaveBeenCalledWith('Contracts/lease.docx');
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
