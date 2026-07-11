import type { SyncDocumentKey } from './contracts';
import { MAX_CLIENT_DOCUMENTS, type InMemorySyncMetrics } from './SyncMetrics';

export const FIRM_HOME_MATTER_ID = 'firm_home';

export class ClientSubscriptionCapError extends Error {
  constructor() { super('Twelve client subscriptions are pinned; unpin one before opening another'); }
}

export interface ClientOpenOptions { taskNotes?: boolean; }
export interface CrmDocumentRouterOptions {
  startDocument(document: SyncDocumentKey): Promise<void>;
  stopDocument(document: SyncDocumentKey): Promise<void>;
  metrics: InMemorySyncMetrics;
}

interface ClientSlot { matterId: string; pinned: boolean; taskNotes: boolean; lastUsed: number; }

/** D1 topology and the 12-client LRU/pinning policy. */
export class CrmDocumentRouter {
  private readonly clients = new Map<string, ClientSlot>();
  private clock = 0;

  constructor(private readonly options: CrmDocumentRouterOptions) {}

  firmDocuments(currentQuarter: string): SyncDocumentKey[] {
    return ['crm:tasks', 'crm:workflows', 'crm:templates', 'crm:directory', `crm:activity:${currentQuarter}`]
      .map((docId) => ({ matterId: FIRM_HOME_MATTER_ID, docId }));
  }

  async startFirmHome(currentQuarter: string): Promise<void> {
    for (const document of this.firmDocuments(currentQuarter)) await this.options.startDocument(document);
    this.reportActiveDocuments();
  }

  async openClient(matterId: string, options: ClientOpenOptions = {}): Promise<void> {
    const existing = this.clients.get(matterId);
    if (existing) {
      existing.lastUsed = ++this.clock;
      if (options.taskNotes && !existing.taskNotes) {
        await this.options.startDocument({ matterId, docId: 'crm:task-notes' });
        existing.taskNotes = true;
      }
      this.reportActiveDocuments();
      return;
    }
    if (this.clients.size >= MAX_CLIENT_DOCUMENTS) await this.evictLeastRecentUnpinned();
    await this.options.startDocument({ matterId, docId: 'crm:record' });
    if (options.taskNotes) await this.options.startDocument({ matterId, docId: 'crm:task-notes' });
    this.clients.set(matterId, { matterId, pinned: false, taskNotes: options.taskNotes === true, lastUsed: ++this.clock });
    this.reportActiveDocuments();
  }

  setPinned(matterId: string, pinned: boolean): void {
    const slot = this.clients.get(matterId);
    if (!slot) throw new Error('cannot pin a client that is not subscribed');
    slot.pinned = pinned;
    slot.lastUsed = ++this.clock;
  }

  activeClientMatterIds(): string[] { return [...this.clients.keys()]; }

  private async evictLeastRecentUnpinned(): Promise<void> {
    const candidate = [...this.clients.values()]
      .filter((slot) => !slot.pinned)
      .sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (!candidate) throw new ClientSubscriptionCapError();
    await this.options.stopDocument({ matterId: candidate.matterId, docId: 'crm:record' });
    if (candidate.taskNotes) await this.options.stopDocument({ matterId: candidate.matterId, docId: 'crm:task-notes' });
    this.clients.delete(candidate.matterId);
  }

  private reportActiveDocuments(): void {
    const clientDocuments = [...this.clients.values()].reduce((total, slot) => total + 1 + (slot.taskNotes ? 1 : 0), 0);
    this.options.metrics.setActiveDocuments(5 + clientDocuments);
  }
}
