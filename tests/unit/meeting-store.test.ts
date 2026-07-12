import { describe, it, expect, vi, beforeEach } from 'vitest';
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

const writeFileMock = vi.fn(async (_path: string, _content: string) => {});
const indexFileMock = vi.fn(async (_path: string, _matterId?: string) => {});

const pathSegments = (filePath: string) =>
  filePath.split(/[\\/]+/u).filter(Boolean);

vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: {
    getState: () => ({
      matters: [{ id: 'm-1', folderPaths: ['/ws/Clients/Hendersons'], name: 'Hendersons', client: 'Hendersons' }],
    }),
  },
}));

vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => ({ rootPath: '/ws' }) },
}));

// QA-31 notes-hang tests below stub the provider call itself (run) so they can
// drive it into "never resolves" / "throws" without a real Provider — the
// template's own prompt-building/citation logic is already covered by
// meeting-note-template.test.ts.
vi.mock('@/features/meetings/meetingNoteTemplate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/meetings/meetingNoteTemplate')>();
  return {
    ...actual,
    meetingNoteFromTranscript: { ...actual.meetingNoteFromTranscript, run: vi.fn() },
  };
});

vi.mock('@/platform/utils/docx-io', () => ({
  markdownToDocxBytes: vi.fn(async () => new Uint8Array()),
  applyLetterheadIfConfigured: vi.fn(async (bytes: Uint8Array) => bytes),
}));

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: {
    indexFile: (path: string, matterId?: string) => indexFileMock(path, matterId),
  },
}));

import {
  useMeetingStore,
  setMeetingsWorkspaceService,
  retryMeetingNotes,
  retryMeetingTranscript,
} from '@/features/meetings/meetingStore';
import { MEETING_NOTES_TIMEOUT_MS } from '@/features/meetings/meetingNotesTimeout';
import { meetingNoteFromTranscript } from '@/features/meetings/meetingNoteTemplate';
import { ConfidentialityChoiceRequiredError } from '@/platform/privacy/localOnlyGuard';

