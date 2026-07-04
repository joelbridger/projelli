import { describe, it, expect, vi } from 'vitest';
const invokeMock = vi.fn().mockResolvedValue({ transcriptPath: '/x/transcript.json', segmentCount: 3 });
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
import { importMeetingAudio } from '@/features/meetings/importMeetingAudio';

describe('importMeetingAudio', () => {
  it('invokes transcribe_meeting for the created meeting dir', async () => {
    const { meetingDir } = await importMeetingAudio('/tmp/call.wav', 'm-77', '/ws', {
      copyIntoMeetingFolder: vi.fn().mockResolvedValue('/ws/Clients/X/Meetings/2026-07-02-m-77'),
    });
    expect(meetingDir).toContain('Meetings');
    expect(invokeMock).toHaveBeenCalledWith(
      'transcribe_meeting',
      expect.objectContaining({ workspaceRoot: '/ws', meetingDir, model: null }),
    );
  });
});
