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

  it('recordVerbalNoticeIfAbsent writes at most once under a concurrent race (codex-review R5)', async () => {
    // Two verification callers (post-stop + meeting open) racing on a slow
    // store must not both append a verbal check.
    const files: Record<string, string> = {};
    const slow: ConsentLedgerStorage = {
      readFile: (p) => new Promise((res) => { setTimeout(() => { res(files[p] ?? null); }, 0); }),
      writeFile: (p, c) => new Promise((res) => { setTimeout(() => { files[p] = c; res(); }, 0); }),
    };
    const dir = `${MATTER}/Meetings/m1`;
    const [w1, w2] = await Promise.all([
      makeConsentLedger(slow, () => MATTER).recordVerbalNoticeIfAbsent({ kind: 'verbal-notice-not-detected', meetingDir: dir, at: 't1' }),
      makeConsentLedger(slow, () => MATTER).recordVerbalNoticeIfAbsent({ kind: 'verbal-notice-verified', meetingDir: dir, at: 't2', audioMs: 1, snippet: 's', confidence: 0.6 }),
    ]);
    const parsed = JSON.parse(files[PATH] ?? '{}') as { notices: unknown[] };
    expect(parsed.notices).toHaveLength(1); // only one verbal check survived
    expect([w1, w2].filter(Boolean)).toHaveLength(1); // exactly one caller wrote
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

describe('noticeContext (codex-review R6)', () => {
  it('stores and reads back the script/locale captured at recording start', async () => {
    const store = memStorage();
    const ledger = makeConsentLedger(store, () => MATTER);
    const dir = `${MATTER}/Meetings/m1`;
    await ledger.recordNotice({ kind: 'notice-context', meetingDir: dir, at: 't', customScript: 'Custom firm script.', locale: 'de' });
    const ctx = await ledger.noticeContext(dir);
    expect(ctx?.customScript).toBe('Custom firm script.');
    expect(ctx?.locale).toBe('de');
  });

  it('returns null when no context was recorded (legacy/imported meeting)', async () => {
    const store = memStorage();
    expect(await makeConsentLedger(store, () => MATTER).noticeContext(`${MATTER}/Meetings/x`)).toBeNull();
  });

  it('matches context across path forms and returns the latest', async () => {
    const store = memStorage();
    const ledger = makeConsentLedger(store, () => MATTER);
    await ledger.recordNotice({ kind: 'notice-context', meetingDir: `/abs${MATTER}/Meetings/m1`, at: 't1', customScript: 'first', locale: 'en' });
    await ledger.recordNotice({ kind: 'notice-context', meetingDir: `${MATTER}/Meetings/m1`, at: 't2', customScript: 'second', locale: 'es' });
    const ctx = await ledger.noticeContext(`other/Meetings/m1`);
    expect(ctx?.customScript).toBe('second');
    expect(ctx?.locale).toBe('es');
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