describe('meeting store', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    writeFileMock.mockReset();
    indexFileMock.mockReset();
    useMeetingStore.setState(useMeetingStore.getInitialState());
    setMeetingsWorkspaceService({
      writeFile: writeFileMock,
      readFile: vi.fn(async () => ''),
      exists: vi.fn(async () => false), // no transcript.json in these tests — notes stay queued, not an error
    } as never);
  });

  it('start → stop drives capture commands and post-processing in order', async () => {
    invokeMock
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', startedAt: 't0' }) // capture_start
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', audioPath: '/ws/C/Meetings/x/audio.wav', durationMs: 60000 }) // capture_stop
      .mockResolvedValueOnce({ transcriptPath: '/ws/C/Meetings/x/transcript.json', segmentCount: 4 }); // transcribe_meeting
    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    expect(useMeetingStore.getState().status.recording).toBe(true);
    await useMeetingStore.getState().stopRecording();
    const calls = invokeMock.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(['capture_start', 'capture_stop', 'transcribe_meeting']);
    expect(useMeetingStore.getState().status.recording).toBe(false);
  });

  it('does not double-log meeting_capture_started/meeting_recorded — Rust\'s capture_start/capture_stop already append them (append_capture_audit_best_effort)', async () => {
    invokeMock
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', startedAt: 't0' })
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', audioPath: '/ws/C/Meetings/x/audio.wav', durationMs: 60000 })
      .mockResolvedValueOnce({ transcriptPath: '/ws/C/Meetings/x/transcript.json', segmentCount: 4 });
    localStorage.removeItem('audit_log_meetings');
    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await useMeetingStore.getState().stopRecording();
    const raw = localStorage.getItem('audit_log_meetings');
    const entries = raw ? (JSON.parse(raw) as { action: string }[]) : [];
    expect(entries.some((e) => e.action === 'meeting_capture_started')).toBe(false);
    expect(entries.some((e) => e.action === 'meeting_recorded')).toBe(false);
  });

  it('calls the real transcribe_meeting with workspaceRoot + meetingDir + model', async () => {
    invokeMock
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', startedAt: 't0' })
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', audioPath: '/ws/C/Meetings/x/audio.wav', durationMs: 60000 })
      .mockResolvedValueOnce({ transcriptPath: '/ws/C/Meetings/x/transcript.json', segmentCount: 4 });
    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await useMeetingStore.getState().stopRecording();
    const transcribeCall = invokeMock.mock.calls.find((c) => c[0] === 'transcribe_meeting');
    expect(transcribeCall?.[1]).toEqual({ workspaceRoot: '/ws', meetingDir: '/ws/C/Meetings/x', model: null });
  });

  it('skips transcribe_meeting in battery-saver (batch) mode', async () => {
    const { useSettingsStore } = await import('@/platform/settings/settingsStore');
    useSettingsStore.getState().setSetting('meetings.transcribeMode', 'batch');
    invokeMock
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', startedAt: 't0' })
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', audioPath: '/ws/C/Meetings/x/audio.wav', durationMs: 60000 });
    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await useMeetingStore.getState().stopRecording();
    const calls = invokeMock.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(['capture_start', 'capture_stop']);
    useSettingsStore.getState().setSetting('meetings.transcribeMode', 'live');
  });

  it('indexes transcript.json and notes.docx under the meeting matter as soon as the post-stop pipeline writes them (QA-88)', async () => {
    const files = new Map<string, string>();
    // This in-memory test filesystem accepts either platform separator.
    const normalized = (filePath: string) => filePath.replaceAll('\\', '/');
    const meetingDir = '/ws/C/Meetings/qa88-paths';
    files.set(
      `${meetingDir}/meeting.json`,
      JSON.stringify({
        matterId: 'm-1',
        startedAt: 't0',
        consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: 't0' },
      }),
    );
    files.set(
      `${meetingDir}/transcript.json`,
      JSON.stringify({
        segments: [{ startMs: 0, endMs: 1000, channel: 'mic', speaker: 'You', text: 'hi' }],
      }),
    );
    const readFile = vi.fn(async (p: string) => {
      const filePath = normalized(p);
      if (!files.has(filePath)) throw new Error('ENOENT');
      return files.get(filePath) as string;
    });
    const writeFile = vi.fn(async (p: string, content: string) => {
      files.set(normalized(p), content);
    });
    const writeFileBinary = vi.fn(async (_path: string, _content: ArrayBuffer) => {});
    setMeetingsWorkspaceService({
      readFile,
      writeFile,
      exists: vi.fn(async (p: string) => files.has(normalized(p))),
      writeFileBinary,
    } as never);
    vi.mocked(meetingNoteFromTranscript.run).mockResolvedValueOnce('- did a thing [t:0]');
    invokeMock
      .mockResolvedValueOnce({ meetingDir, startedAt: 't0' })
      .mockResolvedValueOnce({ meetingDir, audioPath: 'a.wav', durationMs: 1000 })
      .mockResolvedValueOnce({ transcriptPath: `${meetingDir}/transcript.json`, segmentCount: 1 });

    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await useMeetingStore.getState().stopRecording({
      resolveProvider: async () => ({
        provider: {} as never,
        providerId: 'test',
        model: 'test',
      }),
    });

    const expectedNotesPath = `${meetingDir}/notes.docx`;
    const expectedTranscriptPath = `${meetingDir}/transcript.json`;
    const binaryWrite = writeFileBinary.mock.calls[0];
    expect(binaryWrite).toBeDefined();
    expect(pathSegments(binaryWrite?.[0] as string)).toEqual(pathSegments(expectedNotesPath));
    expect(binaryWrite?.[1]).toBeInstanceOf(Uint8Array);

    const indexedPaths = indexFileMock.mock.calls.map(([filePath, matterId]) => ({
      path: pathSegments(filePath),
      matterId,
    }));
    expect(indexedPaths).toContainEqual({ path: pathSegments(expectedTranscriptPath), matterId: 'm-1' });
    expect(indexedPaths).toContainEqual({ path: pathSegments(expectedNotesPath), matterId: 'm-1' });
  });

  it('extends the Rust-authored meeting.json rather than reconstructing/overwriting matterId/startedAt/consent', async () => {
    // Rust's finalize_session (session.rs's MeetingMeta) already wrote this
    // by the time capture_stop resolves — the REAL start time and consent,
    // not what a TS-side reconstruction from stop-time state would produce.
    const rustWritten = {
      matterId: 'm-1',
      startedAt: '2026-07-02T17:00:00Z', // the real recording start, not stop time
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-02T17:00:00Z', note: '' },
    };
    const readFileMock = vi.fn(async (p: string) => (p.endsWith('meeting.json') ? JSON.stringify(rustWritten) : ''));
    setMeetingsWorkspaceService({ writeFile: writeFileMock, readFile: readFileMock } as never);
    invokeMock
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', startedAt: 't0' })
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', audioPath: '/ws/C/Meetings/x/audio.wav', durationMs: 60000 })
      .mockResolvedValueOnce({ transcriptPath: '/ws/C/Meetings/x/transcript.json', segmentCount: 4 });
    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await useMeetingStore.getState().stopRecording();
    const metaWrite = writeFileMock.mock.calls.find((c) => (c[0] as string).endsWith('meeting.json'));
    const written = JSON.parse(metaWrite?.[1] as string) as typeof rustWritten;
    expect(written.startedAt).toBe('2026-07-02T17:00:00Z');
    expect(written.consent).toEqual(rustWritten.consent);
    expect(written.matterId).toBe('m-1');
  });

  // 2026-07-04 UX review S1 (coordinator codex pass): processing is a JOB
  // COUNT, not a shared boolean — meeting A's pipeline finishing must not
  // hide the "writing your notes" indicator while meeting B's is mid-write.
  it('keeps processingCount truthful across overlapping post-stop pipelines', async () => {
    const deferred: Array<(v: unknown) => void> = [];
    invokeMock.mockImplementation((cmd: unknown) => {
      if (cmd === 'capture_start') return Promise.resolve({ meetingDir: `/ws/C/Meetings/m${String(deferred.length)}`, startedAt: 't0' });
      if (cmd === 'capture_stop') return Promise.resolve({ meetingDir: `/ws/C/Meetings/m${String(deferred.length)}`, audioPath: 'a.wav', durationMs: 60000 });
      // transcribe_meeting: park each pipeline until the test releases it
      return new Promise((resolve) => deferred.push(resolve));
    });

    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    const p1 = useMeetingStore.getState().stopRecording();
    await vi.waitFor(() => { expect(useMeetingStore.getState().processingCount).toBe(1); });

    // Meeting B starts + stops while A's notes are still being written.
    await useMeetingStore.getState().startRecording('m-1', { consentMode: 'one-party' });
    const p2 = useMeetingStore.getState().stopRecording();
    await vi.waitFor(() => { expect(useMeetingStore.getState().processingCount).toBe(2); });

    // A finishes first — the indicator must STAY up for B.
    deferred[0]?.({ transcriptPath: 't.json', segmentCount: 1 });
    await p1;
    expect(useMeetingStore.getState().processingCount).toBe(1);

    deferred[1]?.({ transcriptPath: 't.json', segmentCount: 1 });
    await p2;
    expect(useMeetingStore.getState().processingCount).toBe(0);
  });

  it('refuses to start when already recording', async () => {
    invokeMock.mockResolvedValueOnce({ meetingDir: '/x', startedAt: 't0' });
    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await expect(
      useMeetingStore.getState().startRecording('m-2', { consentMode: 'one-party' }),
    ).rejects.toThrow(/already recording/i);
  });

  // QA-20b: when capture_start rejects (e.g. Rust's "no microphone device"
  // error from CpalSource::resolve_device), the rejection must propagate to
  // the caller — not be swallowed — so ClientMeetingsTab's catch can surface
  // it via ConsentDialog's inline error (2026-07-04 UX review, finding B6),
  // and the store must not be left in a half-recording state.
  it('surfaces a capture_start rejection (no microphone device) and leaves status untouched', async () => {
    invokeMock.mockRejectedValueOnce(new Error('no microphone device'));
    const s = useMeetingStore.getState();
    await expect(
      s.startRecording('m-1', { consentMode: 'one-party' }),
    ).rejects.toThrow(/no microphone device/i);
    const status = useMeetingStore.getState().status;
    expect(status.recording).toBe(false);
    expect(status.meetingDir).toBeNull();
    expect(useMeetingStore.getState().activeMatterId).toBeNull();
  });
});

