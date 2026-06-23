import { describe, it, expect, vi, beforeEach } from 'vitest';

const promoteMatterToShared = vi.fn();
vi.mock('@/features/matters/logic/promoteMatterToShared', () => ({
  promoteMatterToShared: (...a: unknown[]) => promoteMatterToShared(...a),
}));

import { carryMattersToFirm } from '@/features/firm/logic/carryMattersToFirm';

beforeEach(() => vi.clearAllMocks());

describe('carryMattersToFirm', () => {
  it('shares only the share-selected matters and leaves private ones untouched', async () => {
    promoteMatterToShared.mockImplementation(async (id: string) => ({
      status: 'shared', matterId: id, firmMatterId: `fm_${id}`, orgId: 'o',
    }));
    const outcomes = await carryMattersToFirm(
      [
        { matterId: 'a', clientName: 'A', action: 'share' },
        { matterId: 'b', clientName: 'B', action: 'private' },
        { matterId: 'c', clientName: 'C', action: 'share' },
      ],
      {} as never,
    );
    expect(promoteMatterToShared).toHaveBeenCalledTimes(2);
    expect(outcomes).toContainEqual({ matterId: 'b', status: 'kept-private' });
    expect(outcomes).toContainEqual({ matterId: 'a', status: 'shared', firmMatterId: 'fm_a' });
    expect(outcomes).toContainEqual({ matterId: 'c', status: 'shared', firmMatterId: 'fm_c' });
  });

  it('isolates a single failure without aborting the rest', async () => {
    promoteMatterToShared
      .mockResolvedValueOnce({ status: 'failed', matterId: 'a', error: 'boom' })
      .mockResolvedValueOnce({ status: 'shared', matterId: 'c', firmMatterId: 'fm_c', orgId: 'o' });
    const outcomes = await carryMattersToFirm(
      [
        { matterId: 'a', clientName: 'A', action: 'share' },
        { matterId: 'c', clientName: 'C', action: 'share' },
      ],
      {} as never,
    );
    expect(outcomes).toContainEqual({ matterId: 'a', status: 'failed', error: 'boom' });
    expect(outcomes).toContainEqual({ matterId: 'c', status: 'shared', firmMatterId: 'fm_c' });
  });

  it('isolates a THROWN error (not just a failed result) without aborting the rest', async () => {
    promoteMatterToShared
      .mockRejectedValueOnce(new Error('kaboom'))
      .mockResolvedValueOnce({ status: 'shared', matterId: 'c', firmMatterId: 'fm_c', orgId: 'o' });
    const outcomes = await carryMattersToFirm(
      [
        { matterId: 'a', clientName: 'A', action: 'share' },
        { matterId: 'c', clientName: 'C', action: 'share' },
      ],
      {} as never,
    );
    expect(promoteMatterToShared).toHaveBeenCalledTimes(2);
    expect(outcomes).toContainEqual({ matterId: 'a', status: 'failed', error: 'kaboom' });
    expect(outcomes).toContainEqual({ matterId: 'c', status: 'shared', firmMatterId: 'fm_c' });
  });

  it('runs share selections sequentially (never overlapping) and reports progress', async () => {
    let active = 0;
    let maxActive = 0;
    promoteMatterToShared.mockImplementation(async (id: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 1));
      active -= 1;
      return { status: 'shared', matterId: id, firmMatterId: `fm_${id}`, orgId: 'o' };
    });
    const progress: Array<[number, number]> = [];
    await carryMattersToFirm(
      [
        { matterId: 'a', clientName: 'A', action: 'share' },
        { matterId: 'b', clientName: 'B', action: 'private' },
        { matterId: 'c', clientName: 'C', action: 'share' },
      ],
      {} as never,
      (done, total) => progress.push([done, total]),
    );
    expect(maxActive).toBe(1); // strictly sequential
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});
