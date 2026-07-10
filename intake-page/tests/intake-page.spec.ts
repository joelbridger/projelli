import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request, type Route } from '@playwright/test';

import {
  deriveAuthToken,
  derivePageKey,
  generateIntakeKeypair,
  importContentKey,
  openItemChunk,
  openManifest,
  unwrapContentKey,
} from '../../src/platform/intake/intakeCrypto';
import { buildLinkFragment } from '../../src/platform/intake/intakeLink';
import type { BundleResponse, ChunkUpload, StateBlob, SubmitManifest } from '../../src/platform/intake/intakeContract';
import type { FormRequest } from '../../src/platform/intake/types';

const PAGE_BLOB_VERSION = 1;
const PAGE_IV_BYTES = 12;

interface IntakeChecklist extends FormRequest {
  client_first_name: string;
  firm: {
    name: string;
    accent: string;
    advisor_name: string;
    advisor_email: string;
    next_steps: string[];
  };
}

interface RelayHarness {
  url: string;
  privateKey: CryptoKey;
  chunks: ChunkUpload[];
  submits: SubmitManifest[];
  stateWrites: StateBlob[];
  externalRequests: string[];
  finalizedItemIds: Set<string>;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function buf(bytes: Uint8Array): Uint8Array {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes;
  return new Uint8Array(bytes);
}

async function sealPageJson(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(PAGE_IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: buf(iv) as unknown as BufferSource },
      key,
      buf(plaintext) as unknown as BufferSource,
    ),
  );
  const out = new Uint8Array(1 + PAGE_IV_BYTES + ciphertext.length);
  out[0] = PAGE_BLOB_VERSION;
  out.set(iv, 1);
  out.set(ciphertext, 1 + PAGE_IV_BYTES);
  return bytesToB64(out);
}

function sampleChecklist(): IntakeChecklist {
  return {
    request_id: 'request-1',
    schema_version: 1,
    matter_id: 'matter-1',
    kind: 'onboarding',
    client_first_name: 'Sarah',
    firm: {
      name: 'Journey Beyond Wealth',
      accent: '#2f7d62',
      advisor_name: 'Dana',
      advisor_email: 'dana@example.test',
      next_steps: ['Dana will review what you sent.', 'She will call if anything needs another look.'],
    },
    items: [
      {
        t: 'readonly_card',
        item_id: 'welcome',
        label: 'Welcome',
        help_text: '',
        required: false,
        subject: 'Sarah',
        body: 'Dana asked us to collect a few things so your accounts can be set up.',
      },
      {
        t: 'typed_field',
        item_id: 'dob',
        label: 'Date of birth',
        help_text: 'Schwab requires this to open your accounts.',
        required: true,
        subject: 'Sarah',
        fact_kind: 'dob',
        input: 'date',
      },
      {
        t: 'typed_field',
        item_id: 'ssn',
        label: 'Social Security number',
        help_text: 'This stays locked for Journey Beyond Wealth.',
        required: true,
        subject: 'Sarah',
        fact_kind: 'ssn',
        input: 'ssn',
      },
      {
        t: 'doc_upload',
        item_id: 'license',
        label: "Driver's license",
        help_text: 'Please send the front and back.',
        required: true,
        subject: 'Sarah',
        accepted_mime_types: ['image/jpeg', 'image/png'],
        max_files: 2,
      },
      {
        t: 'guided_question',
        item_id: 'income',
        label: 'Income',
        help_text: 'A close number is useful.',
        required: true,
        subject: 'Sarah',
        prompt: 'What is your yearly income?',
        response_format: 'money',
      },
      {
        t: 'guided_question',
        item_id: 'spending',
        label: 'Spending',
        help_text: 'A rough monthly guess is genuinely useful.',
        required: true,
        subject: 'Sarah',
        prompt: 'About how much do you spend each month?',
        response_format: 'money',
      },
    ],
  };
}