// QA-31 P1: "Notes are being written…" hung forever after transcription
// completed. Root cause: tryGenerateNotes had NO timeout around the provider
// call and swallowed every failure silently — a stalled sendMessage() never
// let the outer stopRecording() `finally` (which clears processingCount) run,
// and even a fast provider error left no trace anywhere. These tests drive
// meetingNoteFromTranscript.run (mocked above) into each failure shape and
// assert the pipeline always resolves with an honest, retryable state.
describe('meeting store — notes generation never hangs and never fails silently (QA-31)', () => {
  const validTranscript = JSON.stringify({
    segments: [{ startMs: 0, endMs: 1000, channel: 'mic', speaker: 'You', text: 'hi' }],
  });
  const fakeResolveProvider = async () =>
    ({ provider: {} as never, providerId: 'anthropic' as const, model: 'claude' });

  function setupWorkspace() {
    const files = new Map<string, string>();
    files.set('/ws/C/Meetings/x/transcript.json', validTranscript);
    files.set(
      '/ws/C/Meetings/x/meeting.json',
      JSON.stringify({
        matterId: 'm-1',
        startedAt: 't0',
        consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: 't0' },
      }),
    );
    const readFile = vi.fn(async (p: string) => {
      if (!files.has(p)) throw new Error('ENOENT');
      return files.get(p) as string;
    });
    const writeFile = vi.fn(async (p: string, content: string) => {
      files.set(p, content);
    });
    const exists = vi.fn(async (p: string) => files.has(p));
    setMeetingsWorkspaceService({
      readFile,
      writeFile,
      exists,
      writeFileBinary: vi.fn(async (_path: string, _content: ArrayBuffer) => {}),
    } as never);
    return { files };
  }

  function primeInvokeForOneStopCycle() {
    invokeMock
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', startedAt: 't0' }) // capture_start
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', audioPath: 'a.wav', durationMs: 1000 }) // capture_stop
      .mockResolvedValueOnce({ transcriptPath: 't.json', segmentCount: 1 }); // transcribe_meeting
  }

  beforeEach(() => {
    invokeMock.mockReset();
    useMeetingStore.setState(useMeetingStore.getInitialState());
    vi.mocked(meetingNoteFromTranscript.run).mockReset();
  });

  it('a provider call that never resolves times out instead of hanging processingCount forever', async () => {
    vi.useFakeTimers();
    try {
      const { files } = setupWorkspace();
      vi.mocked(meetingNoteFromTranscript.run).mockImplementation(() => new Promise(() => {}));
      primeInvokeForOneStopCycle();

      const s = useMeetingStore.getState();
      await s.startRecording('m-1', { consentMode: 'one-party' });
      const stopPromise = useMeetingStore
        .getState()
        .stopRecording({ resolveProvider: fakeResolveProvider });

      await vi.advanceTimersByTimeAsync(MEETING_NOTES_TIMEOUT_MS + 1000);
      await stopPromise;

      expect(useMeetingStore.getState().processingCount).toBe(0);
      const written = JSON.parse(files.get('/ws/C/Meetings/x/meeting.json') as string) as {
        notesError?: { kind: string };
      };
      expect(written.notesError?.kind).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a provider error is recorded as an honest notesError (not silently swallowed), and a retry can then succeed and clear it', async () => {
    const { files } = setupWorkspace();
    vi.mocked(meetingNoteFromTranscript.run).mockRejectedValueOnce(new Error('anthropic 529 overloaded'));
    primeInvokeForOneStopCycle();

    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await useMeetingStore.getState().stopRecording({ resolveProvider: fakeResolveProvider });

    expect(useMeetingStore.getState().processingCount).toBe(0);
    let written = JSON.parse(files.get('/ws/C/Meetings/x/meeting.json') as string) as {
      notesError?: { kind: string };
    };
    expect(written.notesError?.kind).toBe('error');

    vi.mocked(meetingNoteFromTranscript.run).mockResolvedValueOnce('- did a thing [t:0]');
    await retryMeetingNotes('/ws/C/Meetings/x', 'm-1', fakeResolveProvider);

    expect(useMeetingStore.getState().processingCount).toBe(0);
    written = JSON.parse(files.get('/ws/C/Meetings/x/meeting.json') as string) as {
      notesError?: { kind: string };
    };
    expect(written.notesError).toBeUndefined();
  });

  // codex-review round 2 (P2): two overlapping retries for the SAME meeting
  // could otherwise race — a fast success writes notes.docx + clears
  // notesError, then a slower, independently-started retry's failure writes
  // notesError back afterward even though notes.docx now exists. Generation
  // must be serialized per meetingDir so a second call while one is already
  // in flight joins the same run instead of starting an independent one.
  it('serializes concurrent retryMeetingNotes calls for the same meeting instead of racing (codex-review P2)', async () => {
    const { files } = setupWorkspace();
    let resolveFirstRun: (v: string) => void = () => {};
    const firstRun = new Promise<string>((resolve) => { resolveFirstRun = resolve; });
    vi.mocked(meetingNoteFromTranscript.run).mockReturnValueOnce(firstRun);

    const p1 = retryMeetingNotes('/ws/C/Meetings/x', 'm-1', fakeResolveProvider);
    const p2 = retryMeetingNotes('/ws/C/Meetings/x', 'm-1', fakeResolveProvider);

    resolveFirstRun('- did a thing [t:0]');
    await Promise.all([p1, p2]);

    expect(meetingNoteFromTranscript.run).toHaveBeenCalledTimes(1);
    expect(useMeetingStore.getState().processingCount).toBe(0);
    const written = JSON.parse(files.get('/ws/C/Meetings/x/meeting.json') as string) as {
      notesError?: unknown;
    };
    expect(written.notesError).toBeUndefined();
  });

  it('classifies a confidentiality-gate block distinctly (gate-blocked), so the UI can say "blocked", not just "failed"', async () => {
    const { files } = setupWorkspace();
    primeInvokeForOneStopCycle();
    const gateBlockedResolver = async () => {
      throw new ConfidentialityChoiceRequiredError();
    };

    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await useMeetingStore
      .getState()
      .stopRecording({ resolveProvider: gateBlockedResolver as never });

    expect(useMeetingStore.getState().processingCount).toBe(0);
    const written = JSON.parse(files.get('/ws/C/Meetings/x/meeting.json') as string) as {
      notesError?: { kind: string };
    };
    expect(written.notesError?.kind).toBe('gate-blocked');
    expect(meetingNoteFromTranscript.run).not.toHaveBeenCalled();
  });
});

