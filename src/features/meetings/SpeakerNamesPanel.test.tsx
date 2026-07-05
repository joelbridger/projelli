import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// isTauri must be mocked here, not just re-exported from tauri-commands: the
// wrapper functions under test call the `isTauri` they imported directly
// from '@tauri-apps/api/core', so overriding the re-export alone leaves
// those internal calls pointing at the unmocked (real, non-Tauri) one.
const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(() => true),
}));
// Force the module-level AuditService in SpeakerNamesPanel to construct in
// ENCRYPTED (desktop) mode — isAuditEncrypted() keys off window.__TAURI_INTERNALS__,
// not the mocked isTauri — so the R9 durable-consent-persistence path (which
// only calls audit_append when encrypted) is actually exercised. Runs before
// the SpeakerNamesPanel import that builds the singleton.
vi.hoisted(() => {
  (globalThis as unknown as { window?: { __TAURI_INTERNALS__?: object } }).window ??= {};
  (globalThis as unknown as { window: { __TAURI_INTERNALS__?: object } }).window.__TAURI_INTERNALS__ = {};
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock, isTauri: isTauriMock }));
import { SpeakerNamesPanel } from './SpeakerNamesPanel';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'diarize_meeting') {
      return Promise.resolve({
        dims: 2, updatedSegments: 5,
        speakers: [
          { label: 'Speaker 1', turnCount: 4, totalMs: 60000, centroid: [1, 0] },
          { label: 'Speaker 2', turnCount: 3, totalMs: 40000, centroid: [0, 1] },
        ],
      });
    }
    if (cmd === 'voiceprint_match') {
      // first speaker is a known voice, second is not
      const matchCallsSoFar = invokeMock.mock.calls.filter(([c]) => c === 'voiceprint_match').length;
      return Promise.resolve(
        matchCallsSoFar === 1 ? { id: 'vp1', name: 'Sarah Henderson', confidence: 0.82 } : null
      );
    }
    if (cmd === 'apply_speaker_names') return Promise.resolve(5);
    return Promise.resolve(null);
  });
});

