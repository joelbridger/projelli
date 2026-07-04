/**
 * tab-write-guard.spec.ts — QA-15: two browser tabs on the same workspace
 * must never silently clobber each other's saved state.
 *
 * Two pages in the SAME browser context (same origin -> shared localStorage,
 * exactly like two real tabs) instead of two contexts (which the rest of the
 * e2e suite uses deliberately for storage ISOLATION — see
 * firm-collaboration.spec.ts). This is intentionally the one spec that does
 * NOT isolate storage, because sharing it is the whole point of the repro.
 *
 * No testMode=true here on purpose — the gate is disabled in test mode (see
 * useTabWriteGuard.ts), and the gate itself renders before any workspace is
 * chosen, so this exercises real production wiring without needing to drive
 * the native file-picker.
 */

import { test, expect } from '@playwright/test';

test.describe('single-writer tab gate', () => {
  test('a second tab on the same origin is gated, and taking over bumps the first', async ({ context }) => {
    const tabA = await context.newPage();
    await tabA.goto('/');
    await tabA.waitForLoadState('networkidle');

    // Tab A is alone -> owner -> normal app (workspace selector), no gate.
    await expect(tabA.getByTestId('open-existing-workspace')).toBeVisible({ timeout: 15_000 });
    await expect(tabA.getByTestId('tab-write-guard-overlay')).toHaveCount(0);

    const tabB = await context.newPage();
    await tabB.goto('/');
    await tabB.waitForLoadState('networkidle');

    // Tab B: same origin, same (shared) localStorage -> blocked immediately.
    await expect(tabB.getByTestId('tab-write-guard-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(tabB.getByTestId('open-existing-workspace')).toHaveCount(0);

    // Tab A is still fine, untouched.
    await expect(tabA.getByTestId('open-existing-workspace')).toBeVisible();

    // Force a takeover from the blocked tab. This triggers a full reload (see
    // useTabWriteGuard.ts's requestTakeover — re-hydrates every persisted
    // store from current localStorage so the takeover can't persist a stale
    // snapshot over tab A's real changes), so wait out the navigation.
    await tabB.getByTestId('tab-write-guard-take-over').click();
    await tabB.waitForLoadState('networkidle');
    await expect(tabB.getByTestId('tab-write-guard-overlay')).toHaveCount(0);
    await expect(tabB.getByTestId('open-existing-workspace')).toBeVisible({ timeout: 15_000 });

    // Tab A discovers the takeover (via the `storage` event) and steps down —
    // this is the core QA-15 invariant: at most one tab can ever be the
    // active writer, so the last-write-wins clobber becomes impossible.
    await expect(tabA.getByTestId('tab-write-guard-overlay')).toBeVisible({ timeout: 15_000 });

    await tabA.close();
    await tabB.close();
  });
});
