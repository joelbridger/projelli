import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { assertSafeFlattenedPdf, verifyPdfFillReceipt } from '@/platform/intake/pdfFillReceipt';
import { fileIntakeDocument } from '@/platform/intake/intakeFiling';
import { loadIntakeLinkSecret, loadPdfTemplateDescriptor } from '@/platform/intake/intakeKeychain';
import { derivePageKey } from '@/platform/intake/intakeCrypto';
import { b64ToBytes, sealPageJson } from '@/platform/intake/pageSeal';
import { sha256Hex } from '@/platform/intake/pdfTemplates/receipt';
import type { PdfCompletionReceipt } from '@/platform/intake/pdfTemplates/templateContract';
import { assertSignatureEligible, type SignatureEligibilityInput } from '@/platform/intake/docusignSignature/signatureEligibility';
import { signatureOutputFileNames } from '@/platform/intake/docusignSignature/signatureOutputNaming';
import type { LocalSignatureRecord, SignatureStatus } from '@/platform/intake/docusignSignature/signatureRecord';
import type { SignatureLaunchRecord } from '@/platform/intake/docusignSignature/signatureLaunch';
import { assertLocalOnlyAllowsExternal, LocalOnlyExternalError } from '@/platform/privacy/localOnlyGuard';
import { DirectDocusignAdapter, type DocusignEnvelopeInput } from './docusignAdapter';
import { createDocusignEgressReceipt } from './egressReceipt';
import { DocusignLaunchRelayClient } from './launchRelayClient';
import { loadLocalSignatureRecord, saveLocalSignatureRecord } from './signatureRecordStore';

export interface CompletionSource {
  intakeId: string;
  sourceFilePath: string;
  /** Wave 8 receipt retained locally; its completed hash is rechecked against bytes below. */
  receipt: PdfCompletionReceipt;
  workspaceService: Pick<WorkspaceService, 'readFileBinary' | 'writeFileBinary'>;
}
export interface StartSignatureInput extends CompletionSource {
  request: SignatureEligibilityInput['request'];
  signatureItemId: string;
  requestActive: boolean;
  matterFolderPath: string;
  requestSlug: string;
  signerName: string;
  signerEmail: string;
  returnUrl: string;
  adapter: DirectDocusignAdapter;
  launchRelay: DocusignLaunchRelayClient;
}

function stableClientUserId(requestId: string, signatureItemId: string): string {
  // A local opaque identifier, stable for an embedded recipient but never matter-derived.
  let value = 2166136261;
  for (const character of `${requestId}\u001f${signatureItemId}`) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return `lantern-${(value >>> 0).toString(16).padStart(8, '0')}`;
}
function active(status: SignatureStatus): boolean { return ['envelope_created', 'signing_opened', 'completion_pending'].includes(status); }
function initialRecord(input: StartSignatureInput, source: { sourceItemId: string; templateVersion: number; sourceSha256: string; completedSha256: string }, envelopeId: string): LocalSignatureRecord {
  return { requestId: input.request.request_id, signatureItemId: input.signatureItemId, sourcePdfFillItemId: source.sourceItemId, sourceTemplateVersion: source.templateVersion, sourceTemplateSha256: source.sourceSha256, wave8CompletedSha256: source.completedSha256, envelopeId, status: 'envelope_created', events: [{ eventId: `local-envelope:${envelopeId}`, status: 'envelope_created', source: 'poll', at: new Date().toISOString() }] };
}

/** Recomputes the filed completion hash every time. Store receipt fields are display cache only. */
export async function loadFreshCompletionEvidence(source: CompletionSource, sourceItemId: string): Promise<{ bytes: Uint8Array; templateId: string; templateVersion: number; sourceSha256: string; completedSha256: string; sourceItemId: string }> {
  const descriptor = await loadPdfTemplateDescriptor(source.intakeId, sourceItemId);
  if (!descriptor) throw new Error('The approved PDF template descriptor is unavailable locally.');
  const bytes = new Uint8Array(await source.workspaceService.readFileBinary(source.sourceFilePath));
  await verifyPdfFillReceipt({ completedBytes: bytes, receipt: source.receipt, descriptor, expectedItemId: sourceItemId });
  return { bytes, sourceItemId, templateId: descriptor.templateId, templateVersion: descriptor.version, sourceSha256: descriptor.sourceSha256, completedSha256: await sha256Hex(bytes) };
}