describe('SpeakerNamesPanel', () => {
  it('diarizes, auto-suggests a stored voice, and applies names', async () => {
    render(<SpeakerNamesPanel meetingDir="/w/C/Meetings/x" matterId="m1" workspaceRoot="/w" />);
    fireEvent.click(screen.getByTestId('diarize-run'));
    await waitFor(() => { expect(screen.getByTestId('speaker-row-Speaker 1')).toBeTruthy(); });
    // suggestion pre-fills the input for the recognized voice
    expect(screen.getByTestId<HTMLInputElement>('speaker-name-Speaker 1').value).toBe('Sarah Henderson');
    fireEvent.change(screen.getByTestId('speaker-name-Speaker 2'), { target: { value: 'Bob Alvarez' } });
    // R9: naming a NEW speaker enrolls a voiceprint (biometric data) — the
    // advisor must first affirm the client consented before Apply will run.
    fireEvent.click(screen.getByTestId('voiceprint-consent'));
    fireEvent.click(screen.getByTestId('speakers-apply'));
    await waitFor(() => {
      expect(invokeMock.mock.calls.some(([c]) => c === 'apply_speaker_names')).toBe(true);
      expect(invokeMock.mock.calls.some(([c]) => c === 'voiceprint_confirm')).toBe(true); // accepted suggestion
      expect(invokeMock.mock.calls.some(([c]) => c === 'voiceprint_enroll')).toBe(true);  // new name
    });
  });

  // R9 (Tier B trust guard): enrolling a new voiceprint creates biometric data
  // about the client. Apply must be blocked (and explained) until the advisor
  // affirms the client consented — and no enrollment may fire while unaffirmed.
  it('blocks enrollment until biometric consent is affirmed', async () => {
    render(<SpeakerNamesPanel meetingDir="/w/C/Meetings/x" matterId="m1" workspaceRoot="/w" />);
    fireEvent.click(screen.getByTestId('diarize-run'));
    await waitFor(() => { expect(screen.getByTestId('speaker-row-Speaker 2')).toBeTruthy(); });
    fireEvent.change(screen.getByTestId('speaker-name-Speaker 2'), { target: { value: 'Bob Alvarez' } });

    // The consent step names what it is and Apply is disabled until affirmed.
    expect(screen.getByTestId('voiceprint-consent')).toBeTruthy();
    expect(screen.getByTestId<HTMLButtonElement>('speakers-apply').disabled).toBe(true);

    // Try to force it anyway — nothing enrolls.
    fireEvent.click(screen.getByTestId('speakers-apply'));
    await new Promise((r) => setTimeout(r, 20));
    expect(invokeMock.mock.calls.some(([c]) => c === 'voiceprint_enroll')).toBe(false);

    // Affirm consent → Apply enrolls.
    fireEvent.click(screen.getByTestId('voiceprint-consent'));
    expect(screen.getByTestId<HTMLButtonElement>('speakers-apply').disabled).toBe(false);
    fireEvent.click(screen.getByTestId('speakers-apply'));
    await waitFor(() => {
      expect(invokeMock.mock.calls.some(([c]) => c === 'voiceprint_enroll')).toBe(true);
    });
  });

  // R9 (Codex review): logDurable resolves with a 'failed' persistence status
  // (it does not throw), so enrollment must check it and abort — a voiceprint
  // must never be created when its consent record didn't durably save.
  it('does not enroll when the consent record fails to persist', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'diarize_meeting') {
        return Promise.resolve({
          dims: 2, updatedSegments: 5,
          speakers: [{ label: 'Speaker 2', turnCount: 3, totalMs: 40000, centroid: [0, 1] }],
        });
      }
      if (cmd === 'voiceprint_match') return Promise.resolve(null);
      if (cmd === 'audit_append') return Promise.reject(new Error('encrypted store append failed'));
      if (cmd === 'apply_speaker_names') return Promise.resolve(1);
      return Promise.resolve(null);
    });
    render(<SpeakerNamesPanel meetingDir="/w/C/Meetings/x" matterId="m1" workspaceRoot="/w" />);
    fireEvent.click(screen.getByTestId('diarize-run'));
    await waitFor(() => { expect(screen.getByTestId('speaker-row-Speaker 2')).toBeTruthy(); });
    fireEvent.change(screen.getByTestId('speaker-name-Speaker 2'), { target: { value: 'Bob Alvarez' } });
    fireEvent.click(screen.getByTestId('voiceprint-consent'));
    fireEvent.click(screen.getByTestId('speakers-apply'));
    // The consent append rejects → no voiceprint is ever enrolled.
    await waitFor(() => {
      expect(invokeMock.mock.calls.some(([c]) => c === 'audit_append')).toBe(true);
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(invokeMock.mock.calls.some(([c]) => c === 'voiceprint_enroll')).toBe(false);
    expect(invokeMock.mock.calls.some(([c]) => c === 'apply_speaker_names')).toBe(false);
  });

  // R9: when every named speaker is only CONFIRMING an existing profile (no new
  // voiceprint created), there's no new biometric enrollment, so the consent
  // gate isn't required and Apply stays available.
  it('does not require consent when only confirming existing voiceprints', async () => {
    render(<SpeakerNamesPanel meetingDir="/w/C/Meetings/x" matterId="m1" workspaceRoot="/w" />);
    fireEvent.click(screen.getByTestId('diarize-run'));
    await waitFor(() => { expect(screen.getByTestId('speaker-row-Speaker 1')).toBeTruthy(); });
    // Speaker 1 keeps its suggested name (a confirm); Speaker 2 stays blank.
    expect(screen.queryByTestId('voiceprint-consent')).toBeNull();
    expect(screen.getByTestId<HTMLButtonElement>('speakers-apply').disabled).toBe(false);
    fireEvent.click(screen.getByTestId('speakers-apply'));
    await waitFor(() => {
      expect(invokeMock.mock.calls.some(([c]) => c === 'voiceprint_confirm')).toBe(true);
      expect(invokeMock.mock.calls.some(([c]) => c === 'voiceprint_enroll')).toBe(false);
    });
  });
});
