import { describe, it, expect, vi } from 'vitest';

vi.mock('@/platform/utils/prompt-security', () => ({
  sanitizeForPrompt: vi.fn((s: string) => s),
}));

import { buildPseudoTranscript, dictationMeetingWriteSet } from '@/features/meetings/dictationToMeeting';
import { meetingNoteFromTranscript } from '@/features/meetings/meetingNoteTemplate';
import { stripVoiceNoteFrontmatter } from '@/features/meetings/FileAsMeetingDialog';
import { sanitizeForPrompt } from '@/platform/utils/prompt-security';

describe('dictationToMeeting', () => {
  it('wraps note text as a single-segment pseudo-transcript', () => {
    const transcript = buildPseudoTranscript('Wants to fund a 529 this fall.', 'm-1', '2026-07-02T17:00:00Z');
    expect(transcript.segments).toEqual([
      { startMs: 0, endMs: 0, channel: 'mic', speaker: 'You', text: 'Wants to fund a 529 this fall.' },
    ]);
    expect(transcript.meta.dictation).toBe(true);
    expect(transcript.meta.matterId).toBe('m-1');
    expect(transcript.meta.startedAt).toBe('2026-07-02T17:00:00Z');
  });

  it('the write set is transcript.json + notes.docx, never audio.wav', () => {
    const files = dictationMeetingWriteSet();
    expect(files).toContain('transcript.json');
    expect(files).toContain('notes.docx');
    expect(files).not.toContain('audio.wav');
  });

  it('the pseudo-transcript segment is sanitized when it reaches the Task 10 template', () => {
    const transcript = buildPseudoTranscript('some content', 'm-1', '2026-07-02T17:00:00Z');
    meetingNoteFromTranscript.buildPrompt({ transcript, clientName: 'The Hendersons' });
    expect(sanitizeForPrompt).toHaveBeenCalledWith('some content');
  });
});

describe('stripVoiceNoteFrontmatter', () => {
  it('strips the created/source frontmatter block, keeping just the dictated text', () => {
    const body = '---\ncreated: 2026-07-02T17:00:00.000Z\nsource: voice\n---\n\nWants to fund a 529 this fall.\n';
    expect(stripVoiceNoteFrontmatter(body)).toBe('Wants to fund a 529 this fall.');
  });

  it('returns content unchanged when there is no frontmatter', () => {
    expect(stripVoiceNoteFrontmatter('just plain text')).toBe('just plain text');
  });
});