export async function startDocusignSignature(input: StartSignatureInput): Promise<LocalSignatureRecord> {
  const signature = input.request.items.find((item) => item.item_id === input.signatureItemId);
  if (!signature || signature.t !== 'signature' || signature.grade !== 'docusign') throw new Error('No reviewed DocuSign signature item is available.');
  const completion = await loadFreshCompletionEvidence(input, signature.source_pdf_fill_item_id);
  const prior = await loadLocalSignatureRecord(input.intakeId, input.request.request_id, input.signatureItemId);
  assertSignatureEligible({ request: input.request, signatureItemId: input.signatureItemId, currentCompletion: completion, requestActive: input.requestActive, existingActiveSignatureRecord: Boolean(prior && active(prior.record.status)) });
  const host = 'demo.docusign.net';
  try { assertLocalOnlyAllowsExternal('Send for DocuSign signature'); }
  catch (error) {
    if (!(error instanceof LocalOnlyExternalError)) throw error;
    await saveLocalSignatureRecord(input.intakeId, { record: { requestId: input.request.request_id, signatureItemId: input.signatureItemId, sourcePdfFillItemId: completion.sourceItemId, sourceTemplateVersion: completion.templateVersion, sourceTemplateSha256: completion.sourceSha256, wave8CompletedSha256: completion.completedSha256, envelopeId: 'blocked-local-only', status: 'not_ready', events: [] }, egressReceipts: [createDocusignEgressReceipt({ host, requestId: input.request.request_id, signatureItemId: input.signatureItemId, userConfirmed: true, outcome: 'blocked_local_only' })] });
    throw error;
  }
  const receipt = createDocusignEgressReceipt({ host, requestId: input.request.request_id, signatureItemId: input.signatureItemId, userConfirmed: true, outcome: 'allowed' });
  // Durable proof of the advisor's confirmation exists before document bytes leave this device.
  await saveLocalSignatureRecord(input.intakeId, { record: { requestId: input.request.request_id, signatureItemId: input.signatureItemId, sourcePdfFillItemId: completion.sourceItemId, sourceTemplateVersion: completion.templateVersion, sourceTemplateSha256: completion.sourceSha256, wave8CompletedSha256: completion.completedSha256, envelopeId: 'pending-egress', status: 'not_ready', events: [] }, egressReceipts: [receipt] });
  const envelope = await input.adapter.createEnvelopeAndRecipientView({ pdfBytes: completion.bytes, signerName: input.signerName, signerEmail: input.signerEmail, requestId: input.request.request_id, signatureItemId: input.signatureItemId, clientUserId: stableClientUserId(input.request.request_id, input.signatureItemId), tabMap: signature.tab_map, returnUrl: input.returnUrl } satisfies DocusignEnvelopeInput);
  const record = initialRecord(input, completion, envelope.envelopeId);
  await saveLocalSignatureRecord(input.intakeId, { record, egressReceipts: [receipt] });
  const secret = await loadIntakeLinkSecret(input.intakeId);
  if (!secret) throw new Error('The local intake link secret is unavailable for the signing launch.');
  const now = Date.now();
  const launch: SignatureLaunchRecord = { requestId: record.requestId, signatureItemId: record.signatureItemId, recipientViewUrl: envelope.recipientViewUrl, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 60 * 1000).toISOString(), consumed: false };
  const ciphertext = await sealPageJson(await derivePageKey(b64ToBytes(secret)), launch);
  await input.launchRelay.putLaunch(input.intakeId, ciphertext);
  return record;
}

export async function retrieveAndFileDocusignCompletion(input: CompletionSource & { requestId: string; signatureItemId: string; matterFolderPath: string; requestSlug: string; adapter: DirectDocusignAdapter }): Promise<LocalSignatureRecord> {
  const stored = await loadLocalSignatureRecord(input.intakeId, input.requestId, input.signatureItemId);
  if (!stored) throw new Error('No local DocuSign signature record exists.');
  if (stored.record.status === 'signed') return stored.record;
  const status = await input.adapter.pollEnvelopeStatus(stored.record.envelopeId);
  if (status === 'declined' || status === 'voided') {
    const terminalStatus: Extract<SignatureStatus, 'declined' | 'voided'> = status;
    const record = { ...stored.record, status: terminalStatus, events: [...stored.record.events, { eventId: `poll:${stored.record.envelopeId}:${terminalStatus}`, status: terminalStatus, source: 'poll' as const, at: new Date().toISOString() }] };
    await saveLocalSignatureRecord(input.intakeId, { ...stored, record }); return record;
  }
  if (status !== 'completed') {
    const record = { ...stored.record, status: 'completion_pending' as const, events: [...stored.record.events, { eventId: `poll:${stored.record.envelopeId}:${status}`, status: 'completion_pending' as const, source: 'poll' as const, at: new Date().toISOString() }] };
    await saveLocalSignatureRecord(input.intakeId, { ...stored, record }); return record;
  }
  const pending = { ...stored.record, status: 'completion_pending' as const };
  await saveLocalSignatureRecord(input.intakeId, { ...stored, record: pending });
  const result = await input.adapter.retrieveCompletion(stored.record.envelopeId);
  await Promise.all([assertSafeFlattenedPdf(result.signedPdf), assertSafeFlattenedPdf(result.certificate)]);
  const [finalSignedSha256, certificateSha256] = await Promise.all([sha256Hex(result.signedPdf), sha256Hex(result.certificate)]);
  const names = signatureOutputFileNames({ requestId: input.requestId, signatureItemId: input.signatureItemId, envelopeId: stored.record.envelopeId });
  await Promise.all([
    fileIntakeDocument({ workspaceService: input.workspaceService as WorkspaceService, matterFolderPath: input.matterFolderPath, requestSlug: input.requestSlug, folder: 'signature', fileName: names.signedPdfFileName, bytes: result.signedPdf }),
    fileIntakeDocument({ workspaceService: input.workspaceService as WorkspaceService, matterFolderPath: input.matterFolderPath, requestSlug: input.requestSlug, folder: 'signature', fileName: names.certificateFileName, bytes: result.certificate }),
  ]);
  const record: LocalSignatureRecord = { ...pending, status: 'signed', finalSignedSha256, certificateSha256, events: [...pending.events, { eventId: `retrieved:${stored.record.envelopeId}:${finalSignedSha256}`, status: 'signed', source: 'direct_retrieval', at: new Date().toISOString() }] };
  await saveLocalSignatureRecord(input.intakeId, { ...stored, record });
  return record;
}
