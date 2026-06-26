/**
 * Email citation labels (Windows-bench cosmetic): an email citation's display
 * label must show the message SUBJECT, not the raw `mail:<id>` message-id.
 * resolveEmailCitationLabels resolves it via mailGetMessage — display only, so
 * the citation `path` (the verification key) is left intact.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MailView } from '@/platform/utils/mail-commands';

const h = vi.hoisted(() => ({
  subjects: {} as Record<string, string>,
  shouldThrow: false,
  calls: 0,
}));

// Keep every other mail-command real; drive only mailGetMessage per-test.
vi.mock('@/platform/utils/mail-commands', async (orig) => {
  const actual = await orig<typeof import('@/platform/utils/mail-commands')>();
  return {
    ...actual,
    mailGetMessage: vi.fn(async (id: string): Promise<MailView> => {
      h.calls += 1;
      if (h.shouldThrow) throw new Error('Email viewer is only available in the desktop app.');
      return { subject: h.subjects[id] ?? '' } as unknown as MailView;
    }),
  };
});

import { resolveEmailCitationLabels } from '@/features/ask/askHelpers';
import type { AnswerCitation } from '@/features/ask/askHelpers';

function cite(over: Partial<AnswerCitation>): AnswerCitation {
  return {
    n: 1,
    label: 'placeholder',
    excerpt: '',
    path: null,
    locator: '',
    verified: true,
    ...over,
  };
}

beforeEach(() => {
  h.subjects = {};
  h.shouldThrow = false;
  h.calls = 0;
});

describe('resolveEmailCitationLabels', () => {
  it('replaces a mail:<id> label with the message subject (path untouched)', async () => {
    h.subjects = { AQMkAD123: 'Re: Settlement Conference' };
    const out = await resolveEmailCitationLabels([
      cite({ n: 1, path: 'mail:AQMkAD123', label: 'mail:AQMkAD123' }),
    ]);
    expect(out[0]!.label).toBe('Re: Settlement Conference');
    // The path is the verification/navigation key — it must NOT change.
    expect(out[0]!.path).toBe('mail:AQMkAD123');
  });

  it('leaves non-email citations untouched (no lookup)', async () => {
    const out = await resolveEmailCitationLabels([
      cite({ n: 2, path: 'contracts/nda.docx', label: 'nda.docx §3' }),
    ]);
    expect(out[0]!.label).toBe('nda.docx §3');
    expect(h.calls).toBe(0);
  });

  it('keeps the raw label when the lookup fails (off-desktop)', async () => {
    h.shouldThrow = true;
    const out = await resolveEmailCitationLabels([
      cite({ path: 'mail:AQMkAD999', label: 'mail:AQMkAD999' }),
    ]);
    expect(out[0]!.label).toBe('mail:AQMkAD999');
  });

  it('keeps the raw label when the resolved subject is empty', async () => {
    h.subjects = { AQMkAD000: '   ' };
    const out = await resolveEmailCitationLabels([
      cite({ path: 'mail:AQMkAD000', label: 'mail:AQMkAD000' }),
    ]);
    expect(out[0]!.label).toBe('mail:AQMkAD000');
  });

  it('does ONE lookup per distinct id for repeated citations', async () => {
    h.subjects = { AQMkADdup: 'Deposition Transcript' };
    const out = await resolveEmailCitationLabels([
      cite({ n: 1, path: 'mail:AQMkADdup', label: 'mail:AQMkADdup' }),
      cite({ n: 2, path: 'mail:AQMkADdup', label: 'mail:AQMkADdup' }),
    ]);
    expect(out[0]!.label).toBe('Deposition Transcript');
    expect(out[1]!.label).toBe('Deposition Transcript');
    expect(h.calls).toBe(1);
  });
});
