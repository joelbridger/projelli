/**
 * Mandatory real DocuSign-demo round trip. This is intentionally opt-in: it
 * creates a synthetic envelope and drives a browser signing ceremony.
 *
 * Follow-up adverse cases still required by W9-PREP §8:
 * - failed/expired recipient views and browser-return tampering;
 * - DocuSign decline/void/timeout transitions and repeated Connect delivery;
 * - interrupted local filing and restart recovery; and
 * - certificate/PDF retrieval failures or malformed DocuSign documents.
 */
import { randomUUID } from 'node:crypto';
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDocusignAuthorizationProvider } from '@/platform/docusignSigning/capabilityClient';
import { DirectDocusignAdapter } from '@/platform/docusignSigning/docusignAdapter';
import { registerDocusignEnvelope } from '@/platform/docusignSigning/envelopeRegistration';
import { DocusignLaunchRelayClient } from '@/platform/docusignSigning/launchRelayClient';
import {
  decryptSignatureArtifact,
  retrieveAndFileDocusignCompletion,
  startDocusignSignature,
} from '@/platform/docusignSigning/signatureWorkflow';
import { signatureOutputFileNames } from '@/platform/intake/docusignSignature/signatureOutputNaming';
import { fileIntakeDocument } from '@/platform/intake/intakeFiling';
import { b64ToBytes, openPageJson } from '@/platform/intake/pageSeal';
import { derivePageKey } from '@/platform/intake/intakeCrypto';
import { createAdvisorIntake } from '@/platform/intake/createIntake';
import { IntakeRelayClient } from '@/platform/intake/IntakeRelayClient';
import { useIntakeStore } from '@/platform/intake/intakeStore';
import { sha256Hex } from '@/platform/intake/pdfTemplates/receipt';
import type { PdfCompletionReceipt, PdfFillRequestItem, RequestItem, FormRequest } from '@/platform/intake/types';
import { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { FSBackend, FileStat } from '@/platform/fs/types';
import type { FileNode } from '@/platform/types/workspace';
import { DEFAULT_WELCOME_JOURNEY } from '@/platform/intake/welcomeJourneyDefaults';

import { loadDocusignSandboxCredentials, type DocusignSandboxCredentials } from './docusignSandboxCreds';

const LOCAL_ADMIN_PROVISION_SECRET = 'docusign-sandbox-provision-secret-0123456789';

const execFileAsync = promisify(execFile);
const LIVE_OK = process.env['DOCUSIGN_LIVE_SANDBOX_OK'] === '1' && loadDocusignSandboxCredentials() !== null;
const credentials = LIVE_OK ? loadDocusignSandboxCredentials() : null;

interface BackendProcess {
  process: ChildProcess;
  baseUrl: string;
  stop: () => Promise<void>;
}

interface AuthenticatedSandboxUser {
  accessToken: string;
  seatToken: string;
}

type CapabilityWithPinnedReturnUrl = {
  accessToken: string;
  accountId: string;
  baseUri: string;
  expiresAt: string;
  /** Added by the parallel return-URL pinning fix before this test is integrated. */
  allowedReturnUrl: string;
};

/** Small real-disk FSBackend used only because the app has no Node filesystem backend. */
class TempDirectoryFSBackend implements FSBackend {
  private rootPath = '';

  private path(path: string): string {
    const full = resolve(this.rootPath, path || '.');
    const fromRoot = relative(this.rootPath, full);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) throw new Error(`Path escapes temporary workspace: ${path}`);
    return full;
  }

  async read(path: string): Promise<string> { return readFile(this.path(path), 'utf8'); }
  async readBinary(path: string): Promise<ArrayBuffer> {
    const bytes = await readFile(this.path(path));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  async write(path: string, content: string): Promise<void> { await writeFile(this.path(path), content); }
  async writeBinary(path: string, content: ArrayBuffer): Promise<void> { await writeFile(this.path(path), new Uint8Array(content)); }
  async exists(path: string): Promise<boolean> { try { await access(this.path(path)); return true; } catch { return false; } }
  async delete(path: string): Promise<void> { await rm(this.path(path), { recursive: true, force: true }); }
  async move(from: string, to: string): Promise<void> { await mkdir(dirname(this.path(to)), { recursive: true }); await rename(this.path(from), this.path(to)); }
  async copy(from: string, to: string): Promise<void> { await cp(this.path(from), this.path(to), { recursive: true }); }
  async rename(path: string, newName: string): Promise<void> { await rename(this.path(path), join(dirname(this.path(path)), newName)); }
  async mkdir(path: string): Promise<void> { await mkdir(this.path(path), { recursive: true }); }
  async list(path: string): Promise<FileNode[]> {
    return Promise.all((await readdir(this.path(path), { withFileTypes: true })).map(async (entry) => {
      const child = path ? `${path}/${entry.name}` : entry.name;
      const details = await stat(this.path(child));
      return { id: child, name: entry.name, path: child, type: entry.isDirectory() ? 'folder' : 'file', size: details.size, modifiedAt: details.mtime };
    }));
  }
  async stat(path: string): Promise<FileStat> {
    const details = await stat(this.path(path));
    return { path, name: basename(this.path(path)), type: details.isDirectory() ? 'folder' : 'file', size: details.size, createdAt: details.birthtime, modifiedAt: details.mtime, isSymlink: details.isSymbolicLink() };
  }
  async isSymlink(path: string): Promise<boolean> { try { return (await lstat(this.path(path))).isSymbolicLink(); } catch { return false; } }
  async resolveSymlink(path: string): Promise<string> { return realpath(this.path(path)); }
  getRootPath(): string { return this.rootPath; }
  async setRootPath(path: string, options?: { createIfMissing?: boolean }): Promise<void> {
    this.rootPath = resolve(path);
    if (options?.createIfMissing) await mkdir(this.rootPath, { recursive: true });
  }
}

function pdfItem(itemId = 'pdf-fill-item', sourceSha256 = 'a'.repeat(64)): PdfFillRequestItem {
  return {
    t: 'pdf_fill', item_id: itemId, label: 'Completed synthetic form', help_text: '', required: true, subject: 'primary', prefill: [],
    template: {
      templateId: 'template_approved_w9_sandbox', version: 1, kind: 'acroform', sourceSha256,
      sourceArtifactRef: 'sealed-artifact:w9sandboxfixture', outputFileStem: 'w9-sandbox-completed', maxOutputBytes: 1024 * 1024,
      fields: { name: { kind: 'acroform', field_id: 'name', acroform_field: 'Name', pdf_field_type: 'text' } },
    },
  };
}

function signature(sourceId: string): Extract<RequestItem, { t: 'signature' }> {
  return {
    t: 'signature', item_id: 'signature-item', label: 'Sign synthetic form', help_text: '', required: true, subject: 'primary', grade: 'docusign', source_pdf_fill_item_id: sourceId,
    tab_map: {
      signatureTab: { page: 1, rect: { x: 0.12, y: 0.18, width: 0.34, height: 0.10 } },
      dateSignedTab: { page: 1, rect: { x: 0.12, y: 0.34, width: 0.34, height: 0.07 } },
      signerNameTab: { page: 1, rect: { x: 0.12, y: 0.46, width: 0.34, height: 0.07 } },
    },
  };
}

function request(items: RequestItem[]): FormRequest {
  return { request_id: `w9-sandbox-${randomUUID()}`, schema_version: 1, matter_id: 'synthetic-sandbox-matter', kind: 'standing', items };
}

async function createSyntheticCompletedPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('Wave 9 synthetic completed form', { x: 72, y: 720, size: 18, font, color: rgb(0, 0, 0) });
  page.drawText('Synthetic signer: Avery Sandbox', { x: 72, y: 680, size: 12, font });
  return document.save();
}

