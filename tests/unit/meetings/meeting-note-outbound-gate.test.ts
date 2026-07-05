import { describe, it, expect } from 'vitest';
import {
  meetingNoteOutboundGate,
  meetingNotesDirForPath,
} from '@/features/meetings/outboundNoteGate';

describe('meetingNoteOutboundGate (E3 — unresolved meeting notes are unsendable)', () => {
  const resolved = { reviewedAt: '2026-07-04T00:00:00Z', notesError: undefined, noticeStatus: 'verified' as const, policy: 'standard' as const };

  it('allows a reviewed, error-free, notice-clear note to leave', () => {
    expect(meetingNoteOutboundGate(resolved)).toBeNull();
  });

  it('blocks an errored/AI-apology note — never queueable', () => {
    expect(meetingNoteOutboundGate({ ...resolved, notesError: { kind: 'error' } })).toBe('errored');
    // Errored beats everything, even if reviewed.
    expect(meetingNoteOutboundGate({ ...resolved, notesError: { kind: 'gate-blocked' }, reviewedAt: '2026-07-04' })).toBe('errored');
  });

  it('blocks an unreviewed note (needs review)', () => {
    expect(meetingNoteOutboundGate({ ...resolved, reviewedAt: null })).toBe('needs-review');
    expect(meetingNoteOutboundGate({ ...resolved, reviewedAt: undefined })).toBe('needs-review');
  });

  it('blocks a Strict-policy notice quarantine (unverified spoken notice)', () => {
    expect(meetingNoteOutboundGate({ ...resolved, noticeStatus: 'unverified', policy: 'strict' })).toBe('notice-quarantined');
  });

  it('does NOT quarantine an unverified notice under Standard policy (soft needs-review only)', () => {
    // Under Standard the notice is a soft, one-click-resolvable needs-review —
    // it does not by itself block outbound once the note is reviewed.
    expect(meetingNoteOutboundGate({ reviewedAt: '2026-07-04', notesError: undefined, noticeStatus: 'unverified', policy: 'standard' })).toBeNull();
  });

  it('errored takes priority over quarantine and needs-review', () => {
    expect(
      meetingNoteOutboundGate({ reviewedAt: null, notesError: {}, noticeStatus: 'unverified', policy: 'strict' }),
    ).toBe('errored');
  });
});

describe('meetingNotesDirForPath', () => {
  it('recognizes a meeting notes doc and returns its meeting dir', () => {
    expect(meetingNotesDirForPath('Clients/Henderson/Meetings/2026-07-04-x/notes.docx')).toBe(
      'Clients/Henderson/Meetings/2026-07-04-x',
    );
  });

  it('returns null for non-meeting documents', () => {
    expect(meetingNotesDirForPath('Clients/Henderson/plan.docx')).toBeNull();
    expect(meetingNotesDirForPath('Clients/Henderson/Meetings/2026-07-04-x/transcript.json')).toBeNull();
    expect(meetingNotesDirForPath('notes.docx')).toBeNull();
  });
});
