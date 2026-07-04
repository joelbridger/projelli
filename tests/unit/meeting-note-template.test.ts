import { describe, it, expect } from 'vitest';
import { meetingNoteFromTranscript } from '@/features/meetings/meetingNoteTemplate';

const transcript = {
  segments: [
    { startMs: 0, endMs: 5000, channel: 'mic' as const, speaker: 'You', text: 'Welcome back.' },
    { startMs: 341000, endMs: 349000, channel: 'sys' as const, speaker: 'Them', text: 'We want to fund a 529 for the grandkids this fall.' },
  ],
  meta: {
    startedAt: '2026-07-02T17:00:00Z',
    durationMs: 2460000,
    matterId: 'm-1',
    consent: { mode: 'one-party' as const, confirmedBy: 'user', confirmedAt: '2026-07-02T16:59:00Z' },
  },
};

describe('meeting note template', () => {
  it('builds a prompt containing sanitized transcript and demands [t:ms] citations', () => {
    const prompt = meetingNoteFromTranscript.buildPrompt({ transcript, clientName: 'The Hendersons' });
    expect(prompt).toContain('529');
    expect(prompt).toContain('[t:'); // citation instruction present
    expect(prompt).toContain('What changed'); // fixed sections
    expect(prompt).toContain('Action items');
  });

  it('post-processes model output: every bullet keeps a [t:ms] token that exists in the transcript', () => {
    const raw = '## What changed\n- Wants to fund a 529 [t:341000]\n- Invented fact [t:999999]\n';
    const cleaned = meetingNoteFromTranscript.enforceCitations(raw, transcript);
    expect(cleaned).toContain('[t:341000]');
    expect(cleaned).not.toContain('[t:999999]'); // token not in transcript → bullet dropped
  });
});
