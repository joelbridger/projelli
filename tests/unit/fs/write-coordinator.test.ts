/**
 * WriteCoordinator (BUG-045) — serializes writes per path so a slow earlier save
 * can't land AFTER a newer one (which would put stale content on disk), and
 * reports whether a completed write is still the latest so the caller can decide
 * to mark the tab clean. This is the core of the save-path data-loss fix.
 */
import { describe, it, expect, vi } from 'vitest';
import { WriteCoordinator } from '@/platform/fs/writeCoordinator';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('WriteCoordinator', () => {
  it('serializes writes to the same path in enqueue order, even when an earlier write is slower', async () => {
    const c = new WriteCoordinator();
    const order: string[] = [];
    // A is slow, B is fast. Without serialization B would finish first and A
    // would overwrite it with stale content. With serialization A completes
    // before B even starts.
    const a = c.enqueue('/f', 1, async () => { await new Promise((r) => setTimeout(r, 20)); order.push('A'); });
    const b = c.enqueue('/f', 2, async () => { order.push('B'); });
    await Promise.all([a, b]);
    expect(order).toEqual(['A', 'B']);
  });

  it('runs writes to DIFFERENT paths concurrently (not serialized across paths)', async () => {
    const c = new WriteCoordinator();
    const order: string[] = [];
    const a = c.enqueue('/a', 1, async () => { await new Promise((r) => setTimeout(r, 20)); order.push('a'); });
    const b = c.enqueue('/b', 1, async () => { order.push('b'); });
    await Promise.all([a, b]);
    // /b is fast and not blocked by the slow /a write.
    expect(order).toEqual(['b', 'a']);
  });

  it('writes queued revisions in order; only the newest reports isLatest', async () => {
    const c = new WriteCoordinator();
    const written: number[] = [];
    const mk = (rev: number) => c.enqueue('/f', rev, async () => { written.push(rev); });
    const [a, b, d] = await Promise.all([mk(1), mk(2), mk(3)]);
    // Serialized in order; the LAST write wins on disk.
    expect(written).toEqual([1, 2, 3]);
    // Only the newest enqueue is "latest" — the caller marks the tab clean only
    // for that one (the live-tab-rev check in markSaved is the real guard).
    expect(a.isLatest).toBe(false);
    expect(b.isLatest).toBe(false);
    expect(d.isLatest).toBe(true);
  });

  it('reports isLatest=false when a newer revision is enqueued WHILE a write is in flight', async () => {
    const c = new WriteCoordinator();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = c.enqueue('/f', 1, async () => { await gate; });
    // Enqueue a newer rev while the first write is blocked.
    const second = c.enqueue('/f', 2, async () => {});
    release();
    const r1 = await first;
    // rev1 wrote, but rev2 is newer → not latest → caller must NOT mark clean.
    expect(r1.isLatest).toBe(false);
    const r2 = await second;
    expect(r2).toEqual({ written: true, isLatest: true });
  });

  it('a throwing write does not wedge the path queue', async () => {
    const c = new WriteCoordinator();
    const ok = vi.fn(async () => {});
    await expect(c.enqueue('/f', 1, async () => { throw new Error('disk full'); })).rejects.toThrow('disk full');
    // The next write to the same path still runs.
    await c.enqueue('/f', 2, ok);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('drain() awaits all in-flight writes', async () => {
    const c = new WriteCoordinator();
    let done = false;
    void c.enqueue('/f', 1, async () => { await new Promise((r) => setTimeout(r, 15)); done = true; });
    await c.drain();
    expect(done).toBe(true);
    await tick();
  });

  // (latent, from the QA audit): maxRev is a per-path high-water mark that
  // otherwise NEVER resets, so a tab closed then reopened (its own rev
  // counter restarting from 1) can see isLatest read false for its first,
  // only in-flight write — even though nothing newer actually exists.
  it('resetPath() clears the stale high-water mark left by a previous session', async () => {
    const c = new WriteCoordinator();
    // "Session 1": several writes bump maxRev up to 5.
    await c.enqueue('/f', 5, async () => {});

    // Without a reset, a NEW session's rev-1 write would read isLatest=false
    // purely because of the old session's high-water mark, not because
    // anything newer is actually in flight.
    const staleResult = await c.enqueue('/f', 1, async () => {});
    expect(staleResult.isLatest).toBe(false);

    // "Session 2" (tab reopened): resetPath before its first write.
    c.resetPath('/f');
    const freshResult = await c.enqueue('/f', 1, async () => {});
    expect(freshResult).toEqual({ written: true, isLatest: true });
  });

  it('resetPath() does not disturb the write queue for OTHER paths', async () => {
    const c = new WriteCoordinator();
    await c.enqueue('/a', 3, async () => {});
    c.resetPath('/a');
    // /b's own tracking is untouched by resetting /a.
    const a = await c.enqueue('/a', 1, async () => {});
    const b = await c.enqueue('/b', 1, async () => {});
    expect(a.isLatest).toBe(true);
    expect(b.isLatest).toBe(true);
  });
});