// QA-41 P1: notes generation never happened at all after a real transcript
// landed. Root cause: tryGenerateNotes read `${meetingDir}/transcript.json`
// wrapped in a bare `try { ... } catch { return; }` that treated ANY failure
// — not just "the file genuinely isn't there yet" — as "transcription still
// queued," silently discarding it forever (see
// docs/evidence/meetings-verify4-20260704/RUN-LOG.md). On real Windows
// hardware the read itself was failing even though the file provably existed
// on disk: Rust's meeting-capture commands hand back a `meetingDir`
// canonicalized to the Windows extended-length ("verbatim") `\\?\C:\...` form
// (a deliberate round-8 fix for INTERNAL Rust-side path comparisons — see
// src-tauri/src/commands/pathguard.rs), which the frontend's PathValidator
// (before this fix — see PathValidator.windows.test.ts's "Windows verbatim"
// tests) rejected as "outside the workspace" even though it's the exact same
// folder as the plain-form workspace root. That SecurityError, thrown before
// any real file I/O even happens, was exactly the kind of failure this bare
// catch swallowed. These tests drive the READ/PARSE step (the QA-31 block
// above already covers the provider-call step) into each failure shape and
// assert the pipeline always reaches a terminal, honest state — success or a
// classified, retryable notesError — never a silent, permanent "still
// queued".
describe('meeting store — a transcript.json that exists but cannot be read/parsed is never silently treated as "still queued" (QA-41)', () => {
  const fakeResolveProvider = async () =>
    ({ provider: {} as never, providerId: 'anthropic' as const, model: 'claude' });

  function setupWorkspace(
    opts: { transcriptReadError?: Error | undefined; transcriptContent?: string } = {}
  ) {
    const files = new Map<string, string>();
    files.set(
      '/ws/C/Meetings/x/meeting.json',
      JSON.stringify({
        matterId: 'm-1',
        startedAt: 't0',
        consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: 't0' },
      }),
    );
    if (opts.transcriptContent !== undefined) {
      files.set('/ws/C/Meetings/x/transcript.json', opts.transcriptContent);
    }
    // A real Windows read failure happens on a file that DOES exist (proven
    // on disk via SSH in the bench trace) — exists() must say true even
    // though readFile() below is about to throw, so the fix can't cheat by
    // just trusting exists() to also fail.
    const exists = vi.fn(
      async (p: string) => files.has(p) || (p.endsWith('transcript.json') && !!opts.transcriptReadError)
    );
    const readFile = vi.fn(async (p: string) => {
      if (p.endsWith('transcript.json') && opts.transcriptReadError) throw opts.transcriptReadError;
      if (!files.has(p)) throw new Error('ENOENT');
      return files.get(p) as string;
    });
    const writeFile = vi.fn(async (p: string, content: string) => {
      files.set(p, content);
    });
    setMeetingsWorkspaceService({
      exists,
      readFile,
      writeFile,
      writeFileBinary: vi.fn(async (_path: string, _content: ArrayBuffer) => {}),
    } as never);
    return { files };
  }

  beforeEach(() => {
    invokeMock.mockReset();
    useMeetingStore.setState(useMeetingStore.getInitialState());
    vi.mocked(meetingNoteFromTranscript.run).mockReset();
  });

  it('transcript.json genuinely does not exist yet: silently returns, no notesError, no crash (transcription really is still queued)', async () => {
    const { files } = setupWorkspace();
    await retryMeetingNotes('/ws/C/Meetings/x', 'm-1', fakeResolveProvider);

    expect(useMeetingStore.getState().processingCount).toBe(0);
    const written = JSON.parse(files.get('/ws/C/Meetings/x/meeting.json') as string) as {
      notesError?: unknown;
    };
    expect(written.notesError).toBeUndefined();
  });

  it('transcript.json EXISTS but the read itself fails (the real Windows bug shape): recorded as an honest, retryable notesError instead of being silently treated as still-queued', async () => {
    const { files } = setupWorkspace({
      transcriptReadError: new Error('Absolute path outside workspace not allowed: transcript.json'),
    });
    await retryMeetingNotes('/ws/C/Meetings/x', 'm-1', fakeResolveProvider);

    expect(useMeetingStore.getState().processingCount).toBe(0);
    const written = JSON.parse(files.get('/ws/C/Meetings/x/meeting.json') as string) as {
      notesError?: { kind: string };
    };
    expect(written.notesError?.kind).toBe('error');
    expect(meetingNoteFromTranscript.run).not.toHaveBeenCalled();
  });

  it('transcript.json exists but contains malformed JSON: recorded as an honest, retryable notesError, not silently treated as still-queued', async () => {
    const { files } = setupWorkspace({ transcriptContent: '{not valid json' });
    await retryMeetingNotes('/ws/C/Meetings/x', 'm-1', fakeResolveProvider);

    expect(useMeetingStore.getState().processingCount).toBe(0);
    const written = JSON.parse(files.get('/ws/C/Meetings/x/meeting.json') as string) as {
      notesError?: { kind: string };
    };
    expect(written.notesError?.kind).toBe('error');
    expect(meetingNoteFromTranscript.run).not.toHaveBeenCalled();
  });

  it('a retry after the read failure resolves succeeds and clears notesError once the transcript is genuinely readable (regression guard: transcription-complete always reaches a terminal state)', async () => {
    const opts: { transcriptReadError?: Error | undefined } = {
      transcriptReadError: new Error('Absolute path outside workspace not allowed: transcript.json'),
    };
    const { files } = setupWorkspace(opts);
    await retryMeetingNotes('/ws/C/Meetings/x', 'm-1', fakeResolveProvider);
    let written = JSON.parse(files.get('/ws/C/Meetings/x/meeting.json') as string) as {
      notesError?: { kind: string };
    };
    expect(written.notesError?.kind).toBe('error');

    // The underlying path bug is now fixed — a real retry sees a normally
    // readable transcript.
    opts.transcriptReadError = undefined;
    files.set(
      '/ws/C/Meetings/x/transcript.json',
      JSON.stringify({ segments: [{ startMs: 0, endMs: 1000, channel: 'mic', speaker: 'You', text: 'hi' }] }),
    );
    vi.mocked(meetingNoteFromTranscript.run).mockResolvedValueOnce('- did a thing [t:0]');
    await retryMeetingNotes('/ws/C/Meetings/x', 'm-1', fakeResolveProvider);

    expect(useMeetingStore.getState().processingCount).toBe(0);
    written = JSON.parse(files.get('/ws/C/Meetings/x/meeting.json') as string) as {
      notesError?: { kind: string };
    };
    expect(written.notesError).toBeUndefined();
  });

  it('a valid, readable transcript still generates notes normally (no regression from the exists() check)', async () => {
    const validTranscript = JSON.stringify({
      segments: [{ startMs: 0, endMs: 1000, channel: 'mic', speaker: 'You', text: 'hi' }],
    });
    const { files } = setupWorkspace({ transcriptContent: validTranscript });
    vi.mocked(meetingNoteFromTranscript.run).mockResolvedValueOnce('- did a thing [t:0]');
    await retryMeetingNotes('/ws/C/Meetings/x', 'm-1', fakeResolveProvider);

    expect(useMeetingStore.getState().processingCount).toBe(0);
    const written = JSON.parse(files.get('/ws/C/Meetings/x/meeting.json') as string) as {
      notesError?: unknown;
    };
    expect(written.notesError).toBeUndefined();
    expect(meetingNoteFromTranscript.run).toHaveBeenCalledTimes(1);
  });
});

