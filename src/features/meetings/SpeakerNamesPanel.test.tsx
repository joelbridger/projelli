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
    fireEvent.click(screen.getByTestId('speakers-apply'));
    await waitFor(() => {
      expect(invokeMock.mock.calls.some(([c]) => c === 'apply_speaker_names')).toBe(true);
      expect(invokeMock.mock.calls.some(([c]) => c === 'voiceprint_confirm')).toBe(true); // accepted suggestion
      expect(invokeMock.mock.calls.some(([c]) => c === 'voiceprint_enroll')).toBe(true);  // new name
    });
  });
});
