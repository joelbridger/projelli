/**
 * Task 13 — per-client consent ledger: `<matter folder>/Meetings/.consent-ledger.json`.
 * Same injected-pair pattern as the rest of this feature (a narrow read/write
 * slice, not the concrete WorkspaceService) so it's plain-testable.
 *
 * Recording Notice Kit — the same file also carries an append-only `notices`
 * array (the provable notice trail: verified spoken notice, invite/chat
 * disclosures, and human resolutions). See noticeLedger.ts for the types.
 */
import type { NoticeEntry } from './noticeLedger';

export interface ConsentEntry {
  mode: 'one-party' | 'two-party';
  scope: 'standing' | 'per-meeting';
  confirmedAt: string;
  note?: string;
  meetingDir?: string;
}

interface ConsentLedgerFile {
  entries: ConsentEntry[];
  notices: NoticeEntry[];
}

export interface ConsentLedgerStorage {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
}

export function makeConsentLedger(ws: ConsentLedgerStorage, matterFolder: () => string) {
  function path(): string {
    return `${matterFolder()}/Meetings/.consent-ledger.json`;
  }

  async function load(): Promise<ConsentLedgerFile> {
    try {
      const raw = await ws.readFile(path());
      if (raw == null) return { entries: [], notices: [] };
      const parsed = JSON.parse(raw) as Partial<ConsentLedgerFile>;
      return { entries: parsed.entries ?? [], notices: parsed.notices ?? [] };
    } catch {
      return { entries: [], notices: [] };
    }
  }

  return {
    /** Appends a consent entry — one call per confirmed recording (standing
     *  or per-meeting), never overwrites prior entries (append-only). Preserves
     *  the notices array untouched. */
    async recordConsent(_matterId: string, entry: ConsentEntry): Promise<void> {
      const file = await load();
      file.entries.push(entry);
      await ws.writeFile(path(), JSON.stringify(file, null, 2));
    },

    /** The most recent standing-consent entry, or null if none is on file —
     *  the dialog uses this to pre-fill and show "standing consent on file". */
    async standingConsent(_matterId: string): Promise<ConsentEntry | null> {
      const file = await load();
      const standing = file.entries.filter((e) => e.scope === 'standing');
      return standing.length > 0 ? (standing[standing.length - 1] ?? null) : null;
    },

    /** Recording Notice Kit — append a notice event (append-only, preserves the
     *  consent entries). */
    async recordNotice(entry: NoticeEntry): Promise<void> {
      const file = await load();
      file.notices.push(entry);
      await ws.writeFile(path(), JSON.stringify(file, null, 2));
    },

    /** All notice entries for one meeting, in the order they were recorded. */
    async noticesForMeeting(meetingDir: string): Promise<NoticeEntry[]> {
      const file = await load();
      return file.notices.filter((n) => n.meetingDir === meetingDir);
    },

    /** Every notice entry across this client's meetings (one file read) — the
     *  meetings tab groups these by meetingDir to badge each row. */
    async allNotices(): Promise<NoticeEntry[]> {
      const file = await load();
      return file.notices;
    },

    /** Whether a verbal-notice check (verified OR not-detected) already exists
     *  for this meeting — the idempotency guard so post-transcription
     *  verification never double-appends. */
    async hasVerbalNoticeCheck(meetingDir: string): Promise<boolean> {
      const file = await load();
      return file.notices.some(
        (n) =>
          n.meetingDir === meetingDir &&
          (n.kind === 'verbal-notice-verified' || n.kind === 'verbal-notice-not-detected'),
      );
    },
  };
}

export type ConsentLedger = ReturnType<typeof makeConsentLedger>;