async function setupRelay(page: Page, finalized: string[] = []): Promise<RelayHarness> {
  const intakeId = `intake-${Math.random().toString(16).slice(2)}`;
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const { privateKey, publicKeyRaw } = await generateIntakeKeypair();
  const fragment = buildLinkFragment(bytesToB64(secret), publicKeyRaw);
  const pageKey = await derivePageKey(secret);
  const auth = await deriveAuthToken(secret);
  const checklistCiphertext = await sealPageJson(pageKey, sampleChecklist());
  let stateCiphertext = await sealPageJson(pageKey, {
    current_item_id: 'welcome',
    completion_flags: {},
    confirmations: {},
  });
  const finalizedItemIds = new Set(finalized);
  const chunks: ChunkUpload[] = [];
  const submits: SubmitManifest[] = [];
  const stateWrites: StateBlob[] = [];
  const uploaded = new Map<string, Set<number>>();
  const externalRequests: string[] = [];

  page.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'about:') return;
    if (url.origin !== 'http://127.0.0.1:4178') externalRequests.push(request.url());
  });

  await page.route('http://127.0.0.1:4178/intake/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const authHeader = request.headers().authorization;
    if (authHeader !== `Bearer ${auth.tokenB64}`) {
      await route.fulfill({ status: 401, json: { error: 'bad auth' } });
      return;
    }

    if (request.method() === 'GET' && url.pathname === `/intake/${intakeId}/bundle`) {
      const body: BundleResponse = {
        checklist_ciphertext_b64: checklistCiphertext,
        state_ciphertext_b64: stateCiphertext,
        checklist_version: 1,
        finalized_item_ids: Array.from(finalizedItemIds),
      };
      await route.fulfill({ status: 200, json: body });
      return;
    }

    if (request.method() === 'PUT' && url.pathname === `/intake/${intakeId}/state`) {
      const body = (await request.postDataJSON()) as StateBlob;
      stateCiphertext = body.ciphertext_b64;
      stateWrites.push(body);
      await route.fulfill({ status: 204 });
      return;
    }

    const chunkListMatch = url.pathname.match(new RegExp(`^/intake/${intakeId}/item/([^/]+)/chunks$`));
    if (request.method() === 'GET' && chunkListMatch) {
      const submissionId = url.searchParams.get('submission_id') ?? '';
      const key = `${chunkListMatch[1]}:${submissionId}`;
      await route.fulfill({
        status: 200,
        json: { uploaded_indexes: Array.from(uploaded.get(key) ?? []) },
      });
      return;
    }

    const chunkMatch = url.pathname.match(new RegExp(`^/intake/${intakeId}/item/([^/]+)/chunk$`));
    if (request.method() === 'POST' && chunkMatch) {
      const body = (await request.postDataJSON()) as ChunkUpload;
      chunks.push(body);
      const key = `${body.item_id}:${body.submission_id}`;
      if (!uploaded.has(key)) uploaded.set(key, new Set());
      uploaded.get(key)?.add(body.index);
      await route.fulfill({ status: 200, json: { ok: true } });
      return;
    }

    const submitMatch = url.pathname.match(new RegExp(`^/intake/${intakeId}/item/([^/]+)/submit$`));
    if (request.method() === 'POST' && submitMatch) {
      const body = (await request.postDataJSON()) as SubmitManifest;
      submits.push(body);
      finalizedItemIds.add(body.item_id);
      await route.fulfill({ status: 200, json: { ok: true } });
      return;
    }

    await route.fulfill({ status: 404, json: { error: 'missing mock route' } });
  });

  return {
    url: `/i/${intakeId}#${fragment}`,
    privateKey,
    chunks,
    submits,
    stateWrites,
    externalRequests,
    finalizedItemIds,
  };
}

async function openSubmittedPayload(harness: RelayHarness, itemId: string, index = 0): Promise<{
  manifestFileNames: string[];
  chunks: string[];
  submissionId: string;
}> {
  const submit = harness.submits.filter((entry) => entry.item_id === itemId)[index];
  expect(submit).toBeTruthy();
  const contentKeyB64 = await unwrapContentKey(submit.wrapped_content_key_b64, harness.privateKey);
  const contentKey = await importContentKey(contentKeyB64);
  const ids = { intakeId: submit.intake_id, itemId: submit.item_id, submissionId: submit.submission_id };
  const openedManifest = await openManifest(contentKey, submit.manifest_ciphertext_b64, ids);
  expect(openedManifest.ok).toBe(true);
  if (!openedManifest.ok) throw new Error('manifest did not open');
  const submittedChunks = harness.chunks
    .filter((chunk) => chunk.item_id === itemId && chunk.submission_id === submit.submission_id)
    .sort((a, b) => a.index - b.index);
  expect(submittedChunks).toHaveLength(openedManifest.manifest.chunk_count);
  const openedChunks: string[] = [];
  for (const chunk of submittedChunks) {
    const opened = await openItemChunk(contentKey, chunk.ciphertext_b64, {
      intakeId: chunk.intake_id,
      itemId: chunk.item_id,
      submissionId: chunk.submission_id,
      index: chunk.index,
    });
    expect(opened.ok).toBe(true);
    if (opened.ok) openedChunks.push(new TextDecoder().decode(opened.data));
  }
  return {
    manifestFileNames: openedManifest.manifest.file_names,
    chunks: openedChunks,
    submissionId: submit.submission_id,
  };
}

async function startChecklist(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start' }).click();
}

