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

  test('duplicating a tab (opener-based, copies sessionStorage) does not silently share write ownership', async ({ context }) => {
    // Real "Duplicate Tab" browser actions copy sessionStorage into the new
    // tab via an opener relationship — context.newPage() (used above) does
    // NOT model that (each page starts with empty sessionStorage regardless
    // of siblings), so this uses window.open() from tabA specifically to
    // reproduce the opener-based copy (codex-review P1, round 3: a naive
    // "persist tabId in sessionStorage" design would let both copies believe
    // they own the same lock).
    const tabA = await context.newPage();
    await tabA.goto('/');
    await tabA.waitForLoadState('networkidle');
    await expect(tabA.getByTestId('open-existing-workspace')).toBeVisible({ timeout: 15_000 });

    const [tabB] = await Promise.all([
      context.waitForEvent('page'),
      tabA.evaluate((url) => window.open(url, '_blank'), await tabA.url()),
    ]);
    await tabB.waitForLoadState('networkidle');

    // Tab B must be gated, not a silent second owner.
    await expect(tabB.getByTestId('tab-write-guard-overlay')).toBeVisible({ timeout: 15_000 });
    // Tab A must be completely unaffected — still the sole owner.
    await expect(tabA.getByTestId('tab-write-guard-overlay')).toHaveCount(0);
    await expect(tabA.getByTestId('open-existing-workspace')).toBeVisible();

    await tabA.close();
    await tabB.close();
  });
});