function receiptFor(bytes: Uint8Array, item: PdfFillRequestItem): Promise<PdfCompletionReceipt> {
  // The Wave 8 receipt contract has validation/hash helpers but no separate
  // receipt issuer; this is the real contract shape and real SHA-256 helper.
  return sha256Hex(bytes).then((completedSha256) => ({
    issuedItemId: item.item_id,
    templateId: item.template.templateId,
    templateVersion: item.template.version,
    sourceSha256: item.template.sourceSha256,
    completedSha256,
    completedAt: new Date().toISOString(),
    pageVersion: 'w8-sandbox',
  }));
}

async function waitForBackendStart(process: ChildProcess): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Timed out starting the local signing broker. Output: ${output}`)), 30_000);
    const onOutput = (chunk: Buffer | string) => {
      output += chunk.toString();
      const match = output.match(/listening on http:\/\/[^:]+:(\d+)/u);
      if (match?.[1]) {
        clearTimeout(timeout);
        process.stdout?.off('data', onOutput);
        process.stderr?.off('data', onOutput);
        resolveUrl(`http://127.0.0.1:${match[1]}`);
      }
    };
    process.stdout?.on('data', onOutput);
    process.stderr?.on('data', onOutput);
    process.once('error', (error) => { clearTimeout(timeout); reject(error); });
    process.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Local signing broker exited before startup (code ${String(code)}): ${output}`)); });
  });
}

async function waitForHealth(baseUrl: string): Promise<void> {
  let lastError = 'no response';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
      lastError = `HTTP ${String(response.status)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Local signing broker did not become healthy: ${lastError}`);
}

async function bootBackend(config: DocusignSandboxCredentials): Promise<BackendProcess> {
  const dbDirectory = await mkdtemp(join(tmpdir(), 'docusign-sandbox-backend-'));
  const environment: NodeJS.ProcessEnv = { ...process.env };
  delete environment['DOCUSIGN_SIGNING_PRODUCTION_RELEASE'];
  delete environment['DOCUSIGN_SIGNING_PRODUCTION_API_BASE_URI'];
  delete environment['DOCUSIGN_SIGNING_PRIVATE_KEY_PEM'];
  const { path: _credentialsPath, ...docusignEnvironment } = config;
  Object.assign(environment, docusignEnvironment, {
    NODE_ENV: 'test', BUN_TEST: '1', HOST: '127.0.0.1', PORT: '0', DB_PATH: join(dbDirectory, 'broker.sqlite'),
    ADMIN_PROVISION_SECRET: LOCAL_ADMIN_PROVISION_SECRET,
    AUTH_RATE_LIMIT_MAX: '1000', RELAY_RATE_LIMIT_MAX: '1000',
  });
  const child = spawn('bun', ['run', 'backend/src/server.ts'], { cwd: process.cwd(), env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let baseUrl: string;
  try {
    baseUrl = await waitForBackendStart(child);
    await waitForHealth(baseUrl);
  } catch (error) {
    if (!child.killed) child.kill('SIGTERM');
    await new Promise<void>((resolveStop) => { child.once('exit', () => resolveStop()); setTimeout(resolveStop, 5_000); });
    await rm(dbDirectory, { recursive: true, force: true });
    throw error;
  }
  return {
    process: child,
    baseUrl,
    stop: async () => {
      if (!child.killed) child.kill('SIGTERM');
      await new Promise<void>((resolveStop) => child.once('exit', () => resolveStop()));
      await rm(dbDirectory, { recursive: true, force: true });
    },
  };
}

async function postJson<T>(baseUrl: string, path: string, body: unknown, accessToken?: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Local signing broker ${path} failed with HTTP ${String(response.status)}.`);
  return response.json() as Promise<T>;
}

