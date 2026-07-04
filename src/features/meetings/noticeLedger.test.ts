import { describe, it, expect } from 'vitest';
import { makeConsentLedger, type ConsentLedgerStorage } from './consentLedger';
import { deriveNoticeState, meetingDirKey, type NoticeEntry } from './noticeLedger';

/** In-memory storage double — one file path → content. */
function memStorage(seed: Record<string, string> = {}): ConsentLedgerStorage & { files: Record<string, string> } {
  const files: Record<string, string> = { ...seed };
  return {
    files,
    readFile(path) {
      return Promise.resolve(files[path] ?? null);
    },
    writeFile(path, content) {
      files[path] = content;
      return Promise.resolve();
    },
  };
}

const MATTER = '/ws/Clients/Acme';
const PATH = `${MATTER}/Meetings/.consent-ledger.json`;

describe('consent ledger — notice entries', () => {
  it('appends a verbal-notice-verified entry and reads it back for the meeting', async () => {
    const store = memStorage();
    const ledger = makeConsentLedger(store, () => MATTER);
    await ledger.recordNotice({
      kind: 'verbal-notice-verified',
      meetingDir: `${MATTER}/Meetings/m1`,
      at: '2026-07-04T10:00:00.000Z',
      audioMs: 14000,
      snippet: "I'm recording this for my notes.",
      confidence: 0.75,
    });
    const notices = await ledger.noticesForMeeting(`${MATTER}/Meetings/m1`);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.kind).toBe('verbal-notice-verified');
  });

  it('is append-only and does not clobber existing consent entries', async () => {
    const store = memStorage();
    const ledger = makeConsentLedger(store, () => MATTER);
    await ledger.recordConsent('m', {
      mode: 'two-party', scope: 'per-meeting', confirmedAt: '2026-07-04T10:00:00.000Z',
      meetingDir: `${MATTER}/Meetings/m1`,
    });
    await ledger.recordNotice({
      kind: 'chat-notice-copied', meetingDir: `${MATTER}/Meetings/m1`,
      at: '2026-07-04T10:01:00.000Z', text: 'This meeting is being recorded.',
    });
    // Consent entry survives the notice write.
    const standing = await ledger.standingConsent('m');
    expect(standing).toBeNull(); // per-meeting, not standing
    const parsed = JSON.parse(store.files[PATH] ?? '{}') as { entries: unknown[]; notices: unknown[] };
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.notices).toHaveLength(1);
  });

  it('recordConsent preserves previously written notices', async () => {
    const store = memStorage();
    const ledger = makeConsentLedger(store, () => MATTER);
    await ledger.recordNotice({
      kind: 'verbal-notice-not-detected', meetingDir: `${MATTER}/Meetings/m1`,
      at: '2026-07-04T10:00:00.000Z',
    });
    await ledger.recordConsent('m', {
      mode: 'one-party', scope: 'standing', confirmedAt: '2026-07-04T10:05:00.000Z',
    });
    const parsed = JSON.parse(store.files[PATH] ?? '{}') as { entries: unknown[]; notices: unknown[] };
    expect(parsed.notices).toHaveLength(1);
    expect(parsed.entries).toHaveLength(1);
  });

  it('hasVerbalNoticeCheck reports whether a verbal entry already exists (idempotency guard)', async () => {
    const store = memStorage();
    const ledger = makeConsentLedger(store, () => MATTER);
    expect(await ledger.hasVerbalNoticeCheck(`${MATTER}/Meetings/m1`)).toBe(false);
    await ledger.recordNotice({
      kind: 'verbal-notice-verified', meetingDir: `${MATTER}/Meetings/m1`,
      at: '2026-07-04T10:00:00.000Z', audioMs: 1000, snippet: 'x', confidence: 0.6,
    });
    expect(await ledger.hasVerbalNoticeCheck(`${MATTER}/Meetings/m1`)).toBe(true);
    // A different meeting is unaffected.
    expect(await ledger.hasVerbalNoticeCheck(`${MATTER}/Meetings/m2`)).toBe(false);
  });

  it('does not lose entries when two appends race (serialized read-modify-write)', async () => {
    // A storage double whose reads/writes yield to the event loop, so an
    // unserialized load-modify-write would interleave and drop one append —
    // the exact race codex-review R1 flagged (start consent write + chat-notice
    // copy landing together). Two *separate* ledger instances, same file path,
    // mirroring meetingStore + RecordPill writing concurrently.
    const files: Record<string, string> = {};
    const slow: ConsentLedgerStorage = {
      readFile: (p) => new Promise((res) => { setTimeout(() => { res(files[p] ?? null); }, 0); }),
      writeFile: (p, c) => new Promise((res) => { setTimeout(() => { files[p] = c; res(); }, 0); }),
    };
    const a = makeConsentLedger(slow, () => MATTER);
    const b = makeConsentLedger(slow, () => MATTER);
    await Promise.all([
      a.recordConsent('m', { mode: 'two-party', scope: 'per-meeting', confirmedAt: 't1', meetingDir: `${MATTER}/Meetings/m1` }),
      b.recordNotice({ kind: 'chat-notice-copied', meetingDir: `${MATTER}/Meetings/m1`, at: 't2', text: 'notice' }),
    ]);
    const parsed = JSON.parse(files[PATH] ?? '{}') as { entries: unknown[]; notices: unknown[] };
    expect(parsed.entries).toHaveLength(1); // consent survived
    expect(parsed.notices).toHaveLength(1); // notice survived
  });

  it('reads notices back across a fresh ledger instance (persisted to the same file)', async () => {
    const store = memStorage();
    await makeConsentLedger(store, () => MATTER).recordNotice({
      kind: 'invite-disclosure-copied', meetingDir: `${MATTER}/Meetings/m1`,
      at: '2026-07-04T09:00:00.000Z', text: 'This meeting will be recorded.',
    });
    const again = makeConsentLedger(store, () => MATTER);
    const notices = await again.noticesForMeeting(`${MATTER}/Meetings/m1`);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.kind).toBe('invite-disclosure-copied');
  });
});