// QA-40 P1: transcribe_meeting failures used to vanish into a bare catch{}
// (see docs/evidence/meetings-verify3-20260704/RUN-LOG.md) — a fast,
// already-completed failure (e.g. a missing voice model, confirmed by
// direct invoke() reproduction against the Legion to take ~125ms, not a
// hang) looked identical to a permanent hang because nothing was ever
// recorded and nothing ever retried. These tests drive transcribe_meeting
// into each failure shape and assert an honest, classified, retryable
// transcriptError lands on meeting.json instead.
describe('meeting store — transcription never fails silently (QA-40)', () => {
  const fakeResolveProvider = async () =>
    ({ provider: {} as never, providerId: 'anthropic' as const, model: 'claude' });

  function setupWorkspace() {
    const files = new Map<string, string>();
    files.set(
      '/ws/C/Meetings/x/meeting.json',
      JSON.stringify({
        matterId: 'm-1',
        startedAt: 't0',
        consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: 't0' },
      }),
    );
    const readFile = vi.fn(async (p: string) => {
      if (!files.has(p)) throw new Error('ENOENT');
      return files.get(p) as string;
    });
    const writeFile = vi.fn(async (p: string, content: string) => {
      files.set(p, content);
    });
    const exists = vi.fn(async (p: string) => files.has(p));
    setMeetingsWorkspaceService({
      readFile,
      writeFile,
      exists,
      writeFileBinary: vi.fn(async (_path: string, _content: ArrayBuffer) => {}),
    } as never);
    return { files };
  }

  beforeEach(() => {
    invokeMock.mockReset();
    useMeetingStore.setState(useMeetingStore.getInitialState());
  });

  it('a missing voice engine/model failure is classified not-installed, not silently swallowed', async () => {
    const { files } = setupWorkspace();
    invokeMock
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', startedAt: 't0' }) // capture_start
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', audioPath: 'a.wav', durationMs: 1000 }) // capture_stop
      .mockRejectedValueOnce(
        'no voice model bundled for this platform (expected a ggml model under resources/voice/models — see scripts/fetch-voice-models.sh)',
      ); // transcribe_meeting

    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await useMeetingStore.getState().stopRecording();

    expect(useMeetingStore.getState().processingCount).toBe(0);
    const written = JSON.parse(files.get('/ws/C/Meetings/x/meeting.json') as string) as {
      transcriptError?: { kind: string };
    };
    expect(written.transcriptError?.kind).toBe('not-installed');
  });

  it('a wedged-engine timeout is classified timeout', async () => {
    const { files } = setupWorkspace();
    invokeMock
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', startedAt: 't0' })
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', audioPath: 'a.wav', durationMs: 1000 })
      .mockRejectedValueOnce('voice sidecar timed out');

    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await useMeetingStore.getState().stopRecording();

    const written = JSON.parse(files.get('/ws/C/Meetings/x/meeting.json') as string) as {
      transcriptError?: { kind: string };
    };
    expect(written.transcriptError?.kind).toBe('timeout');
  });

  it('any other engine failure is classified error, and a retry can succeed and clear it', async () => {
    const { files } = setupWorkspace();
    invokeMock
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', startedAt: 't0' })
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', audioPath: 'a.wav', durationMs: 1000 })
      .mockRejectedValueOnce('voice sidecar exited 3: bad model file');

    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await useMeetingStore.getState().stopRecording();

    let written = JSON.parse(files.get('/ws/C/Meetings/x/meeting.json') as string) as {
      transcriptError?: { kind: string };
    };
    expect(written.transcriptError?.kind).toBe('error');

    invokeMock.mockResolvedValueOnce({ transcriptPath: 't.json', segmentCount: 1 }); // retry's transcribe_meeting
    await retryMeetingTranscript('/ws/C/Meetings/x', '/ws', 'm-1', fakeResolveProvider);

    expect(useMeetingStore.getState().processingCount).toBe(0);
    written = JSON.parse(files.get('/ws/C/Meetings/x/meeting.json') as string) as {
      transcriptError?: { kind: string };
    };
    expect(written.transcriptError).toBeUndefined();
  });

  // Mirrors the QA-31 notes serialization fix above: the natural post-stop
  // transcription and a manual "Retry" must never race for the same
  // meetingDir — a second caller while one is already in flight joins the
  // same run instead of starting an independent, racing one.
  it('serializes concurrent transcription calls for the same meeting instead of racing', async () => {
    setupWorkspace();
    let resolveFirst: (v: unknown) => void = () => {};
    const firstCall = new Promise((resolve) => { resolveFirst = resolve; });
    invokeMock.mockImplementation((cmd: unknown) => (cmd === 'transcribe_meeting' ? firstCall : Promise.resolve({})));

    const p1 = retryMeetingTranscript('/ws/C/Meetings/x', '/ws', 'm-1', fakeResolveProvider);
    const p2 = retryMeetingTranscript('/ws/C/Meetings/x', '/ws', 'm-1', fakeResolveProvider);

    resolveFirst({ transcriptPath: 't.json', segmentCount: 1 });
    await Promise.all([p1, p2]);

    const transcribeCalls = invokeMock.mock.calls.filter((c) => c[0] === 'transcribe_meeting');
    expect(transcribeCalls).toHaveLength(1);
    expect(useMeetingStore.getState().processingCount).toBe(0);
  });
});
