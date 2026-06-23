/**
 * VG-5c — per-message mail privilege control in the email viewer.
 *
 * The engine already supports per-message privilege (chunks are tagged per
 * source and `rag_retag_privilege` re-tags them in place); this control is
 * the missing UI half. It mirrors the file privilege pattern
 * (`PrivilegeMenuItems`): it writes the privilege store with the `mail:<id>`
 * source id, and the store subscription in `usePrivilegeWiring` performs the
 * engine re-tag (that translation is pinned by privilege-wiring.test.tsx).
 *
 * Verifies:
 *   - marking calls the retag path (the privilege store) with the
 *     `mail:`-prefixed source id and the exact privilege value,
 *   - a sourceId prop that already carries `mail:` is not double-prefixed,
 *   - clearing calls the path with the none value (entry dropped),
 *   - the consequence note renders only while the message is privileged,
 *   - the control reflects the message's current privilege.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const mockMailGetMessage = vi.fn();

vi.mock('@/platform/utils/mail-commands', () => ({
  get mailGetMessage() {
    return mockMailGetMessage;
  },
}));

import { EmailViewer } from '@/features/email/EmailViewer';
import { usePrivilegeStore } from '@/platform/firm/privilegeStore';
import type { MailView } from '@/platform/utils/mail-commands';

function sampleMessage(overrides: Partial<MailView> = {}): MailView {
  return {
    id: 'AAMk-xyz',
    subject: 'Closing date',
    from: 'Pat H <pat@hender.com>',
    to: ['Me <me@firm.com>'],
    cc: [],
    date: '2026-05-01T14:30:00Z',
    provider: 'm365',
    body: 'Confirming May 14. The closing is at 10am.',
    hasAttachments: false,
    attachments: [],
    ...overrides,
  };
}

/** Spy on the store's setPrivilege (the entry point of the retag path). */
function spyOnSetPrivilege() {
  return vi.spyOn(usePrivilegeStore.getState(), 'setPrivilege');
}

describe('EmailViewer per-message privilege control (VG-5c)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePrivilegeStore.setState({ privilegeBySource: {}, includePrivileged: false });
    mockMailGetMessage.mockResolvedValue(sampleMessage());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('marking calls the retag path with the mail:-prefixed id and the exact value', async () => {
    const setPrivilege = spyOnSetPrivilege();
    render(<EmailViewer sourceId="AAMk-xyz" />);

    const control = await screen.findByTestId('email-privilege-control');
    expect(control).toBeInTheDocument();
    // Default state: not privileged.
    expect(screen.getByTestId('email-privilege-option-none')).toHaveAttribute(
      'aria-checked',
      'true',
    );

    fireEvent.click(screen.getByTestId('email-privilege-option-attorney-client'));

    // The bare message id is prefixed with `mail:` before it reaches the store,
    // matching the source-id convention the indexed chunks were written under.
    expect(setPrivilege).toHaveBeenCalledWith('mail:AAMk-xyz', 'attorney-client');
    expect(usePrivilegeStore.getState().privilegeBySource['mail:AAMk-xyz']).toBe(
      'attorney-client',
    );
  });

  it('does not double the prefix when the sourceId prop already carries mail:', async () => {
    const setPrivilege = spyOnSetPrivilege();
    render(<EmailViewer sourceId="mail:AAMk-xyz" />);

    await screen.findByTestId('email-privilege-control');
    fireEvent.click(screen.getByTestId('email-privilege-option-work-product'));

    expect(setPrivilege).toHaveBeenCalledWith('mail:AAMk-xyz', 'work-product');
    const map = usePrivilegeStore.getState().privilegeBySource;
    expect(map['mail:AAMk-xyz']).toBe('work-product');
    expect(map['mail:mail:AAMk-xyz']).toBeUndefined();
  });

  it('clearing calls the retag path with the none value', async () => {
    // The message arrives already marked; the control must reflect that.
    usePrivilegeStore.getState().setPrivilege('mail:AAMk-xyz', 'work-product');
    const setPrivilege = spyOnSetPrivilege();
    render(<EmailViewer sourceId="mail:AAMk-xyz" />);

    const wpOption = await screen.findByTestId('email-privilege-option-work-product');
    expect(wpOption).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByTestId('email-privilege-option-none'));

    expect(setPrivilege).toHaveBeenCalledWith('mail:AAMk-xyz', 'none');
    // A none entry is dropped from the map (the wiring re-tags it to "none").
    expect(usePrivilegeStore.getState().privilegeBySource['mail:AAMk-xyz']).toBeUndefined();
    expect(usePrivilegeStore.getState().getPrivilege('mail:AAMk-xyz')).toBe('none');
  });

  it('shows the consequence note only while the message is privileged', async () => {
    render(<EmailViewer sourceId="AAMk-xyz" />);

    await screen.findByTestId('email-privilege-control');
    expect(screen.queryByTestId('email-privilege-note')).toBeNull();

    fireEvent.click(screen.getByTestId('email-privilege-option-attorney-client'));
    const note = screen.getByTestId('email-privilege-note');
    expect(note).toHaveTextContent('Excluded from AI retrieval by default.');
    expect(note).toHaveTextContent('Include sensitive content');

    fireEvent.click(screen.getByTestId('email-privilege-option-none'));
    expect(screen.queryByTestId('email-privilege-note')).toBeNull();
  });
});