async function completeDob(page: Page, value = '1960-02-03'): Promise<void> {
  await page.getByLabel('Date of birth', { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Save and continue' }).click();
}

async function completeSsn(page: Page, value = '123-45-6789'): Promise<void> {
  await page.getByLabel('Social Security number', { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Save and continue' }).click();
}

async function completeLicense(page: Page): Promise<void> {
  await page.getByLabel('License front photo').setInputFiles({
    name: 'front.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('front-image'),
  });
  await page.getByLabel('License back photo').setInputFiles({
    name: 'back.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('back-image'),
  });
  await page.getByRole('button', { name: 'Save and continue' }).click();
}

async function completeIncome(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Enter an amount' }).click();
  await page.getByLabel('Yearly amount').fill('90000');
  await page.getByRole('button', { name: 'Save and continue' }).click();
}

async function completeSpending(page: Page): Promise<void> {
  await page.getByRole('button', { name: "I don't know yet" }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
}

async function completeAll(page: Page): Promise<void> {
  await startChecklist(page);
  await completeDob(page);
  await completeSsn(page);
  await completeLicense(page);
  await completeIncome(page);
  await completeSpending(page);
}

async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(serious).toEqual([]);
}

test('boots, decrypts the bundle, and renders the firm from sealed data', async ({ page }) => {
  const relay = await setupRelay(page);

  await page.goto(relay.url);

  await expect(page.getByRole('heading', { name: 'Hi Sarah. Welcome to Journey Beyond Wealth.' })).toBeVisible();
  await expect(page.getByText('This page locks your information on your device.')).toBeVisible();
  await expect(page.getByText('Lantern secure intake')).not.toBeVisible();
});

test('submits five client items as sealed chunks and sealed manifests', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);

  await completeAll(page);

  await expect(page.getByRole('heading', { name: "That's everything for now." })).toBeVisible();
  expect(relay.submits.map((submit) => submit.item_id)).toEqual(['dob', 'ssn', 'license', 'income', 'spending']);
  expect(relay.chunks.length).toBeGreaterThanOrEqual(6);

  const dob = await openSubmittedPayload(relay, 'dob');
  expect(JSON.parse(dob.chunks[0] ?? '{}')).toMatchObject({ item_id: 'dob', value: '1960-02-03' });

  const license = await openSubmittedPayload(relay, 'license');
  expect(license.manifestFileNames).toEqual(['front.jpg', 'back.jpg']);
  expect(license.chunks.join('\n')).toContain('front-image');
  expect(license.chunks.join('\n')).toContain('back-image');

  expect(relay.stateWrites.length).toBeGreaterThanOrEqual(5);
});

test('resumes at the next incomplete item after a full reload', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);

  await startChecklist(page);
  await completeDob(page);
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Social Security number' })).toBeVisible();
  await page.getByRole('button', { name: /Date of birth.*provided/i }).click();
  await expect(page.getByText('Provided ✓')).toBeVisible();
});

test('does not keep an SSN or last four digits after reload', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);

  await startChecklist(page);
  await completeDob(page);
  await completeSsn(page);
  await page.getByRole('button', { name: /Social Security number.*provided/i }).click();
  await expect(page.getByText('ending in 6789')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: /Social Security number.*provided/i }).click();
  await expect(page.getByText('ending in 6789')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('123-45-6789');
  await expect(page.locator('body')).not.toContainText('6789');
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...window.localStorage },
      session: { ...window.sessionStorage },
    }),
  );
  expect(storage).not.toContain('123-45-6789');
  expect(storage).not.toContain('6789');
});

test('replace answer creates a fresh submission id', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);

  await startChecklist(page);
  await completeDob(page, '1960-02-03');
  const first = relay.submits.find((submit) => submit.item_id === 'dob')?.submission_id;

  await page.getByRole('button', { name: /Date of birth.*provided/i }).click();
  await page.getByRole('button', { name: 'Replace this answer' }).click();
  await completeDob(page, '1961-04-05');

  await expect
    .poll(() => relay.submits.filter((submit) => submit.item_id === 'dob').length)
    .toBe(2);
  const dobSubmissions = relay.submits.filter((submit) => submit.item_id === 'dob');
  expect(dobSubmissions).toHaveLength(2);
  expect(dobSubmissions[1]?.submission_id).not.toBe(first);
});

test('old browsers see the sensitivity-routed fallback and no relay call', async ({ page }) => {
  let relayCalls = 0;
  await page.route('http://127.0.0.1:4178/intake/**', async (route) => {
    relayCalls += 1;
    await route.fulfill({ status: 500, body: 'should not be called' });
  });
  await page.addInitScript(() => {
    const getRandomValues = window.crypto.getRandomValues.bind(window.crypto);
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: { getRandomValues },
    });
  });

  await page.goto('/i/old-browser#v1.fake.fake');

  await expect(page.getByRole('heading', { name: 'Use another way to send this' })).toBeVisible();
  await expect(page.getByText("If this is a photo or file, reply to your advisor's email with it.")).toBeVisible();
  await expect(page.getByText('If this asks for a Social Security number, call your advisor and do it together.')).toBeVisible();
  expect(relayCalls).toBe(0);
});

test('has no serious or critical axe violations on the main screens', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);

  await expectNoSeriousAxeViolations(page);
  await startChecklist(page);
  await expectNoSeriousAxeViolations(page);
  await completeDob(page);
  await completeSsn(page);
  await expectNoSeriousAxeViolations(page);
  await completeLicense(page);
  await completeIncome(page);
  await completeSpending(page);
  await expectNoSeriousAxeViolations(page);
});

test('does not request any third-party origin during the full flow', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);

  await completeAll(page);

  expect(relay.externalRequests).toEqual([]);
});
