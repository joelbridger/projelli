import { afterEach, describe, expect, it } from 'vitest';
import { KC_FALLBACK_PREFIX } from '@/config/identity';
import {
  PromotionReceiptError,
  claimPromotionPending,
  loadPromotionPending,
  renewPromotionPendingLease,
  resetPromotionPending,
  type PromotionReceiptContext,
} from './firmKeychain';

const context: PromotionReceiptContext = { localMatterId: 'local-client', userId: 'user-a', orgId: 'org-a' };
const receiptKey = (localMatterId = context.localMatterId) =>
  `${KC_FALLBACK_PREFIX}com.lantern.matter-promotion.${localMatterId}::promotion_pending`;

function writeRaw(record: unknown, localMatterId = context.localMatterId): void {
  localStorage.setItem(receiptKey(localMatterId), btoa(JSON.stringify(record)));
}

afterEach(() => { localStorage.clear(); });

describe('promotion receipt validation and lease fencing', () => {
  it('adopts and permanently upgrades a valid in-progress pre-identity sharing receipt', async () => {
    const legacy = {
      provisioningNonce: `pn2_${'L'.repeat(43)}`,
      matterHandle: `mh2_${'M'.repeat(43)}`,
      rootStreamHandle: `sh2_${'S'.repeat(43)}`,
      keyEpoch: 1,
      keyB64: 'legacy-key',
      rootBlobId: `bh2_${'B'.repeat(43)}`,
      rootCiphertextB64: 'legacy-ciphertext',
      rootWriteAccepted: true,
      leaseOwnerId: 'a'.repeat(32),
      leaseExpiresAt: Date.now() - 1,
    };
    writeRaw(legacy);

    const claimed = await claimPromotionPending(context);
    expect(claimed.owned).toBe(true);
    expect(claimed.record).toMatchObject({ ...context, provisioningNonce: legacy.provisioningNonce });

    const loaded = await loadPromotionPending(context);
    expect(loaded).toMatchObject({ ...context, provisioningNonce: legacy.provisioningNonce });
    const stored = JSON.parse(atob(localStorage.getItem(receiptKey()) ?? '')) as Record<string, unknown>;
    expect(stored).toMatchObject(context);
  });

  it('rejects a completed identity-free receipt instead of adopting it into this firm account', async () => {
    const legacyCompleted = {
      provisioningNonce: `pn2_${'C'.repeat(43)}`,
      matterHandle: `mh2_${'D'.repeat(43)}`,
      rootStreamHandle: `sh2_${'E'.repeat(43)}`,
      keyEpoch: 1,
      keyB64: 'legacy-key',
      rootBlobId: `bh2_${'F'.repeat(43)}`,
      rootCiphertextB64: 'legacy-ciphertext',
      rootWriteAccepted: true,
      completed: true,
    };
    writeRaw(legacyCompleted);

    await expect(claimPromotionPending(context)).rejects.toBeInstanceOf(PromotionReceiptError);
    const stored = JSON.parse(atob(localStorage.getItem(receiptKey()) ?? '')) as Record<string, unknown>;
    expect(stored).not.toHaveProperty('userId');
    expect(stored).not.toHaveProperty('orgId');
  });

  it('still rejects a receipt that names a different client or firm identity', async () => {
    writeRaw({
      ...context,
      userId: 'user-b',
      provisioningNonce: `pn2_${'B'.repeat(43)}`,
      leaseOwnerId: 'b'.repeat(32),
      leaseExpiresAt: Date.now() + 1_000,
    });

    await expect(claimPromotionPending(context)).rejects.toBeInstanceOf(PromotionReceiptError);
  });

  it('does not migrate an identity-free receipt that fails another validation rule', async () => {
    writeRaw({
      provisioningNonce: 'not-a-nonce',
      rootWriteAccepted: true,
    });

    await expect(claimPromotionPending(context)).rejects.toBeInstanceOf(PromotionReceiptError);
  });

  it.each([
    ['bad shape', { ...context, provisioningNonce: 'not-a-nonce', leaseOwnerId: 'a'.repeat(32), leaseExpiresAt: Date.now() + 1_000 }],
    ['absurd future lease', { ...context, provisioningNonce: `pn2_${'A'.repeat(43)}`, leaseOwnerId: 'a'.repeat(32), leaseExpiresAt: Date.now() + 3_600_000 }],
    ['foreign owner format', { ...context, provisioningNonce: `pn2_${'A'.repeat(43)}`, leaseOwnerId: 'someone-else', leaseExpiresAt: Date.now() + 1_000 }],
  ])('rejects a %s receipt instead of waiting forever, then permits deliberate reset', async (_name, receipt) => {
    writeRaw(receipt);
    await expect(claimPromotionPending(context)).rejects.toBeInstanceOf(PromotionReceiptError);
    await resetPromotionPending(context);
    await expect(claimPromotionPending(context)).resolves.toMatchObject({ owned: true, record: context });
  });

  it('does not adopt a receipt from another local client or firm identity', async () => {
    writeRaw({
      ...context,
      userId: 'user-b',
      provisioningNonce: `pn2_${'B'.repeat(43)}`,
      leaseOwnerId: 'b'.repeat(32),
      leaseExpiresAt: Date.now() + 1_000,
    });
    await expect(loadPromotionPending(context)).resolves.toBeNull();
    await expect(claimPromotionPending(context)).rejects.toBeInstanceOf(PromotionReceiptError);
  });

  it('lets a concurrent window adopt a legitimate receipt and renews a long-running owner lease', async () => {
    const first = await claimPromotionPending(context);
    const second = await claimPromotionPending(context);
    expect(first.owned).toBe(true);
    expect(second).toMatchObject({ owned: false, record: { provisioningNonce: first.record.provisioningNonce } });

    const before = first.record.leaseExpiresAt;
    expect(before).toBeDefined();
    const renewed = await renewPromotionPendingLease(context, first.ownerId);
    expect(renewed.leaseOwnerId).toBe(first.ownerId);
    expect(renewed.leaseExpiresAt).toBeGreaterThanOrEqual(before ?? 0);
  });
});
