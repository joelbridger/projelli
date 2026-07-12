/**
 * Email reading view from an Ask result — Wave 2 email relocation.
 *
 * Clicking an email citation in an Ask answer must open the light EmailViewer
 * reading view. The mechanism is the existing `lantern:open-email` event
 * (sourceId = the `mail:<id>` path) → useOpenEmailListener opens the email tab.
 * These tests prove BOTH entry points dispatch it:
 *   - the inline citation chip (CitationText, via onOpenFileAtPath)
 *   - the SourcePanel source card (the whole card is the click target now; the
 *     old separate "Open email"/"Open in editor" buttons were folded into the
 *     card to match the demo Sources column)
 * and that a document citation keeps its separate editor escalation while a
 * CRM citation opens the matching CRM record, never the document viewer.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SourcePanel } from '@/features/ask/SourcePanel';
import { CitationText } from '@/features/ask/CitationText';
import type { AnswerCitation } from '@/features/ask/askHelpers';

afterEach(() => {
  cleanup();
});

const emailCite: AnswerCitation = {
  n: 1,
  label: 'Re: Trust funding',
  excerpt: 'As discussed, the trust...',
  path: 'mail:abc123',
  locator: '',
  verified: true,
};
const docCite: AnswerCitation = {
  n: 1,
  label: 'lease.docx',
  excerpt: 'The tenant shall...',
  path: 'Contracts/lease.docx',
  locator: 'p.2',
  verified: true,
  paragraphIndex: 1,
};
const docCiteWithMatter: AnswerCitation = {
  ...docCite,
  matterId: 'matter_demo_brennan',
};

function renderPanel(cite: AnswerCitation) {
  return render(
    <SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />
  );
}

describe('SourcePanel — email reading view', () => {
  it('clicking an email citation card dispatches keepance:open-email', () => {
    const onOpen = vi.fn();
    window.addEventListener('lantern:open-email', onOpen as EventListener);
    renderPanel(emailCite);
    fireEvent.click(screen.getByTestId('source-card'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    const detail = (onOpen.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail).toEqual({ sourceId: 'mail:abc123' });
    window.removeEventListener('lantern:open-email', onOpen as EventListener);
  });

  it('clicking a document citation card does NOT dispatch keepance:open-email', () => {
    const onOpen = vi.fn();
    window.addEventListener('lantern:open-email', onOpen as EventListener);
    renderPanel(docCiteWithMatter);
    fireEvent.click(screen.getByTestId('source-card'));
    expect(onOpen).not.toHaveBeenCalled();
    window.removeEventListener('lantern:open-email', onOpen as EventListener);
  });

  it('a document citation with no matterId cannot be opened (card is not a button, click dispatches nothing)', () => {
    const onLaunch = vi.fn();
    window.addEventListener('lantern:matter-launch', onLaunch as EventListener);
    renderPanel(docCite);
    const card = screen.getByTestId('source-card');
    expect(card).not.toHaveAttribute('role', 'button');
    fireEvent.click(card);
    expect(onLaunch).not.toHaveBeenCalled();
    window.removeEventListener(
      'lantern:matter-launch',
      onLaunch as EventListener
    );
  });

  it('opens a document citation via keepance:matter-launch (matter-scoped, scrolls to passage)', () => {
    const onLaunch = vi.fn();
    window.addEventListener('lantern:matter-launch', onLaunch as EventListener);
    renderPanel(docCiteWithMatter);
    fireEvent.click(screen.getByTestId('source-card'));
    expect(onLaunch).toHaveBeenCalledTimes(1);
    const detail = (onLaunch.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail).toEqual({
      matterId: 'matter_demo_brennan',
      surface: 'files',
      source: {
        kind: 'document',
        ref: 'Contracts/lease.docx',
        snippet: 'The tenant shall...',
      },
    });
    window.removeEventListener(
      'lantern:matter-launch',
      onLaunch as EventListener
    );
  });

  it('clicking an email citation card does NOT dispatch keepance:matter-launch', () => {
    const onLaunch = vi.fn();
    window.addEventListener('lantern:matter-launch', onLaunch as EventListener);
    renderPanel(emailCite);
    fireEvent.click(screen.getByTestId('source-card'));
    expect(onLaunch).not.toHaveBeenCalled();
    window.removeEventListener(
      'lantern:matter-launch',
      onLaunch as EventListener
    );
  });

  it('a CRM citation opens its CRM record and never the document route', () => {
    const crmCite: AnswerCitation = {
      n: 1,
      label: 'Household',
      excerpt: 'AUM $2.1M',
      path: 'crm:household:abc123',
      locator: '',
      verified: true,
      matterId: 'matter_demo_brennan',
    };
    const onLaunch = vi.fn();
    const onOpenCrm = vi.fn();
    window.addEventListener('lantern:matter-launch', onLaunch as EventListener);
    window.addEventListener('lantern:open-crm', onOpenCrm as EventListener);
    renderPanel(crmCite);
    const card = screen.getByTestId('source-card');
    expect(card).toHaveAttribute('role', 'button');
    fireEvent.click(card);
    expect(onLaunch).not.toHaveBeenCalled();
    expect(onOpenCrm).toHaveBeenCalledTimes(1);
    window.removeEventListener(
      'lantern:matter-launch',
      onLaunch as EventListener
    );
    window.removeEventListener('lantern:open-crm', onOpenCrm as EventListener);
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
      />
    );
    fireEvent.click(screen.getByTestId('ask-citation-chip-1'));
    expect(onOpenFileAtPath).toHaveBeenCalledWith(
      'mail:abc123',
      0,
      expect.anything()
    );
  });

  it('passes matterId through an inline document citation click', () => {
    const onOpenFileAtPath = vi.fn();
    render(
      <CitationText
        text="The lease says so {1}."
        citations={[docCiteWithMatter]}
        selected={null}
        onSelect={vi.fn()}
        onOpenFileAtPath={onOpenFileAtPath}
      />
    );

    fireEvent.click(screen.getByTestId('ask-citation-chip-1'));

    expect(onOpenFileAtPath).toHaveBeenCalledWith(
      'Contracts/lease.docx',
      1,
      'The tenant shall...',
      'matter_demo_brennan'
    );
  });
});