describe('meetingDirKey + cross-path-form matching (codex-review R2)', () => {
  it('matches an entry written with an absolute path against a relative lookup', async () => {
    const store = memStorage();
    const ledger = makeConsentLedger(store, () => MATTER);
    // Written with a canonical absolute path (as the store does post-stop)…
    await ledger.recordNotice({
      kind: 'verbal-notice-verified', meetingDir: `/abs/root${MATTER}/Meetings/m1`,
      at: 't', audioMs: 1000, snippet: 'x', confidence: 0.7,
    });
    // …looked up with the relative row path (as the tab/MeetingEntry does).
    expect(await ledger.hasVerbalNoticeCheck(`${MATTER}/Meetings/m1`)).toBe(true);
    const notices = await ledger.noticesForMeeting(`${MATTER}/Meetings/m1`);
    expect(notices).toHaveLength(1);
  });

  it('meetingDirKey ignores prefix and slash style', () => {
    expect(meetingDirKey('/abs/Clients/Acme/Meetings/2026-07-04_1000')).toBe('2026-07-04_1000');
    expect(meetingDirKey('Clients/Acme/Meetings/2026-07-04_1000')).toBe('2026-07-04_1000');
    expect(meetingDirKey('C:\\Clients\\Acme\\Meetings\\2026-07-04_1000')).toBe('2026-07-04_1000');
  });
});

describe('deriveNoticeState', () => {
  const md = '/ws/m1';
  const verified: NoticeEntry = { kind: 'verbal-notice-verified', meetingDir: md, at: 't', audioMs: 14000, snippet: 's', confidence: 0.8 };
  const notDetected: NoticeEntry = { kind: 'verbal-notice-not-detected', meetingDir: md, at: 't' };
  const resolved: NoticeEntry = { kind: 'notice-review-resolved', meetingDir: md, at: 't', resolution: 'disclosed-in-advance' };

  it('unchecked when there is no verbal entry', () => {
    expect(deriveNoticeState([]).status).toBe('unchecked');
    expect(deriveNoticeState([{ kind: 'chat-notice-copied', meetingDir: md, at: 't', text: 'x' }]).status).toBe('unchecked');
  });
  it('verified when a verified entry exists', () => {
    const s = deriveNoticeState([verified]);
    expect(s.status).toBe('verified');
    if (s.status === 'verified') { expect(s.atMs).toBe(14000); expect(s.snippet).toBe('s'); }
  });
  it('verified wins even if a not-detected also exists', () => {
    expect(deriveNoticeState([notDetected, verified]).status).toBe('verified');
  });
  it('unverified when only not-detected and no resolution', () => {
    expect(deriveNoticeState([notDetected]).status).toBe('unverified');
  });
  it('resolved when a not-detected has since been resolved', () => {
    const s = deriveNoticeState([notDetected, resolved]);
    expect(s.status).toBe('resolved');
    if (s.status === 'resolved') expect(s.resolution).toBe('disclosed-in-advance');
  });
});
