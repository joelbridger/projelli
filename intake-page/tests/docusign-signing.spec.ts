import { expect, test, type Page, type Route } from '@playwright/test';

import { deriveAuthToken, derivePageKey, generateIntakeKeypair } from '../../src/platform/intake/intakeCrypto';
import { buildLinkFragment } from '../../src/platform/intake/intakeLink';
import type { BundleResponse } from '../../src/platform/intake/intakeContract';
import type { SignatureLaunchRecord } from '../../src/platform/intake/docusignSignature/signatureLaunch';
import { sealPageJson } from '../src/pageCrypto';
import type { IntakeChecklist } from '../src/types';
import { sealedSyntheticSignatureLaunch, syntheticSignatureLaunch } from './fixtures/docusignSigningFixtures';

const TEST_ORIGIN = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? '4178'}`;
const RECIPIENT_VIEW_URL = 'https://demo.docusign.test/recipient-view/synthetic-one-time-url';

function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

interface RelayHarness {
  url: string;
  openCalls: () => Promise<string[]>;
  launchRequests: string[];
  consoleMessages: string[];
}

function signingChecklist(): IntakeChecklist {
  return {
    request_id: 'request-synthetic-signing',
    schema_version: 1,
    matter_id: 'sealed-only-synthetic-matter',
    kind: 'standing',
    client_first_name: 'Synthetic',
    firm: {
      name: 'Synthetic Advisor',
      accent: '#2f7d62',
      advisor_name: 'Advisor',
      advisor_email: 'advisor@example.test',
      next_steps: [],
    },
    items: [],
  };
}

async function setupSigningRelay(page: Page, launch: SignatureLaunchRecord | null): Promise<RelayHarness> {
  const intakeId = `intake-signing-${Math.random().toString(16).slice(2)}`;
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const { publicKeyRaw } = await generateIntakeKeypair();
  const fragment = buildLinkFragment(bytesToB64(secret), publicKeyRaw);
  const pageKey = await derivePageKey(secret);
  const auth = await deriveAuthToken(secret);
  const checklistCiphertext = await sealPageJson(pageKey, signingChecklist());
  const stateCiphertext = await sealPageJson(pageKey, { completion_flags: {}, confirmations: {}, skipped_item_ids: [], pending_uploads: {} });
  const launchCiphertext = launch ? await sealedSyntheticSignatureLaunch(pageKey, launch) : null;
  const launchRequests: string[] = [];
  const consoleMessages: string[] = [];

  page.on('console', (message) => consoleMessages.push(message.text()));
  await page.addInitScript(() => {
    const calls: string[] = [];
    const nativeOpen = window.open.bind(window);
    Object.defineProperty(window, '__docusignOpenCalls', { configurable: true, value: calls });
    Object.defineProperty(window, '__nativeWindowOpen', { configurable: true, value: nativeOpen });
    window.open = ((url?: string | URL) => {
      calls.push(String(url));
      return window;
    }) as typeof window.open;
  });

  await page.route(`${TEST_ORIGIN}/intake/**`, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.headers().authorization !== `Bearer ${auth.tokenB64}`) {
      await route.fulfill({ status: 401 });
      return;
    }
    if (request.method() === 'GET' && url.pathname === `/intake/${intakeId}/bundle`) {
      const body: BundleResponse = {
        checklist_ciphertext_b64: checklistCiphertext,
        state_ciphertext_b64: stateCiphertext,
        checklist_version: 1,
        finalized_item_ids: [],
      };
      await route.fulfill({ status: 200, json: body });
      return;
    }
    await route.fulfill({ status: 404 });
  });
  await page.route(`${TEST_ORIGIN}/docusign-signing/**`, async (route: Route) => {
    const request = route.request();
    launchRequests.push(request.url());
    if (request.headers().authorization !== `Bearer ${auth.tokenB64}`) {
      await route.fulfill({ status: 401 });
      return;
    }
    await route.fulfill({ status: 200, json: { launch_ciphertext_b64: launchCiphertext } });
  });

  return {
    url: `/i/${intakeId}#${fragment}`,
    openCalls: () => page.evaluate(() => (window as unknown as { __docusignOpenCalls: string[] }).__docusignOpenCalls),
    launchRequests,
    consoleMessages,
  };
}

async function openConsent(page: Page, harness: RelayHarness): Promise<void> {
  await page.goto(harness.url);
  await expect(page.getByRole('heading', { name: 'Review and sign with DocuSign' })).toBeVisible();
}

test('requires consent, opens the exact one-time URL once, and stays safe through refresh', async ({ page }) => {
  const harness = await setupSigningRelay(page, syntheticSignatureLaunch());
  await openConsent(page, harness);
  expect(await harness.openCalls()).toEqual([]);

  await page.getByRole('button', { name: 'Continue to DocuSign' }).click();
  await expect(page.getByRole('heading', { name: 'Your signing window is open' })).toBeVisible();
  expect(await harness.openCalls()).toEqual([RECIPIENT_VIEW_URL]);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your signing window is open' })).toBeVisible();
  expect(await harness.openCalls()).toEqual([]);

  await page.goto('/docusign-signing-return?event=unknown');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Your signing window is open' })).toBeVisible();
  expect(await harness.openCalls()).toEqual([]);
});

test('supports the complete keyboard-only consent flow', async ({ page }) => {
  const harness = await setupSigningRelay(page, syntheticSignatureLaunch());
  await openConsent(page, harness);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Continue to DocuSign' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Your signing window is open' })).toBeFocused();
  expect(await harness.openCalls()).toEqual([RECIPIENT_VIEW_URL]);
});

test('rejects an expired launch before a browser window can open', async ({ page }) => {
  const expired = await setupSigningRelay(page, syntheticSignatureLaunch({
    issuedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    expiresAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  }));
  await page.goto(expired.url);
  await expect(page.getByRole('heading', { name: 'This signing link has expired' })).toBeVisible();
  expect(await expired.openCalls()).toEqual([]);
});

test('rejects an already-consumed launch before a browser window can open', async ({ page }) => {
  const consumed = await setupSigningRelay(page, syntheticSignatureLaunch({ consumed: true }));
  await page.goto(consumed.url);
  await expect(page.getByRole('heading', { name: 'This signing link has expired' })).toBeVisible();
  expect(await consumed.openCalls()).toEqual([]);
});

test.describe('trusted return outcomes', () => {
  for (const [outcome, heading] of [
    ['signing_complete', 'Your signed form is being confirmed'],
    ['cancel', 'Your signing was not finished'],
    ['decline', 'You chose not to sign the form'],
    ['ttl_expired', 'This signing link has expired'],
    ['exception', 'Something went wrong with signing'],
  ] as const) {
    test(`accepts ${outcome} only from this app origin`, async ({ page }) => {
      const harness = await setupSigningRelay(page, syntheticSignatureLaunch());
      await openConsent(page, harness);
      await page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', {
          origin: 'https://untrusted.example.test',
          data: { type: 'lantern:docusign-signing-outcome', outcome: 'signing_complete' },
        }));
      });
      await expect(page.getByRole('heading', { name: 'Review and sign with DocuSign' })).toBeVisible();
      await page.evaluate((messageOutcome) => {
        window.dispatchEvent(new MessageEvent('message', {
          origin: window.location.origin,
          data: { type: 'lantern:docusign-signing-outcome', outcome: messageOutcome },
        }));
      }, outcome);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    });
  }

  test('ignores messages with an unrecognized shape or event', async ({ page }) => {
    const harness = await setupSigningRelay(page, syntheticSignatureLaunch());
    await openConsent(page, harness);
    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'lantern:docusign-signing-outcome', outcome: 'viewing_complete', extra: 'not allowed' },
      }));
    });
    await expect(page.getByRole('heading', { name: 'Review and sign with DocuSign' })).toBeVisible();
  });

  test('the static return page sends its small allow-listed outcome to its opener', async ({ page }) => {
    const harness = await setupSigningRelay(page, syntheticSignatureLaunch());
    await openConsent(page, harness);
    const popupPromise = page.waitForEvent('popup');
    await page.evaluate(() => {
      (window as unknown as { __nativeWindowOpen: (url: string, name: string) => Window | null })
        .__nativeWindowOpen('/docusign-signing-return?event=signing_complete', 'docusign-return-test');
    });
    const popup = await popupPromise;
    await expect(page.getByRole('heading', { name: 'Your signed form is being confirmed' })).toBeVisible();
    await popup.close().catch(() => undefined);
  });
});

test('data-free return route accepts only DocuSign event and reports unknown events safely', async ({ page }) => {
  await page.goto('/docusign-signing-return?event=unknown');
  await expect(page.getByRole('heading', { name: 'Something went wrong with signing' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('sealed-only-synthetic-matter');
});

test('keeps the launch relay wire and browser surface free of protected values', async ({ page }) => {
  const harness = await setupSigningRelay(page, syntheticSignatureLaunch());
  const requests: Array<{ url: string; body: string | null }> = [];
  page.on('request', (request) => requests.push({ url: request.url(), body: request.postData() }));
  await openConsent(page, harness);
  await page.getByRole('button', { name: 'Continue to DocuSign' }).click();

  expect(harness.launchRequests).toHaveLength(1);
  const publicSurface = `${await page.content()}\n${JSON.stringify(requests)}\n${harness.consoleMessages.join('\n')}`;
  for (const protectedValue of ['sealed-only-synthetic-matter', 'envelope', 'Bearer ', 'JWT', 'certificate', 'W8 PDF']) {
    expect(publicSurface).not.toContain(protectedValue);
  }
  expect(await harness.openCalls()).toEqual([RECIPIENT_VIEW_URL]);
});
