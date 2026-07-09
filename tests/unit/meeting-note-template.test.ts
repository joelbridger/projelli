import { describe, it, expect, vi } from 'vitest';
import { meetingNoteFromTranscript, formatCitationsForDisplay } from '@/features/meetings/meetingNoteTemplate';

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

  // 2026-07-04 UX review B3: the advisor-facing notes.docx must never show
  // raw machine tokens — they render as "(at m:ss)" at write time.
  it('formats [t:ms] tokens as readable timestamps for the advisor-facing docx', () => {
    const md = '- Wants to fund a 529 [t:341000]\n- Rebalance decided [t:135000]';
    expect(formatCitationsForDisplay(md)).toBe(
      '- Wants to fund a 529 (at 5:41)\n- Rebalance decided (at 2:15)',
    );
    expect(formatCitationsForDisplay(md)).not.toContain('[t:');
  });

  // Dictated notes cite a single 0ms pseudo-segment — the invariant holds by
  // omitting the marker, not by printing a meaningless "(at 0:00)".
  it("'omit' style drops the tokens entirely (dictated notes)", () => {
    const md = '- Wants to fund a 529 [t:0]\n- Call Maria about brackets [t:0]';
    expect(formatCitationsForDisplay(md, 'omit')).toBe(
      '- Wants to fund a 529\n- Call Maria about brackets',
    );
  });

  // QA-31: run() must forward a caller-supplied AbortSignal to sendMessage so
  // the notes-timeout watchdog can actually cancel a stalled provider call,
  // not just orphan it.
  it('forwards an AbortSignal to the audited sender when one is supplied', async () => {
    const send = vi.fn(async () => ({
      content: '- Wants a 529 [t:341000]',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cost: 0,
      model: 'test',
    }));
    const controller = new AbortController();
    await meetingNoteFromTranscript.run({
      transcript,
      clientName: 'The Hendersons',
      send,
      signal: controller.signal,
    });
    expect(send).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('omits signal from sender options when none is supplied', async () => {
    const send = vi.fn(async () => ({
      content: '- Wants a 529 [t:341000]',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cost: 0,
      model: 'test',
    }));
    await meetingNoteFromTranscript.run({ transcript, clientName: 'The Hendersons', send });
    const [, opts] = send.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect('signal' in opts).toBe(false);
  });
});
