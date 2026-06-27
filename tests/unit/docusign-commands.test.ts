import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));

import { invoke } from '@tauri-apps/api/core';
import {
  docusignSetWorkspace,
  docusignConnect,
  docusignIsConnected,
  docusignSync,
  docusignListUnassigned,
  DOCUSIGN_SYNC_EVENT,
} from '@/platform/utils/docusign-commands';

describe('docusign-commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets the DocuSign workspace', async () => {
    (invoke as any).mockResolvedValue(undefined);
    await docusignSetWorkspace('/tmp/workspace');
    expect(invoke).toHaveBeenCalledWith('docusign_set_workspace', { path: '/tmp/workspace' });
  });

  it('connects through the backend command', async () => {
    (invoke as any).mockResolvedValue({ accountId: 'acct', accountName: 'Demo', baseUri: 'https://demo.docusign.net', environment: 'demo' });
    const info = await docusignConnect();
    expect(invoke).toHaveBeenCalledWith('docusign_connect');
    expect(info.accountId).toBe('acct');
  });

  it('reports connection state', async () => {
    (invoke as any).mockResolvedValue(true);
    await expect(docusignIsConnected()).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('docusign_is_connected');
  });

  it('sync forwards matter map and optional date window', async () => {
    (invoke as any).mockResolvedValue({ recordsIndexed: 2 });
    const map = [{ esignKey: 'client@example.com', matterId: 'matter-1' }];
    await docusignSync(map, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    expect(invoke).toHaveBeenCalledWith('docusign_sync', {
      matterMap: map,
      fromDate: '2026-01-01T00:00:00Z',
      toDate: '2026-02-01T00:00:00Z',
    });
  });

  it('lists unassigned envelopes and exports the sync event name', async () => {
    (invoke as any).mockResolvedValue([{ sourceId: 'docusign:a:e1', envelopeId: 'e1', subject: 'Agreement', reason: 'no matter matched' }]);
    const rows = await docusignListUnassigned();
    expect(invoke).toHaveBeenCalledWith('docusign_list_unassigned');
    expect(rows[0]?.envelopeId).toBe('e1');
    expect(DOCUSIGN_SYNC_EVENT).toBe('docusign-sync-progress');
  });
});
