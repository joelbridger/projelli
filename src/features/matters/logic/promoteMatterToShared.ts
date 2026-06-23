/**
 * promoteMatterToShared — promote one LOCAL matter to a firm-SHARED matter, in
 * place. This is the proven 6-step routine lifted verbatim from
 * MatterManagerDialog.handleShare so the carry-over flow can reuse it instead of
 * re-implementing firm-matter creation or key publishing.
 *
 * Only the collaboration layer (the per-matter notes stream + chosen co-edited
 * docs) ever syncs through the E2EE relay; the matter's files, email, and RAG
 * index stay local. The relay only ever stores ciphertext.
 */
import { useMatterStore } from '@/platform/matter/matterStore';
import { getOrCreateMatterKey, publishMatterKeyToMembers } from '@/platform/firm/matterKeyService';
import { registerDevice } from '@/platform/firm/deviceKeys';
import { audit } from '@/features/matters/matterManagerDialogHelpers';
import type { FirmApiClient } from '@/platform/firm/FirmApiClient';

export type PromoteMatterResult =
  | { status: 'shared'; matterId: string; firmMatterId: string; orgId: string }
  | { status: 'failed'; matterId: string; error: string };

/**
 * Promote one local matter to a firm-shared matter, in place.
 *
 * Steps (identical to the per-matter Share button):
 *   1. client.createMatter(clientName) — a backend SHELL carrying no content.
 *   2. linkFirmMatter — attach the firm id/org/role to the local matter.
 *   3. getOrCreateMatterKey — establish the per-matter AES-256 key locally.
 *   4. registerDevice — so the admin can wrap the key for this device.
 *   5. publishMatterKeyToMembers — wrap + publish the key (just the owner now).
 *   6. audit a matter_shared event.
 *
 * On any failure the link is rolled back so a matter never ends in a partial
 * shared state, and a `failed` result is returned (never thrown).
 */
export async function promoteMatterToShared(
  matterId: string,
  clientName: string,
  client: FirmApiClient,
): Promise<PromoteMatterResult> {
  const { linkFirmMatter, unlinkFirmMatter } = useMatterStore.getState();
  // Track whether linkFirmMatter ran so the catch block rolls back correctly.
  // We cannot trust a render-time `matters` snapshot in the catch path.
  let linkedLocalId: string | null = null;
  try {
    const createRes = await client.createMatter(clientName);
    const firmMatterId = createRes.matter.matter_id;
    const orgId = createRes.matter.org_id;
    const epoch = createRes.matter.key_epoch;

    linkFirmMatter(matterId, { firmMatterId, orgId, role: 'owner' });
    linkedLocalId = matterId;

    await getOrCreateMatterKey(firmMatterId);
    await registerDevice(client);
    await publishMatterKeyToMembers(client, firmMatterId, epoch);

    audit.append({
      type: 'matter_shared',
      timestamp: new Date().toISOString(),
      payload: {
        matter_id: matterId,
        firm_matter_id: firmMatterId,
        org_id: orgId,
        detail: `shared as firm matter ${firmMatterId}`,
      },
    });
    return { status: 'shared', matterId, firmMatterId, orgId };
  } catch (err) {
    if (linkedLocalId) {
      const fresh = useMatterStore.getState().matters.find((x) => x.id === linkedLocalId);
      if (fresh?.firmMatterId) unlinkFirmMatter(linkedLocalId);
    }
    return { status: 'failed', matterId, error: err instanceof Error ? err.message : String(err) };
  }
}
