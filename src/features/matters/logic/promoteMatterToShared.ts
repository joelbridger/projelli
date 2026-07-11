/** Promote a local matter without ever sending its name or ID to the relay. */
import * as Y from 'yjs';
import { useMatterStore } from '@/platform/matter/matterStore';
import { createLocalMatterKey, forgetMatterKey, publishMatterKeyToMembers } from '@/platform/firm/matterKeyService';
import { registerDevice } from '@/platform/firm/deviceKeys';
import { audit } from '@/features/matters/matterManagerDialogHelpers';
import { encryptUpdateV2, importMatterKey } from '@/platform/firm/matterCrypto';
import { writeFirmMatterPrivateIndex } from '@/platform/firm/firmMatterPrivateIndex';
import { useFirmStore } from '@/platform/firm/firmStore';
import type { FirmApiClient } from '@/platform/firm/FirmApiClient';
import type { MatterHandle } from '@/platform/firm/contract';

export type PromoteMatterResult =
  | { status: 'shared'; matterId: string; firmMatterId: MatterHandle; orgId: string }
  | { status: 'failed'; matterId: string; error: string };

function blobId(): string {
  return crypto.randomUUID();
}

/**
 * Ordered v2 promotion:
 * provision opaque shell → local key → encrypted root private index → activate
 * → device registration/key distribution → local linkage. The original local
 * Matter.id and all human-readable details remain entirely on this device.
 */
export async function promoteMatterToShared(
  matterId: string,
  clientName: string,
  client: FirmApiClient,
): Promise<PromoteMatterResult> {
  const { linkFirmMatter } = useMatterStore.getState();
  const seatToken = useFirmStore.getState().seatToken;
  let handle: MatterHandle | null = null;
  try {
    // Never create a visible relay shell unless this device can complete the
    // first authenticated write that makes the shell usable.
    if (!seatToken) throw new Error('A valid firm seat is required to share a client.');
    const provision = await client.createMatter();
    handle = provision.matter_handle;
    const keyB64 = await createLocalMatterKey(handle);

    const root = new Y.Doc();
    writeFirmMatterPrivateIndex(root, {
      version: 1,
      clientName,
      displayName: clientName,
      streams: { _notes: { streamHandle: provision.root_stream_handle, kind: 'notes' } },
    });
    const key = await importMatterKey(keyB64);
    const ciphertext = await encryptUpdateV2(key, Y.encodeStateAsUpdate(root), {
      keyEpoch: provision.key_epoch,
      matterHandle: handle,
      streamHandle: provision.root_stream_handle,
    });
    await client.pushUpdate(handle, provision.root_stream_handle, blobId(), ciphertext, seatToken, provision.key_epoch);

    await client.activateMatter(handle);
    await registerDevice(client);
    await publishMatterKeyToMembers(client, handle, provision.key_epoch);

    const orgId = useFirmStore.getState().session?.org?.org_id ?? '';
    linkFirmMatter(matterId, { firmMatterId: handle, rootStreamHandle: provision.root_stream_handle, orgId, role: 'owner' });
    audit.append({
      type: 'matter_shared', timestamp: new Date().toISOString(),
      payload: { matter_id: matterId, firm_matter_id: handle, ...(orgId ? { org_id: orgId } : {}), detail: 'shared locally' },
    });
    return { status: 'shared', matterId, firmMatterId: handle, orgId };
  } catch (err) {
    // A post-provisioning failure must not leave a retry-multiplying shell.
    if (handle) await client.archiveMatter(handle).catch(() => undefined);
    if (handle) await forgetMatterKey(handle).catch(() => undefined);
    return { status: 'failed', matterId, error: err instanceof Error ? err.message : String(err) };
  }
}
