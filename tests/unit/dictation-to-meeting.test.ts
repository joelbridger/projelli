import { describe, it, expect, vi } from 'vitest';

vi.mock('@/platform/utils/prompt-security', () => ({
  sanitizeForPrompt: vi.fn((s: string) => s),
}));

const docxMarkdownSpy = vi.fn(async (md: string, _name: string) => new TextEncoder().encode(md).buffer);
vi.mock('@/platform/utils/docx-io', () => ({
  markdownToDocxBytes: (md: string, name: string) => docxMarkdownSpy(md, name),
  applyLetterheadIfConfigured: vi.fn(async (b: ArrayBuffer) => b),
}));

vi.mock('@/platform/privacy/promptPreparation', () => ({
  sendPreparedMessageWithEgressAudit: vi.fn(async (opts: {
    provider: { sendMessage: (prompt: string, options?: unknown) => Promise<unknown> };
    prompt: string;
    options?: unknown;
  }) => opts.provider.sendMessage(opts.prompt, opts.options)),
}));

import { buildPseudoTranscript, dictationMeetingWriteSet, dictationToMeeting } from '@/features/meetings/dictationToMeeting';
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

  // 2026-07-04 UX review B3 (coordinator codex pass): the advisor-facing
  // notes.docx invariant — no raw [t:ms] tokens — must hold on the dictation
  // path too, and dictated bullets omit the marker (their only "timestamp"
  // is the meaningless 0ms pseudo-segment).
  it('files notes.docx without raw [t:ms] tokens (omitted, not rendered as 0:00)', async () => {
    docxMarkdownSpy.mockClear();
    const ws = {
      writeFile: vi.fn(async () => {}),
      writeFileBinary: vi.fn(async () => {}),
    };
    const provider = {
      sendMessage: vi.fn(async () => ({
        content: '## Action items\n- Send the 529 illustration [t:0]\n- Call Maria [t:0]',
      })),
    };
    await dictationToMeeting(
      ws as never,
      'Send the 529 illustration. Call Maria.',
      'm-1',
      '/ws/Clients/Hendersons',
      '2026-07-02T17:00:00Z',
      async () => ({ provider: provider as never, providerId: 'test-local', model: 'test-model' }),
    );
    expect(docxMarkdownSpy).toHaveBeenCalledTimes(1);
    const written = docxMarkdownSpy.mock.calls[0]?.[0] as string;
    expect(written).not.toContain('[t:');
    expect(written).not.toContain('(at 0:00)');
    expect(written).toContain('- Send the 529 illustration');
    expect(ws.writeFileBinary).toHaveBeenCalledWith(
      expect.stringContaining('notes.docx'),
      expect.anything(),
    );
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
