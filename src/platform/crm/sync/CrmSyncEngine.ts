import { CrmDocumentRouter, FIRM_HOME_MATTER_ID } from './CrmDocumentRouter';
import type { MultiplexedRelay } from './contracts';
import { InMemorySyncMetrics } from './SyncMetrics';
import { setCrmEngineFreshness } from '@/platform/crm/store';

export interface FirmHomeProvisioner {
  registerOrRecoverDevice(): Promise<void>;
  /** Must create/recover the real firm_home matter, grant every active seat, and reject walls. */
  provisionFirmHome(matterId: typeof FIRM_HOME_MATTER_ID): Promise<void>;
  obtainEligibleMatterKeys(): Promise<void>;
}

export interface CrmSyncEngineOptions {
  relay: MultiplexedRelay;
  router: CrmDocumentRouter;
  provisioner: FirmHomeProvisioner;
  metrics: InMemorySyncMetrics;
  /** B4 supplies this; it prevents notification delivery before its durable inbox exists. */
  openNotificationsAfterInboxReady?: () => Promise<void>;
}

/** Executes frozen §1.4 bootstrap order. CRM documents always share one relay connection. */
export class CrmSyncEngine {
  constructor(private readonly options: CrmSyncEngineOptions) {}

  async bootstrap(currentQuarter: string, recentClientMatterIds: readonly string[] = []): Promise<void> {
    if (recentClientMatterIds.length > 12) throw new Error('bootstrap client list exceeds D1 cap of 12');
    setCrmEngineFreshness({ kind: 'syncing' });
    try {
      await this.options.provisioner.registerOrRecoverDevice();
      await this.options.provisioner.provisionFirmHome(FIRM_HOME_MATTER_ID);
      await this.options.provisioner.obtainEligibleMatterKeys();
      this.options.metrics.beginBootstrap();
      this.options.metrics.beginSocket();
      await this.options.relay.start();
      await this.options.router.startFirmHome(currentQuarter);
      for (const matterId of recentClientMatterIds) await this.options.router.openClient(matterId, { taskNotes: true });
      await this.options.openNotificationsAfterInboxReady?.();
      setCrmEngineFreshness({ kind: 'live' });
    } catch (error) {
      setCrmEngineFreshness({ kind: 'error', error: error instanceof Error ? error.message : 'CRM sync could not start.' });
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.options.relay.stop();
    this.options.metrics.endSocket();
    setCrmEngineFreshness({ kind: 'offline' });
  }
}