async function provisionSyntheticAdvisor(baseUrl: string): Promise<AuthenticatedSandboxUser> {
  const email = `w9-sandbox-${randomUUID()}@example.test`;
  const password = 'synthetic-sandbox-password-123';
  const org = await postJson<{ license_key: string }>(baseUrl, '/admin/org', {
    name: `W9 Synthetic Sandbox ${randomUUID()}`, plan: 'personal', packs: ['advisor'], seat_limit: 1, admin_email: email, admin_password: password,
  }, LOCAL_ADMIN_PROVISION_SECRET);
  const login = await postJson<{ access_token: string }>(baseUrl, '/auth/login', { email, password });
  const activation = await postJson<{ token: string }>(baseUrl, '/org/activate', { license_key: org.license_key, machine_id: `w9-sandbox-${randomUUID()}`, machine_label: 'W9 synthetic sandbox' }, login.access_token);
  return { accessToken: login.access_token, seatToken: activation.token };
}

async function chrome(args: string[]): Promise<string> {
  const result = await execFileAsync('chrome-cdp', args, { timeout: 30_000, maxBuffer: 1024 * 1024 });
  return `${result.stdout}\n${result.stderr}`;
}

function matchingRef(snapshot: string, label: RegExp): string | null {
  const lines = snapshot.split(/\r?\n/u);
  for (const line of lines) {
    if (!label.test(line)) continue;
    const ref = line.match(/\b(e\d+)\b/u)?.[1];
    if (ref) return ref;
  }
  return null;
}

