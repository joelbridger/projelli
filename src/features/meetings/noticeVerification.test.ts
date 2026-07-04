import { describe, it, expect } from 'vitest';
import { ensureNoticeVerified, NOTICE_SCAN_WINDOW_MS, type NoticeVerificationDeps } from './noticeVerification';
import type { NoticeEntry } from './noticeLedger';
import type { TranscriptFile } from '@/platform/types/meeting';

function transcript(segments: { startMs: number; text: string; channel?: 'mic' | 'sys' }[], extra: Partial<TranscriptFile['meta']> = {}): TranscriptFile {
  return {
    segments: segments.map((s) => ({ startMs: s.startMs, endMs: s.startMs + 2000, channel: s.channel ?? 'mic', speaker: s.channel === 'sys' ? 'Them' : 'You', text: s.text })),
    meta: { startedAt: '2026-07-04T10:00:00.000Z', durationMs: 600000, matterId: 'm', consent: { mode: 'two-party', confirmedBy: 'advisor', confirmedAt: '2026-07-04T10:00:00.000Z' }, ...extra },
  };
}

/** Test deps: an in-memory transcript + a recording ledger double. */
function makeDeps(t: TranscriptFile | null, opts: Partial<NoticeVerificationDeps> = {}) {
  const recorded: NoticeEntry[] = [];
  const checks = new Set<string>();
  const deps: NoticeVerificationDeps = {
    readTranscript: () => Promise.resolve(t),
    ledger: {
      hasVerbalNoticeCheck: (dir: string) => Promise.resolve(checks.has(dir)),
      recordNotice: (e: NoticeEntry) => {
        recorded.push(e);
        if (e.kind === 'verbal-notice-verified' || e.kind === 'verbal-notice-not-detected') checks.add(e.meetingDir);
        return Promise.resolve();
      },
    },
    now: () => '2026-07-04T10:10:00.000Z',
    ...opts,
  };
  return { deps, recorded, checks };
}

const DIR = '/ws/Clients/Acme/Meetings/m1';

describe('ensureNoticeVerified', () => {
  it('records a verified entry when the notice was spoken in the first minutes', async () => {
    const t = transcript([
      { startMs: 0, text: 'Thanks for coming in today.' },
      { startMs: 14000, text: "Quick note — I'm recording this meeting for my notes, that alright?" },
    ]);
    const { deps, recorded } = makeDeps(t);
    await ensureNoticeVerified(DIR, deps);
    expect(recorded).toHaveLength(1);
    const e = recorded[0];
    expect(e?.kind).toBe('verbal-notice-verified');
    if (e?.kind === 'verbal-notice-verified') {
      expect(e.audioMs).toBe(14000);
      expect(e.snippet).toContain('recording this meeting');
    }
  });

  it('records a not-detected entry when no notice is found', async () => {
    const t = transcript([{ startMs: 0, text: 'So, how are the markets treating you?' }]);
    const { deps, recorded } = makeDeps(t);
    await ensureNoticeVerified(DIR, deps);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.kind).toBe('verbal-notice-not-detected');
  });

  it('ignores a notice spoken AFTER the scan window', async () => {
    const t = transcript([{ startMs: NOTICE_SCAN_WINDOW_MS + 10000, text: "I'm recording this for my notes." }]);
    const { deps, recorded } = makeDeps(t);
    await ensureNoticeVerified(DIR, deps);
    expect(recorded[0]?.kind).toBe('verbal-notice-not-detected');
  });

  it('is idempotent — a second call does not append again', async () => {
    const t = transcript([{ startMs: 5000, text: "I'm recording this for my notes." }]);
    const { deps, recorded } = makeDeps(t);
    await ensureNoticeVerified(DIR, deps);
    await ensureNoticeVerified(DIR, deps);
    expect(recorded).toHaveLength(1);
  });

  it('does NOT verify when only a remote participant (sys channel) mentions recording (codex-review R1)', async () => {
    // A client saying "I'm recording..." must not stamp the advisor's notice.
    const t = transcript([
      { startMs: 2000, text: "Hi, just so you know, I'm recording this on my end.", channel: 'sys' },
      { startMs: 8000, text: 'Sounds good, how have you been?', channel: 'mic' },
    ]);
    const { deps, recorded } = makeDeps(t);
    await ensureNoticeVerified(DIR, deps);
    expect(recorded[0]?.kind).toBe('verbal-notice-not-detected');
  });

  it('verifies when the advisor (mic channel) gives the notice even if a client also speaks', async () => {
    const t = transcript([
      { startMs: 1000, text: 'Nice to see you again.', channel: 'sys' },
      { startMs: 5000, text: "Quick note — I'm recording this meeting for my notes, okay?", channel: 'mic' },
    ]);
    const { deps, recorded } = makeDeps(t);
    await ensureNoticeVerified(DIR, deps);
    expect(recorded[0]?.kind).toBe('verbal-notice-verified');
  });

  it('does nothing when the transcript is not available yet', async () => {
    const { deps, recorded } = makeDeps(null);
    await ensureNoticeVerified(DIR, deps);
    expect(recorded).toHaveLength(0);
  });

  it('skips imported/mono transcripts (all sys, no mic) instead of false-flagging them (codex-review R2)', async () => {
    // Imported audio marks every segment 'sys' — can't isolate the advisor, so
    // never record not-detected (which would falsely quarantine).
    const t = transcript([
      { startMs: 0, text: 'Welcome everyone to the session.', channel: 'sys' },
      { startMs: 5000, text: "I'm recording this for my notes.", channel: 'sys' },
    ]);
    const { deps, recorded } = makeDeps(t);
    await ensureNoticeVerified(DIR, deps);
    expect(recorded).toHaveLength(0);
  });

  it('skips dictated notes (no spoken notice concept)', async () => {
    const t = transcript([{ startMs: 0, text: 'Client called about rollover.' }], { dictation: true });
    const { deps, recorded } = makeDeps(t);
    await ensureNoticeVerified(DIR, deps);
    expect(recorded).toHaveLength(0);
  });

  it('uses the firm custom phrases when matching', async () => {
    const custom = 'For quality and my notes, this session is being captured on my device.';
    const t = transcript([{ startMs: 3000, text: 'For quality and my notes, this session is being captured on my device.' }]);
    const { deps, recorded } = makeDeps(t, { customPhrases: [custom] });
    await ensureNoticeVerified(DIR, deps);
    expect(recorded[0]?.kind).toBe('verbal-notice-verified');
  });

  it('matches in the configured locale', async () => {
    const t = transcript([{ startMs: 2000, text: 'Ich nehme dieses Gespräch für meine Notizen auf. Ist das für alle in Ordnung?' }]);
    const { deps, recorded } = makeDeps(t, { locale: 'de' });
    await ensureNoticeVerified(DIR, deps);
    expect(recorded[0]?.kind).toBe('verbal-notice-verified');
  });
});
