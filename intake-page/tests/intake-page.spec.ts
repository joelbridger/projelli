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
import { openPageJson } from '../../src/platform/intake/pageSeal';
import { sha256Hex } from '../../src/platform/intake/pdfTemplates/receipt';
import type {
  BundleResponse,
  ChunkUpload,
  DocumentDetectiveManifestEntry,
  StateBlob,
  SubmitManifest,
} from '../../src/platform/intake/intakeContract';
import type { FormRequest, PdfTemplateDescriptor } from '../../src/platform/intake/types';
import type { WelcomeJourney } from '../../src/platform/intake/welcomeJourneyDefaults';
import { syntheticAcroFormPdf } from './fixtures/pdfFixtures';

const PAGE_BLOB_VERSION = 1;
const PAGE_IV_BYTES = 12;
const TEST_ORIGIN = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? '4178'}`;

interface IntakeChecklist extends FormRequest {
  client_first_name: string;
  firm: {
    name: string;
    accent: string;
    advisor_name: string;
    advisor_email: string;
    next_steps: string[];
    journey?: WelcomeJourney;
  };
}

interface RelayHarness {
  url: string;
  privateKey: CryptoKey;
  chunks: ChunkUpload[];
  submits: SubmitManifest[];
  stateWrites: StateBlob[];
  readPersistedResume: () => Promise<Record<string, unknown>>;
  externalRequests: string[];
  finalizedItemIds: Set<string>;
}

interface RelaySetupOptions {
  checklist?: IntakeChecklist | Omit<IntakeChecklist, 'firm'>;
  finalized?: string[];
  resume?: Record<string, unknown>;
  stateWriteGate?: (state: StateBlob) => Promise<void>;
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

// Must match the shared @/platform/intake/pageSeal format byte-for-byte,
// including the GCM AAD, or the page cannot decrypt these fixtures.
const PAGE_BLOB_AAD = new TextEncoder().encode('intake/page/blob/v1');

async function sealPageJson(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(PAGE_IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: buf(iv) as unknown as BufferSource,
        additionalData: buf(PAGE_BLOB_AAD) as unknown as BufferSource,
      },
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
        accepted_mime_types: ['image/jpeg', 'image/png', 'application/pdf'],
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

function genericUploadChecklist(maxBytes = 4): IntakeChecklist {
  const base = sampleChecklist();
  return {
    ...base,
    items: [
      base.items[0],
      {
        t: 'doc_upload',
        item_id: 'tax_statements',
        label: 'Tax statements',
        help_text: 'Upload one or more files if you have them ready.',
        required: true,
        subject: 'Sarah',
        accepted_mime_types: ['application/pdf'],
        max_files: 3,
        max_bytes: maxBytes,
      },
    ],
  };
}

async function pdfFillChecklist(): Promise<IntakeChecklist> {
  const source = await syntheticAcroFormPdf();
  const template: PdfTemplateDescriptor = {
    templateId: 'contact-information-update-01', version: 1, kind: 'acroform', sourceSha256: await sha256Hex(source),
    sourceArtifactRef: 'sealed-artifact:contactinfoupdate0001', outputFileStem: 'contact-info', maxOutputBytes: 2 * 1024 * 1024,
    fields: {
      name: { kind: 'acroform', field_id: 'name', acroform_field: 'Client.Name', pdf_field_type: 'text', required: true },
      date: { kind: 'acroform', field_id: 'date', acroform_field: 'Date', pdf_field_type: 'date', required: true },
    },
  };
  const base = sampleChecklist();
  return {
    ...base,
    items: [
      base.items[0],
      {
        t: 'pdf_fill', item_id: 'ri_0123456789abcdef0123456789abcdef0123', label: 'Contact information update', help_text: 'Please confirm your details.',
        required: true, subject: 'Sarah', template, prefill: [],
        sealed_source_pdf_b64: bytesToB64(source),
      },
    ],
  };
}

async function setupRelay(page: Page, finalizedOrOptions: string[] | RelaySetupOptions = []): Promise<RelayHarness> {
  const options = Array.isArray(finalizedOrOptions) ? { finalized: finalizedOrOptions } : finalizedOrOptions;
  const intakeId = `intake-${Math.random().toString(16).slice(2)}`;
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const { privateKey, publicKeyRaw } = await generateIntakeKeypair();
  const fragment = buildLinkFragment(bytesToB64(secret), publicKeyRaw);
  const pageKey = await derivePageKey(secret);
  const auth = await deriveAuthToken(secret);
  const checklistCiphertext = await sealPageJson(pageKey, options.checklist ?? sampleChecklist());
  let stateCiphertext = await sealPageJson(pageKey, {
    current_item_id: 'welcome',
    completion_flags: {},
    confirmations: {},
    ...options.resume,
  });
  const finalizedItemIds = new Set(options.finalized ?? []);
  const chunks: ChunkUpload[] = [];
  const submits: SubmitManifest[] = [];
  const stateWrites: StateBlob[] = [];
  const uploaded = new Map<string, Set<number>>();
  const externalRequests: string[] = [];

  page.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'about:') return;
    if (url.origin !== TEST_ORIGIN) externalRequests.push(request.url());
  });

  await page.route(`${TEST_ORIGIN}/intake/**`, async (route: Route) => {
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
      stateWrites.push(body);
      await options.stateWriteGate?.(body);
      stateCiphertext = body.ciphertext_b64;
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
    readPersistedResume: () => openPageJson<Record<string, unknown>>(pageKey, stateCiphertext),
    externalRequests,
    finalizedItemIds,
  };
}

async function openSubmittedPayload(harness: RelayHarness, itemId: string, index = 0): Promise<{
  manifestFileNames: string[];
  manifestSessionId?: string;
  documentDetective: DocumentDetectiveManifestEntry[] | undefined;
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
    manifestSessionId: openedManifest.manifest.session_id,
    documentDetective: openedManifest.manifest.document_detective,
    chunks: openedChunks,
    submissionId: submit.submission_id,
  };
}

async function startChecklist(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Continue secure checklist' }).click();
}

async function expectSubmitCount(relay: RelayHarness, itemId: string, count: number): Promise<void> {
  await expect.poll(() => relay.submits.filter((submit) => submit.item_id === itemId).length).toBe(count);
}

async function completeDob(page: Page, value = '1960-02-03'): Promise<void> {
  await page.getByLabel('Date of birth', { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Social Security number' })).toBeVisible();
}

async function completeSsn(page: Page, value = '123-45-6789'): Promise<void> {
  await page.getByLabel('Social Security number', { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: "Driver's license" })).toBeVisible();
}

async function openLicenseScreen(page: Page): Promise<void> {
  await startChecklist(page);
  await completeDob(page);
  await completeSsn(page);
}

function pdfFixture(name: string, text: string): { name: string; mimeType: string; buffer: Buffer } {
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${text.replace(/[\\()]/gu, '\\$&')}) Tj\nET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${String(Buffer.byteLength(stream, 'ascii'))} >>\nstream\n${stream}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(pdf, 'ascii') };
}

const TAX_RETURN_FIXTURE = pdfFixture('tax-return.pdf', 'Form 1040 adjusted gross income');
const LICENSE_FRONT_FIXTURE = pdfFixture('license-front.pdf', 'Driver license class restrictions');
const LICENSE_BACK_FIXTURE = pdfFixture('license-back.pdf', 'PDF417 AAMVA DAQ barcode');

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
  await expect(page.getByRole('heading', { name: 'Income' })).toBeVisible();
}

async function completeIncome(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Enter an amount' }).click();
  await page.getByLabel('Yearly amount').fill('90000');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Spending' })).toBeVisible();
}

async function completeSpending(page: Page): Promise<void> {
  await page.getByRole('button', { name: "I don't know yet" }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: "Thanks, Sarah. You've sent the information we need to start." })).toBeVisible();
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

  await expect(page.getByRole('heading', { name: 'Welcome, Sarah.' })).toBeVisible();
  await expect(page.getByText('This page locks your information on your device.')).toBeVisible();
  await expect(page.getByText('Lantern secure intake')).not.toBeVisible();
  await expect(page.getByText('Information needed')).toBeVisible();
  await expect(page.getByText('Only Journey Beyond Wealth can unlock what you send.')).toBeVisible();
});

test('keeps one browser marker across page opens, seals it in each manifest, and changes it in a fresh browser', async ({ page, browser }) => {
  const firstRelay = await setupRelay(page);
  await page.goto(firstRelay.url);
  await startChecklist(page);
  await completeDob(page);
  const first = await openSubmittedPayload(firstRelay, 'dob');
  expect(first.manifestSessionId).toMatch(/^[a-f0-9-]{32,}$/iu);
  expect(JSON.stringify(firstRelay.submits)).not.toContain(first.manifestSessionId!);
  expect(JSON.stringify(firstRelay.chunks)).not.toContain(first.manifestSessionId!);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Social Security number' })).toBeVisible();
  await completeSsn(page);
  const second = await openSubmittedPayload(firstRelay, 'ssn');
  expect(second.manifestSessionId).toBe(first.manifestSessionId);

  const freshContext = await browser.newContext();
  try {
    const freshPage = await freshContext.newPage();
    const freshRelay = await setupRelay(freshPage);
    await freshPage.goto(`http://127.0.0.1:4178${freshRelay.url}`);
    await startChecklist(freshPage);
    await completeDob(freshPage);
    const fresh = await openSubmittedPayload(freshRelay, 'dob');
    expect(fresh.manifestSessionId).toMatch(/^[a-f0-9-]{32,}$/iu);
    expect(fresh.manifestSessionId).not.toBe(first.manifestSessionId);
    expect(JSON.stringify(freshRelay.submits)).not.toContain(fresh.manifestSessionId!);
    expect(JSON.stringify(freshRelay.chunks)).not.toContain(fresh.manifestSessionId!);
  } finally {
    await freshContext.close();
  }
});

test('keeps submitting when browser storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    const storageError = new DOMException('Browser storage is unavailable.', 'SecurityError');
    Storage.prototype.getItem = () => {
      throw storageError;
    };
    Storage.prototype.setItem = () => {
      throw storageError;
    };
  });
  const relay = await setupRelay(page);

  await page.goto(relay.url);
  await expect(page.getByRole('heading', { name: 'Welcome, Sarah.' })).toBeVisible();
  await startChecklist(page);
  await completeDob(page);

  const submitted = await openSubmittedPayload(relay, 'dob');
  expect(submitted.manifestSessionId).toMatch(/^[a-f0-9-]{32,}$/iu);
  expect(JSON.stringify(relay.submits)).not.toContain(submitted.manifestSessionId!);
  expect(JSON.stringify(relay.chunks)).not.toContain(submitted.manifestSessionId!);
});

test('opens an older link that has no firm branding', async ({ page }) => {
  const checklist = sampleChecklist();
  const { firm: _firm, ...legacyChecklist } = checklist;
  const relay = await setupRelay(page, { checklist: legacyChecklist });

  await page.goto(relay.url);

  await expect(page.getByRole('heading', { name: 'Welcome, Sarah.' })).toBeVisible();
  const accent = await page.locator('.page-shell').first().evaluate((element) => (element as HTMLElement).style.getPropertyValue('--accent'));
  expect(accent).toBe('#2f7d62');
});

test('submits five client items as sealed chunks and sealed manifests', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);

  await completeAll(page);

  await expect(page.getByRole('heading', { name: "Thanks, Sarah. You've sent the information we need to start." })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What happens next' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your team' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('—');
  expect(relay.submits.map((submit) => submit.item_id)).toEqual(['dob', 'ssn', 'license', 'license', 'income', 'spending']);
  expect(relay.chunks.length).toBeGreaterThanOrEqual(6);

  const dob = await openSubmittedPayload(relay, 'dob');
  expect(JSON.parse(dob.chunks[0] ?? '{}')).toMatchObject({ item_id: 'dob', value: '1960-02-03' });

  const licenseFront = await openSubmittedPayload(relay, 'license', 0);
  expect(licenseFront.manifestFileNames).toEqual(['front.jpg']);
  expect(licenseFront.chunks.join('\n')).toBe('front-image');
  const licenseBack = await openSubmittedPayload(relay, 'license', 1);
  expect(licenseBack.manifestFileNames).toEqual(['back.jpg']);
  expect(licenseBack.chunks.join('\n')).toBe('back-image');

  expect(relay.stateWrites.length).toBeGreaterThanOrEqual(5);
});

test('warns before a tax return is selected for a driver license', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);
  await openLicenseScreen(page);

  await page.getByLabel('License front photo').setInputFiles(TAX_RETURN_FIXTURE);

  await expect(page.getByRole('alert')).toContainText("This looks like a tax return, but this request asks for a driver's license.");
  await expectNoSeriousAxeViolations(page);
});

test('does not warn for a real license PDF in its matching slot', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);
  await openLicenseScreen(page);

  await page.getByLabel('License front photo').setInputFiles(LICENSE_FRONT_FIXTURE);

  await expect(page.getByText('front ready')).toBeVisible();
  await expect(page.locator('.document-warning')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('holds submission only while a selected file is being checked, then shows the settled warning', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeArrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function delayedPdfRead(): Promise<ArrayBuffer> {
      const value = await nativeArrayBuffer.call(this);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
      return value;
    };
  });
  const relay = await setupRelay(page);
  await page.goto(relay.url);
  await openLicenseScreen(page);

  await page.getByLabel('License back photo').setInputFiles({
    name: 'back.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('back-image'),
  });
  await expect(page.getByText('Checking your file...')).toHaveCount(0);
  await page.getByLabel('License front photo').setInputFiles(TAX_RETURN_FIXTURE);

  await expect(page.getByText('Checking your file...')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeDisabled();
  expect(relay.submits.filter((submit) => submit.item_id === 'license')).toHaveLength(0);

  await expect(page.getByRole('alert')).toContainText("This looks like a tax return, but this request asks for a driver's license.");
  await expect(page.getByText('Checking your file...')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeEnabled();
});

test('keeps the latest file classification when a client changes a file while checking', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeArrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function delayedTaxReturn(): Promise<ArrayBuffer> {
      const value = await nativeArrayBuffer.call(this);
      if (new TextDecoder().decode(value).includes('Form 1040')) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
      }
      return value;
    };
  });
  const relay = await setupRelay(page);
  await page.goto(relay.url);
  await openLicenseScreen(page);

  await page.getByLabel('License front photo').setInputFiles(TAX_RETURN_FIXTURE);
  await page.getByLabel('License front photo').setInputFiles(LICENSE_FRONT_FIXTURE);

  await expect(page.getByText('Checking your file...')).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('front ready')).toBeVisible();
});

test('warns when a driver license back is selected for the front slot', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);
  await openLicenseScreen(page);

  await page.getByLabel('License front photo').setInputFiles(LICENSE_BACK_FIXTURE);

  await expect(page.getByRole('alert')).toContainText("This looks like the back of a driver's license, but this spot is for the front.");
});

test('warns when both driver license slots look like the front', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);
  await openLicenseScreen(page);

  await page.getByLabel('License front photo').setInputFiles(LICENSE_FRONT_FIXTURE);
  await page.getByLabel('License back photo').setInputFiles(LICENSE_FRONT_FIXTURE);

  await expect(page.getByRole('alert')).toContainText("This looks like another front side of a driver's license.");
});

test('clears a warning when the client chooses a different file', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);
  await openLicenseScreen(page);

  await page.getByLabel('License front photo').setInputFiles(TAX_RETURN_FIXTURE);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Choose a different file' }).click();

  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('front needed')).toBeVisible();
});

test('keeps an advised upload, seals the override, and keeps warning details off relay and resume data', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);
  await openLicenseScreen(page);

  await page.getByLabel('License back photo').setInputFiles({
    name: 'back.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('back-image'),
  });
  await page.getByLabel('License front photo').setInputFiles(TAX_RETURN_FIXTURE);
  await page.getByRole('button', { name: 'Keep this file anyway' }).click();

  await expect(page.getByRole('heading', { name: 'Income' })).toBeVisible();
  const sealedFront = await openSubmittedPayload(relay, 'license', 0);
  expect(sealedFront.documentDetective).toEqual([
    expect.objectContaining({
      tier: 'tier1',
      slot_index: 0,
      warning_reason: 'wrong_doc',
      expected: 'drivers_license',
      observed: 'tax_return',
      kept_anyway: true,
    }),
  ]);

  const relayBodies = JSON.stringify({ chunks: relay.chunks, submits: relay.submits, state: relay.stateWrites });
  expect(relayBodies).not.toContain('wrong_doc');
  expect(relayBodies).not.toContain('drivers_license');
  expect(relayBodies).not.toContain('tax_return');
  await expect(page.locator('body')).not.toContainText('tax return');
  await expect(page.locator('body')).not.toContainText("driver's license");
});

test('keeps a warned file and submits it with one click once every slot is ready', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);
  await openLicenseScreen(page);

  await page.getByLabel('License back photo').setInputFiles({
    name: 'back.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('back-image'),
  });
  await page.getByLabel('License front photo').setInputFiles(TAX_RETURN_FIXTURE);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeEnabled();

  await page.getByRole('button', { name: 'Keep this file anyway' }).click();

  await expect(page.getByRole('heading', { name: 'Income' })).toBeVisible();
  await expectSubmitCount(relay, 'license', 2);
  const sealedFront = await openSubmittedPayload(relay, 'license', 0);
  expect(sealedFront.documentDetective).toEqual([
    expect.objectContaining({ warning_reason: 'wrong_doc', kept_anyway: true }),
  ]);
});

test('keeps a warned file while a slot is still missing, then submits from the Save and continue button', async ({ page }) => {
  // Regression for a bug where "Save and continue" silently no-oped after a
  // warning was kept anyway: the click passed a MouseEvent into a submit
  // function whose acknowledged-warnings default only applies when called
  // with no argument. This walks the two clicks separately (unlike the
  // "one click" test above, which completes on the Keep-anyway click itself
  // and never exercises the real Save-and-continue button while a warning
  // is still active).
  const relay = await setupRelay(page);
  await page.goto(relay.url);
  await openLicenseScreen(page);

  await page.getByLabel('License front photo').setInputFiles(TAX_RETURN_FIXTURE);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeDisabled();

  await page.getByRole('button', { name: 'Keep this file anyway' }).click();
  await expect(page.getByText('You chose to keep this file.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeDisabled();

  await page.getByLabel('License back photo').setInputFiles({
    name: 'back.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('back-image'),
  });
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByRole('heading', { name: 'Income' })).toBeVisible();
  await expectSubmitCount(relay, 'license', 2);
  const sealedFront = await openSubmittedPayload(relay, 'license', 0);
  expect(sealedFront.documentDetective).toEqual([
    expect.objectContaining({ warning_reason: 'wrong_doc', kept_anyway: true }),
  ]);
});

test('accepts realistic text in a pdf_fill text field instead of demanding a date shape', async ({ page }) => {
  // Regression: dateError() previously validated every pdf_fill field as if
  // it had to be a date, regardless of its declared pdf_field_type - a real
  // client typing an address, phone number, or name into a text field saw
  // "Enter a valid number." and could never enable Send. This checklist has
  // one text field and one genuinely date-typed field (a native
  // <input type="date">, which the browser itself already constrains to a
  // valid date shape or empty - so this test's job is specifically the text
  // field, the one dateError was wrongly blocking).
  const relay = await setupRelay(page, { checklist: await pdfFillChecklist() });
  await page.goto(relay.url);
  await startChecklist(page);

  await expect(page.getByRole('heading', { name: 'Contact information update' })).toBeVisible();
  const sendButton = page.getByRole('button', { name: 'Send securely to your advisor' });
  await expect(sendButton).toBeDisabled();

  await page.getByLabel('Name (required)').fill('123 Main St, Springfield');
  await expect(page.getByText('Enter a valid number.')).toHaveCount(0);
  await expect(sendButton).toBeDisabled();

  await page.getByLabel('Date (required)').fill('2020-01-01');
  await expect(sendButton).toBeEnabled();

  await sendButton.click();
  await expect(page.getByRole('heading', { name: /You've sent the information we need/u })).toBeVisible();
  await expectSubmitCount(relay, 'ri_0123456789abcdef0123456789abcdef0123', 1);
});

test('resumes at the next incomplete item after a full reload', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);

  await page.getByRole('button', { name: 'Learn how →' }).click();
  await expect(page.locator('h1')).toBeFocused();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Sarah.' })).toBeFocused();
  await startChecklist(page);
  await completeDob(page);
  await expectSubmitCount(relay, 'dob', 1);
  await page.reload();

  await expect(page.getByText('Welcome back, Sarah.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Social Security number' })).toBeVisible();
  await page.getByRole('button', { name: /Date of birth.*provided/i }).click();
  await expect(page.getByText('Provided ✓')).toBeVisible();
});

test('serializes rapid state saves so the newer progress and completion state wins', async ({ page }) => {
  let releaseFirstWrite: (() => void) | undefined;
  let firstWriteStarted!: () => void;
  const firstStateWriteStarted = new Promise<void>((resolve) => {
    firstWriteStarted = resolve;
  });
  let holdFirstWrite = true;
  const relay = await setupRelay(page, {
    stateWriteGate: async () => {
      if (!holdFirstWrite) return;
      holdFirstWrite = false;
      firstWriteStarted();
      await new Promise<void>((resolve) => {
        releaseFirstWrite = resolve;
      });
    },
  });
  await page.goto(relay.url);

  // Starting the checklist begins one save and holds its response. Completing
  // the first answer, then using a progress dot, creates newer saves while that
  // older one is still pending.
  await startChecklist(page);
  await firstStateWriteStarted;
  await completeDob(page);
  await expectSubmitCount(relay, 'dob', 1);
  await page.getByRole('button', { name: 'Income to do' }).click();
  await expect(page.getByRole('heading', { name: 'Income' })).toBeVisible();

  // The second logical update stays in the queue until the older request has
  // settled, so the server cannot receive out-of-order whole-state PUTs.
  expect(relay.stateWrites).toHaveLength(1);
  releaseFirstWrite?.();
  await expect.poll(() => relay.stateWrites.length).toBe(3);

  const persisted = await relay.readPersistedResume();
  expect(persisted).toMatchObject({
    current_item_id: 'income',
    completion_flags: { dob: true },
  });

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Income' })).toBeVisible();
});

test('shows the reviewing state from sealed resume data', async ({ page }) => {
  const relay = await setupRelay(page, {
    resume: { current_item_id: 'income', journey_state: 'reviewing', current_milestone_id: 'reviewing' },
  });
  await page.goto(relay.url);

  await expect(page.getByRole('heading', { name: "We're reviewing what you shared." })).toBeVisible();
  await expect(page.getByText('You do not need to do anything right now. Dana will reach out if anything is missing.')).toBeVisible();
  await expect(page.getByText('Your team')).toBeVisible();
});

test('only shows the configured lead advisor when the other team slots are empty', async ({ page }) => {
  const relay = await setupRelay(page, {
    resume: { current_item_id: 'income', journey_state: 'reviewing', current_milestone_id: 'reviewing' },
  });
  await page.goto(relay.url);

  await expect(page.locator('.team-person')).toHaveCount(1);
  await expect(page.locator('.team-person')).toContainText('Dana');
  await expect(page.locator('.team-person')).not.toContainText('Client service associate');
});

test('shows the sealed staff handoff notice on the completion screen', async ({ page }) => {
  const relay = await setupRelay(page, {
    finalized: ['dob', 'ssn', 'license', 'income', 'spending'],
    resume: { current_item_id: 'completion', handoff_person_name: 'Priya Shah' },
  });
  await page.goto(relay.url);

  await expect(page.getByRole('heading', { name: 'Your team has been updated.' })).toBeVisible();
  await expect(page.getByText('Priya Shah can help with uploads, signatures, and scheduling.')).toBeVisible();
});

test('resumes past items that the server already finalized', async ({ page }) => {
  const relay = await setupRelay(page, { finalized: ['dob'] });
  await page.goto(relay.url);

  await expect(page.getByRole('heading', { name: 'Social Security number' })).toBeVisible();
  await completeSsn(page);

  await expect(page.getByRole('heading', { name: "Driver's license" })).toBeVisible();
  await expectSubmitCount(relay, 'ssn', 1);
});

test('ignores hostile accent colors and makes no third-party request', async ({ page }) => {
  const checklist = sampleChecklist();
  checklist.firm.accent = 'url(https://evil.example/pixel)';
  const relay = await setupRelay(page, { checklist });

  await page.goto(relay.url);

  await expect(page.getByRole('heading', { name: 'Welcome, Sarah.' })).toBeVisible();
  const accent = await page.locator('.page-shell').first().evaluate((element) => (element as HTMLElement).style.getPropertyValue('--accent'));
  expect(accent).toBe('#2f7d62');
  expect(relay.externalRequests).toEqual([]);
});

test('keeps a bright firm accent readable without losing the firm color', async ({ page }) => {
  const checklist = sampleChecklist();
  checklist.firm.accent = '#ffff00';
  const relay = await setupRelay(page, { checklist });

  await page.goto(relay.url);

  await expect(page.locator('.page-shell')).toHaveCSS('--accent', '#ffff00');
  await expectNoSeriousAxeViolations(page);
});

test('requires exactly nine SSN digits before saving', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);

  await startChecklist(page);
  await completeDob(page);

  await page.getByLabel('Social Security number', { exact: true }).fill('123-45-678');
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeDisabled();
  expect(relay.submits.filter((submit) => submit.item_id === 'ssn')).toHaveLength(0);

  await page.getByLabel('Social Security number', { exact: true }).fill('123-45-6789');
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByRole('heading', { name: "Driver's license" })).toBeVisible();
  await expectSubmitCount(relay, 'ssn', 1);
});

test('does not keep an SSN or last four digits after reload', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);

  await startChecklist(page);
  await completeDob(page);
  await completeSsn(page);
  await page.getByRole('button', { name: /Social Security number.*provided/i }).click();
  await expect(page.locator('.provided-line').getByText('ending in 6789')).toBeVisible();

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

test('accepts comma-formatted amounts and rejects text amounts', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);

  await startChecklist(page);
  await completeDob(page);
  await completeSsn(page);
  await completeLicense(page);

  await page.getByRole('button', { name: 'Enter an amount' }).click();
  await page.getByLabel('Yearly amount').fill('abc');
  await expect(page.getByText('Enter a number, like 90,000.')).toBeVisible();
  await expect(page.getByLabel('Yearly amount')).toHaveAttribute('aria-describedby', /income-error/);
  await expect(page.getByLabel('Yearly amount')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeDisabled();
  expect(relay.submits.filter((submit) => submit.item_id === 'income')).toHaveLength(0);

  await page.getByLabel('Yearly amount').fill('90,000');
  await expect(page.getByText('Enter a number, like 90,000.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByRole('heading', { name: 'Spending' })).toBeVisible();
  const income = await openSubmittedPayload(relay, 'income');
  expect(JSON.parse(income.chunks[0] ?? '{}')).toMatchObject({
    answer: { mode: 'amount', amount: 90000, currency: 'USD' },
  });
});

test('treats upload max files as a limit and rejects oversize files', async ({ page }) => {
  const relay = await setupRelay(page, { checklist: genericUploadChecklist(4) });
  await page.goto(relay.url);

  await startChecklist(page);
  await expect(page.getByRole('heading', { name: 'Tax statements' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeDisabled();

  await page.getByLabel('Choose file 1 file').setInputFiles({
    name: 'too-large.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('12345'),
  });
  await expect(page.getByText('This file is too large. Choose a file under 4 bytes.')).toBeVisible();
  await expect(page.getByLabel('Choose file 1 file')).toHaveAttribute('aria-describedby', /tax_statements-file-error/);
  await expect(page.getByLabel('Choose file 1 file')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeDisabled();
  expect(relay.submits.filter((submit) => submit.item_id === 'tax_statements')).toHaveLength(0);

  await page.getByLabel('Choose file 1 file').setInputFiles({
    name: 'statement.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('1234'),
  });
  await expect(page.getByText('This file is too large. Choose a file under 4 bytes.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByRole('heading', { name: "Thanks, Sarah. You've sent the information we need to start." })).toBeVisible();
  const upload = await openSubmittedPayload(relay, 'tax_statements');
  expect(upload.manifestFileNames).toEqual(['statement.pdf']);
});

test('old browsers see the sensitivity-routed fallback and no relay call', async ({ page }) => {
  let relayCalls = 0;
  await page.route(`${TEST_ORIGIN}/intake/**`, async (route) => {
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

test('has no serious or critical axe violations across the client journey', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);

  await expectNoSeriousAxeViolations(page);
  await startChecklist(page);
  await expectNoSeriousAxeViolations(page);
  await completeDob(page);
  await expectNoSeriousAxeViolations(page);
  await completeSsn(page);
  await expectNoSeriousAxeViolations(page);
  await completeLicense(page);
  await page.getByRole('button', { name: 'Choose a range' }).click();
  await expectNoSeriousAxeViolations(page);
  await page.getByRole('button', { name: "I don't know yet" }).click();
  await expectNoSeriousAxeViolations(page);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Spending' })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await page.getByRole('button', { name: 'Enter an amount' }).click();
  await page.getByLabel('Monthly amount').fill('4,500');
  await expectNoSeriousAxeViolations(page);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expectNoSeriousAxeViolations(page);
});

test('keeps the new item heading focused and announces progress and SSN confirmation', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);

  await startChecklist(page);
  await expect(page.getByRole('heading', { name: 'Date of birth' })).toBeFocused();
  await expect(page.locator('[role="status"]').filter({ hasText: 'Checklist progress: item 1 of 5.' })).toBeVisible();

  await page.getByLabel('Date of birth', { exact: true }).fill('1960-02-03');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Social Security number' })).toBeFocused();
  await expect(page.locator('[role="status"]').filter({ hasText: 'Checklist progress: item 2 of 5.' })).toBeVisible();

  const ssn = page.getByLabel('Social Security number', { exact: true });
  await expect(ssn).toHaveAccessibleName('Social Security number');
  await expect(ssn).toHaveAttribute('aria-describedby', /ssn-help/);
  await ssn.fill('123-45-6789');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: "Driver's license" })).toBeFocused();
  await expect(page.locator('[role="status"]').filter({ hasText: 'Social Security number provided (ending in 6789)' })).toBeVisible();
});

test('has no serious or critical axe violations on resume, fallback, error, and loading states', async ({ page }) => {
  const resumeRelay = await setupRelay(page, { resume: { current_item_id: 'income' } });
  await page.goto(resumeRelay.url);
  await expect(page.getByRole('heading', { name: 'Income' })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.addInitScript(() => {
    (window as unknown as { __INTAKE_FORCE_NO_WEBCRYPTO__?: boolean }).__INTAKE_FORCE_NO_WEBCRYPTO__ = true;
  });
  await page.goto('/i/old-browser#v1.fake.fake');
  await expect(page.getByRole('heading', { name: 'Use another way to send this' })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

test('has no serious or critical axe violations on error and loading states', async ({ page }) => {
  await page.goto('/i/missing#v1.not-a-complete-link');
  await expect(page.getByRole('heading', { name: 'We could not open this page.' })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  const relay = await setupRelay(page);
  let pendingBundle: Route | undefined;
  await page.route('**/bundle', async (route) => {
    pendingBundle = route;
  });
  await page.goto(relay.url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Opening your page.' })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await pendingBundle?.abort();
});

test('keeps the phone layout usable at 200 percent zoom and respects reduced motion', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 160, height: 900 });
  await page.goto(relay.url);
  await startChecklist(page);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeVisible();
  expect(Number.parseFloat(await page.locator('.primary-button').evaluate((element) => getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.01);
});

test('does not request any third-party origin during the full flow', async ({ page }) => {
  const relay = await setupRelay(page);
  await page.goto(relay.url);

  await completeAll(page);

  expect(relay.externalRequests).toEqual([]);
});