async function completeRecipientCeremony(recipientViewUrl: string, allowedReturnUrl: string): Promise<void> {
  const session = `docusign-sandbox-roundtrip-${randomUUID()}`;
  let lastSnapshot = '';
  try {
    await chrome(['session', 'create', session, '--intent', 'Complete one synthetic DocuSign demo signing ceremony for the Wave 9 release gate.']);
    await chrome(['navigate', recipientViewUrl, '--session', session]);
    for (let step = 0; step < 18; step += 1) {
      const currentUrl = await chrome(['eval', 'location.href', '--session', session]);
      if (currentUrl.includes(allowedReturnUrl)) return;
      lastSnapshot = await chrome(['snapshot', '--session', session]);
      const ref = matchingRef(lastSnapshot, /\b(start|continue|adopt(?: and sign)?|sign|finish|complete)\b/iu);
      if (!ref) {
        throw new Error(`DocuSign ceremony needs a selector update at step ${String(step + 1)}. No known action was exposed by Chrome. Snapshot:\n${lastSnapshot}`);
      }
      await chrome(['click', ref, '--session', session]);
    }
    throw new Error(`DocuSign ceremony did not return to the configured return URL after 18 actions. Last snapshot:\n${lastSnapshot}`);
  } finally {
    await chrome(['session', 'close', session]).catch(() => undefined);
  }
}

async function waitForCompleted(adapter: DirectDocusignAdapter, envelopeId: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await adapter.pollEnvelopeStatus(envelopeId, 1, 0);
    if (status === 'completed') return;
    if (['declined', 'voided', 'timedout', 'deleted'].includes(status)) throw new Error(`Synthetic DocuSign envelope ended as ${status}.`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  }
  throw new Error('Synthetic DocuSign envelope did not become completed within 60 seconds.');
}

async function obtainPinnedCapability(
  provider: ReturnType<typeof createDocusignAuthorizationProvider>,
): Promise<CapabilityWithPinnedReturnUrl> {
  try {
    return await provider() as CapabilityWithPinnedReturnUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('HTTP 503')) {
      throw new Error('DocuSign demo rejected the loaded sandbox credentials. The local broker, encrypted intake setup, and real-disk PDF steps completed before this real network boundary.', { cause: error });
    }
    throw error;
  }
}

