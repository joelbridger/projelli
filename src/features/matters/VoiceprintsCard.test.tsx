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
import { VoiceprintsCard } from './VoiceprintsCard';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'voiceprint_list') {
      return Promise.resolve([{ id: 'vp1', name: 'Sarah Henderson', sampleCount: 3, updatedAt: '2026-07-01T00:00:00Z' }]);
    }
    return Promise.resolve(null);
  });
});

describe('VoiceprintsCard', () => {
  it('lists profiles and deletes with confirmation', async () => {
    render(<VoiceprintsCard matterId="m1" workspaceRoot="/w" />);
    await waitFor(() => { expect(screen.getByText('Sarah Henderson')).toBeTruthy(); });
    fireEvent.click(screen.getByTestId('voiceprint-delete-vp1'));
    fireEvent.click(screen.getByTestId('voiceprint-delete-confirm'));
    await waitFor(() => {
      expect(invokeMock.mock.calls.some(([c]) => c === 'voiceprint_delete')).toBe(true);
    });
  });
});
