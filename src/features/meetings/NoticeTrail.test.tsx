import '@/i18n';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NoticeTrail } from './NoticeTrail';
import type { NoticeEntry } from './noticeLedger';

const DIR = '/ws/Clients/Acme/Meetings/m1';

function renderTrail(notices: NoticeEntry[], opts: Partial<React.ComponentProps<typeof NoticeTrail>> = {}) {
  const onRecordNotice = opts.onRecordNotice ?? vi.fn(async () => {});
  const copyText = opts.copyText ?? vi.fn(async () => {});
  render(
    <NoticeTrail
      meetingDir={DIR}
      notices={notices}
      policy={opts.policy ?? 'standard'}
      inviteDisclosure="INVITE TEXT"
      chatNotice="CHAT TEXT"
      onRecordNotice={onRecordNotice}
      copyText={copyText}
      now={() => '2026-07-04T10:10:00.000Z'}
    />,
  );
  return { onRecordNotice, copyText };
}

const verified: NoticeEntry = { kind: 'verbal-notice-verified', meetingDir: DIR, at: 't', audioMs: 14000, snippet: "I'm recording this for my notes.", confidence: 0.85 };
const notDetected: NoticeEntry = { kind: 'verbal-notice-not-detected', meetingDir: DIR, at: 't' };

describe('NoticeTrail', () => {
  it('shows a verified chip with the timestamp and the snippet inside Details', () => {
    renderTrail([verified]);
    const chip = screen.getByTestId('notice-verified-chip');
    expect(chip.textContent).toContain('0:14');
    // The snippet + copy tools collapse behind Details for a verified meeting.
    fireEvent.click(screen.getByTestId('notice-details-toggle'));
    expect(screen.getByTestId('notice-trail').textContent).toContain('recording this for my notes');
  });

  it('Standard: shows a quiet needs-review notice with resolutions in a menu', () => {
    renderTrail([notDetected], { policy: 'standard' });
    expect(screen.getByTestId('notice-unverified')).toBeTruthy();
    expect(screen.queryByTestId('notice-quarantine')).toBeNull();
    expect(screen.getByTestId('notice-resolve-menu')).toBeTruthy();
    expect(screen.queryByTestId('notice-resolve-disclosed')).toBeNull();
    fireEvent.pointerDown(screen.getByTestId('notice-resolve-menu'));
    expect(screen.getByTestId('notice-resolve-disclosed')).toBeTruthy();
    expect(screen.getByTestId('notice-resolve-missed')).toBeTruthy();
    expect(screen.getByTestId('notice-resolve-ack')).toBeTruthy();
  });

  it('Strict: shows a quarantine banner (still with resolutions)', () => {
    renderTrail([notDetected], { policy: 'strict' });
    expect(screen.getByTestId('notice-quarantine')).toBeTruthy();
    expect(screen.getByTestId('notice-resolve-disclosed')).toBeTruthy();
  });

  it('records a resolution when a resolution button is clicked', async () => {
    const { onRecordNotice } = renderTrail([notDetected], { policy: 'standard' });
    fireEvent.pointerDown(screen.getByTestId('notice-resolve-menu'));
    fireEvent.click(screen.getByTestId('notice-resolve-disclosed'));
    await waitFor(() => { expect(onRecordNotice).toHaveBeenCalledTimes(1); });
    const entry = (onRecordNotice as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as NoticeEntry;
    expect(entry.kind).toBe('notice-review-resolved');
    if (entry.kind === 'notice-review-resolved') expect(entry.resolution).toBe('disclosed-in-advance');
  });

  it('shows a resolved state and no resolution buttons once resolved', () => {
    renderTrail([notDetected, { kind: 'notice-review-resolved', meetingDir: DIR, at: 't', resolution: 'acknowledged-gap' }]);
    expect(screen.getByTestId('notice-resolved')).toBeTruthy();
    expect(screen.queryByTestId('notice-resolve-disclosed')).toBeNull();
  });

  it('copies the invite disclosure and records a ledger entry', async () => {
    const { onRecordNotice, copyText } = renderTrail([verified]);
    fireEvent.click(screen.getByTestId('notice-details-toggle'));
    fireEvent.click(screen.getByTestId('notice-copy-invite'));
    await waitFor(() => { expect(copyText).toHaveBeenCalledWith('INVITE TEXT'); });
    await waitFor(() => { expect(onRecordNotice).toHaveBeenCalledTimes(1); });
    const entry = (onRecordNotice as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as NoticeEntry;
    expect(entry.kind).toBe('invite-disclosure-copied');
  });

  it('copies the chat notice and records a ledger entry', async () => {
    const { onRecordNotice, copyText } = renderTrail([verified]);
    fireEvent.click(screen.getByTestId('notice-details-toggle'));
    fireEvent.click(screen.getByTestId('notice-copy-chat'));
    await waitFor(() => { expect(copyText).toHaveBeenCalledWith('CHAT TEXT'); });
    await waitFor(() => { expect(onRecordNotice).toHaveBeenCalledTimes(1); });
    expect(((onRecordNotice as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as NoticeEntry).kind).toBe('chat-notice-copied');
  });

  it('does NOT record a ledger entry when the clipboard copy fails (codex-review R5)', async () => {
    const failingCopy = vi.fn(() => Promise.reject(new Error('clipboard blocked')));
    const { onRecordNotice } = renderTrail([verified], { copyText: failingCopy });
    fireEvent.click(screen.getByTestId('notice-details-toggle'));
    fireEvent.click(screen.getByTestId('notice-copy-invite'));
    await waitFor(() => { expect(failingCopy).toHaveBeenCalledTimes(1); });
    expect(onRecordNotice).not.toHaveBeenCalled();
  });

  it('renders nothing intrusive while unchecked (no transcript yet)', () => {
    renderTrail([]);
    // The copy actions still render (advisor can always disclose), but no
    // verified/unverified/quarantine state block appears.
    expect(screen.queryByTestId('notice-verified-chip')).toBeNull();
    expect(screen.queryByTestId('notice-unverified')).toBeNull();
    expect(screen.queryByTestId('notice-quarantine')).toBeNull();
    expect(screen.getByTestId('notice-copy-invite')).toBeTruthy();
  });
});
