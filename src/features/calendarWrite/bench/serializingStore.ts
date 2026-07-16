/**
 * A proposal store double that proves restart durability HONESTLY.
 *
 * The trap this avoids: a memory-only mock keeps the JavaScript proposal objects
 * alive, so "survived a restart" proves nothing — the objects never left memory.
 * This double instead serialises every proposal to a JSON string on `put`, and
 * on `load` parses those strings back and runs them through the real
 * `verifyStoredProposal` boundary. A "restart" is `snapshot()` → build a fresh
 * store from the bytes → hand it to a brand-new orchestrator. Nothing but the
 * serialised bytes crosses the restart, exactly as with the real SQLCipher store.
 */
import {
  verifyStoredProposal,
  type CalendarProposalStorePort,
} from '../proposalStore';
import type { CalendarWriteProposal } from '../types';

export class SerializingProposalStore implements CalendarProposalStorePort {
  /** The only state that survives a "restart" — opaque serialised rows. */
  private rows = new Map<string, string>();

  constructor(snapshot: readonly string[] = []) {
    for (const row of snapshot) {
      try {
        const parsed = JSON.parse(row) as { id?: unknown };
        if (typeof parsed.id === 'string') this.rows.set(parsed.id, row);
        // eslint-disable-next-line lantern-async/no-silent-failure -- A corrupt serialised row is dropped on load; it can never resurrect as a proposal, which is the fail-closed behaviour under test.
      } catch {
        // intentionally dropped; see the disable reason above.
      }
    }
  }

  put(proposal: CalendarWriteProposal): Promise<void> {
    this.rows.set(proposal.id, JSON.stringify(proposal));
    return Promise.resolve();
  }

  load(): Promise<readonly CalendarWriteProposal[]> {
    const out: CalendarWriteProposal[] = [];
    for (const row of this.rows.values()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row);
      } catch {
        // eslint-disable-next-line lantern-async/no-silent-failure -- A corrupt row is skipped; a proposal that cannot be parsed cannot be trusted, so dropping it is the fail-closed behaviour under test.
        continue;
      }
      const proposal = verifyStoredProposal(parsed);
      if (proposal) out.push(proposal);
    }
    return Promise.resolve(out);
  }

  /** The serialised bytes — everything that would survive a real restart. */
  snapshot(): readonly string[] {
    return [...this.rows.values()];
  }

  /** Simulate a hostile write to storage (corruption/tamper) at a given id. */
  injectRaw(id: string, rawJson: string): void {
    this.rows.set(id, rawJson);
  }
}