describe.skipIf(!LIVE_OK)('DocuSign demo sandbox envelope round trip', () => {
  let backend: BackendProcess;

  beforeAll(async () => {
    if (!credentials) throw new Error('DocuSign sandbox credentials disappeared after the live gate was enabled.');
    backend = await bootBackend(credentials);
  }, 60_000);

  afterAll(async () => {
    await backend?.stop();
  }, 30_000);

  beforeEach(() => {
    useIntakeStore.getState().resetForTests();
    localStorage.clear();
    localStorage.setItem('lantern:settings', JSON.stringify({ state: { values: { confidentialityMode: 'direct' } }, version: 1 }));
  });

  it('creates, signs, retrieves, encrypts, and files one demo envelope with a real broker and browser', async () => {
    const user = await provisionSyntheticAdvisor(backend.baseUrl);
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'docusign-sandbox-workspace-'));
    try {
      const workspaceService = new WorkspaceService();
      await workspaceService.initialize(new TempDirectoryFSBackend(), workspaceRoot);
      const completedPdf = await createSyntheticCompletedPdf();
      const sourceHash = await sha256Hex(completedPdf);
      const originalPdfItem = pdfItem('pdf-fill-item', sourceHash);
      const publicChecklist = request([originalPdfItem]);
      const intakeId = `w9-sandbox-${randomUUID()}`;
      const relay = new IntakeRelayClient({ baseUrl: backend.baseUrl, seatToken: user.seatToken, accessToken: user.accessToken });
      const bundle = await createAdvisorIntake({
        intakeId, matterId: publicChecklist.matter_id, intakeHost: 'https://intake.example.test', expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        checklist: publicChecklist, clientFirstName: 'Avery', firm: { name: 'Synthetic Harbor', accent: '#123456', advisor_name: 'Ada', advisor_email: 'ada@example.test', next_steps: [], journey: DEFAULT_WELCOME_JOURNEY }, relay,
      });
      const encryptedChecklist = await openPageJson<FormRequest>(await derivePageKey(b64ToBytes(bundle.linkSecretB64)), bundle.checklistCiphertextB64);
      expect(encryptedChecklist.items).toHaveLength(1);
      const issuedPdfItem = useIntakeStore.getState().intakesById[intakeId]?.requestItems?.find((item): item is PdfFillRequestItem => item.t === 'pdf_fill');
      if (!issuedPdfItem) throw new Error('The real advisor intake did not retain its issued PDF item.');
      const signingPdfItem = { ...originalPdfItem, item_id: issuedPdfItem.item_id };
      const advisorRequest = request([signingPdfItem, signature(signingPdfItem.item_id)]);
      const requestSlug = 'w9-sandbox-request';
      const matterFolderPath = join(workspaceRoot, 'Synthetic Client');
      const sourceFilePath = await fileIntakeDocument({ workspaceService, matterFolderPath, requestSlug, folder: 'pdf_form', fileName: 'wave-8-completed.pdf', bytes: completedPdf });
      const receipt = await receiptFor(completedPdf, signingPdfItem);

      const authorizationProvider = createDocusignAuthorizationProvider({ intakeId, seatToken: user.seatToken, accessToken: user.accessToken, baseUrl: backend.baseUrl, templateId: signingPdfItem.template.templateId });
      const capability = await obtainPinnedCapability(authorizationProvider);
      if (typeof capability.allowedReturnUrl !== 'string' || !capability.allowedReturnUrl) {
        throw new Error('The signing capability did not include the broker-pinned allowedReturnUrl. Integrate the return-URL pinning fix before running this live gate.');
      }
      const adapter = new DirectDocusignAdapter(authorizationProvider);
      const launchRelay = new DocusignLaunchRelayClient({ baseUrl: backend.baseUrl, seatToken: user.seatToken, accessToken: user.accessToken });
      const signerEmail = `signer-${randomUUID()}@example.test`;
      const record = await startDocusignSignature({
        intakeId, sourceFilePath, receipt, workspaceService, request: advisorRequest, signatureItemId: 'signature-item', requestActive: true,
        matterFolderPath, requestSlug, signerName: 'Avery Sandbox', signerEmail, returnUrl: capability.allowedReturnUrl,
        adapter, launchRelay,
        registerEnvelope: (envelopeId) => registerDocusignEnvelope({ intakeId, seatToken: user.seatToken, accessToken: user.accessToken, baseUrl: backend.baseUrl, envelopeId }),
      });
      expect(record.envelopeId).toMatch(/\S/u);

      const launchResponse = await fetch(`${backend.baseUrl}/docusign-signing/${encodeURIComponent(intakeId)}/launch`, { headers: { Authorization: `Bearer ${bundle.tokenB64}` } });
      expect(launchResponse.ok).toBe(true);
      const launchBody = await launchResponse.json() as { launch_ciphertext_b64: string };
      const launch = await openPageJson<{ recipientViewUrl: string }>(await derivePageKey(b64ToBytes(bundle.linkSecretB64)), launchBody.launch_ciphertext_b64);
      expect(launch.recipientViewUrl).toMatch(/^https:\/\/.+\.docusign\.net\//u);

      await expect(adapter.createRecipientView({
        envelopeId: record.envelopeId, signerName: 'Avery Sandbox', signerEmail, clientUserId: 'w9-repeat-view-check', returnUrl: capability.allowedReturnUrl,
      })).rejects.toThrow(/already generated/u);

      await completeRecipientCeremony(launch.recipientViewUrl, capability.allowedReturnUrl);
      await waitForCompleted(adapter, record.envelopeId);
      const filed = await retrieveAndFileDocusignCompletion({
        intakeId, requestId: advisorRequest.request_id, signatureItemId: 'signature-item', matterFolderPath, requestSlug, sourceFilePath, receipt, workspaceService, adapter,
      });
      expect(filed.status).toBe('signed');
      const names = signatureOutputFileNames({ requestId: advisorRequest.request_id, signatureItemId: 'signature-item', envelopeId: record.envelopeId });
      const signedPath = `${matterFolderPath}/Requests/${requestSlug}/signatures/${names.signedPdfFileName}`;
      const certificatePath = `${matterFolderPath}/Requests/${requestSlug}/signatures/${names.certificateFileName}`;
      const [sealedSigned, sealedCertificate, untouchedSource] = await Promise.all([
        workspaceService.readFileBinary(signedPath), workspaceService.readFileBinary(certificatePath), workspaceService.readFileBinary(sourceFilePath),
      ]);
      expect(new Uint8Array(untouchedSource)).toEqual(completedPdf);
      expect(new Uint8Array(sealedSigned)).not.toEqual(completedPdf);
      expect(new Uint8Array(sealedCertificate)).not.toEqual(new Uint8Array());
      if (!filed.outputContentKeyB64) throw new Error('Signed local record did not retain its artifact encryption key.');
      const [signedPlaintext, certificatePlaintext] = await Promise.all([
        decryptSignatureArtifact(filed.outputContentKeyB64, filed, 'signed-pdf', new Uint8Array(sealedSigned)),
        decryptSignatureArtifact(filed.outputContentKeyB64, filed, 'certificate', new Uint8Array(sealedCertificate)),
      ]);
      const directCompletion = await adapter.retrieveCompletion(record.envelopeId);
      expect(signedPlaintext).toEqual(directCompletion.signedPdf);
      expect(certificatePlaintext).toEqual(directCompletion.certificate);

      const wrongRequestId = `${advisorRequest.request_id}-wrong`;
      const wrongOutput = `${matterFolderPath}/Requests/${wrongRequestId}/signatures`;
      await expect(retrieveAndFileDocusignCompletion({
        intakeId, requestId: wrongRequestId, signatureItemId: 'signature-item', matterFolderPath, requestSlug: wrongRequestId, sourceFilePath, receipt, workspaceService, adapter,
      })).rejects.toThrow(/record/u);
      expect(await workspaceService.exists(wrongOutput)).toBe(false);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 300_000);
});

describe.skipIf(LIVE_OK)('DocuSign demo sandbox envelope round trip (skipped)', () => {
  it('requires both DOCUSIGN_LIVE_SANDBOX_OK=1 and the off-repo demo credentials file', () => {
    expect(LIVE_OK).toBe(false);
  });
});
