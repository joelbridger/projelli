import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { copyTextMock } = vi.hoisted(() => ({ copyTextMock: vi.fn(async () => {}) }));
vi.mock('./noticeClipboard', () => ({ copyText: copyTextMock }));
// Tauri invoke is called nowhere in this path, but RecordPill's store import
// pulls the tauri core in — stub it so the module loads under jsdom.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));

import { RecordPill } from './RecordPill';
import { useMeetingStore } from './meetingStore';

beforeEach(() => {
  copyTextMock.mockClear();
  useMeetingStore.setState({
    status: { recording: true, meetingDir: '/ws/Clients/Acme/Meetings/m1', elapsedMs: 5000, writeError: null },
    processingCount: 0,
    activeMatterId: 'm',
    activeConsent: { consentMode: 'two-party' },
  });
});

describe('RecordPill — chat notice copy', () => {
  it('offers a copy-chat-notice button while recording and copies to the clipboard', async () => {
    render(<RecordPill />);
    const btn = screen.getByTestId('record-pill-copy-chat');
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    await waitFor(() => { expect(copyTextMock).toHaveBeenCalledTimes(1); });
    // It copies the recording-notice line (contains "recording").
    expect((copyTextMock.mock.calls as string[][])[0]?.[0]).toMatch(/recording/i);
  });
});
