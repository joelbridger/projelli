/**
 * Task 13 — per-client consent ledger: `<matter folder>/Meetings/.consent-ledger.json`.
 * Same injected-pair pattern as the rest of this feature (a narrow read/write
 * slice, not the concrete WorkspaceService) so it's plain-testable.
 */

export interface ConsentEntry {
  mode: 'one-party' | 'two-party';
  scope: 'standing' | 'per-meeting';
  confirmedAt: string;
  note?: string;
  meetingDir?: string;
}

interface ConsentLedgerFile {
  entries: ConsentEntry[];
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
      if (raw == null) return { entries: [] };
      const parsed = JSON.parse(raw) as Partial<ConsentLedgerFile>;
      return { entries: parsed.entries ?? [] };
    } catch {
      return { entries: [] };
    }
  }

  return {
    /** Appends a consent entry — one call per confirmed recording (standing
     *  or per-meeting), never overwrites prior entries (append-only). */
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
  };
}

export type ConsentLedger = ReturnType<typeof makeConsentLedger>;
