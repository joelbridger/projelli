import type { ReviewedDocusignTabMap } from '@/platform/intake/docusignSignature/tabMap';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';
import { assertLocalOnlyAllowsExternal } from '@/platform/privacy/localOnlyGuard';

export interface DocusignAuthorization {
  /** Broker-issued, one-use authorization. It remains in this function's stack only. */
  accessToken: string;
  accountId: string;
  baseUri: string;
  expiresAt: string;
}
// TODO(w9-gate): Lane 4 must export the authenticated, one-use broker capability
// acquisition function. This adapter accepts only its in-memory result so no
// document, recipient detail, or matter identifier can ever enter that boundary.
export type DocusignAuthorizationProvider = () => Promise<DocusignAuthorization>;
export interface DocusignEnvelopeInput {
  pdfBytes: Uint8Array;
  signerName: string;
  signerEmail: string;
  requestId: string;
  signatureItemId: string;
  clientUserId: string;
  tabMap: ReviewedDocusignTabMap;
  returnUrl: string;
}
export interface DocusignEnvelopeResult { envelopeId: string; recipientViewUrl: string; }
export interface DocusignRetrievedCompletion { signedPdf: Uint8Array; certificate: Uint8Array; }
/** Envelope states returned by DocuSign's envelope-status endpoint. */
export type DocusignEnvelopeStatus =
  | 'created'
  | 'sent'
  | 'delivered'
  | 'completed'
  | 'declined'
  | 'voided'
  | 'timedout'
  | 'processing'
  | 'deleted'
  | 'corrected';

const DOCUSIGN_ENVELOPE_STATUSES = new Set<DocusignEnvelopeStatus>([
  'created', 'sent', 'delivered', 'completed', 'declined', 'voided', 'timedout', 'processing', 'deleted', 'corrected',
]);

function parseDocusignEnvelopeStatus(value: unknown): DocusignEnvelopeStatus {
  if (typeof value !== 'string' || !DOCUSIGN_ENVELOPE_STATUSES.has(value as DocusignEnvelopeStatus)) {
    throw new Error('DocuSign returned an unsupported envelope status.');
  }
  return value as DocusignEnvelopeStatus;
}

function requireDocusignBaseUri(value: string): string {
  const uri = new URL(value);
  if (uri.protocol !== 'https:' || !/\.docusign\.net$/iu.test(uri.hostname)) throw new Error('DocuSign authorization returned an unsafe API host.');
  return uri.toString().replace(/\/+$/u, '');
}
function base64(bytes: Uint8Array): string { let value = ''; for (let index = 0; index < bytes.length; index += 0x8000) value += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return btoa(value); }
function tab(anchor: ReviewedDocusignTabMap['signatureTab']) { return { pageNumber: String(anchor.page), xPosition: String(Math.round(anchor.rect.x * 100)), yPosition: String(Math.round(anchor.rect.y * 100)), width: String(Math.round(anchor.rect.width * 100)), height: String(Math.round(anchor.rect.height * 100)) }; }

/** Direct desktop-to-DocuSign client. It never calls a Lantern endpoint with document or recipient data. */
export class DirectDocusignAdapter {
  private recipientViewGeneratedFor = new Set<string>();
  constructor(private readonly authorizationProvider: DocusignAuthorizationProvider) {}

  private async withAuthorization<T>(operation: (authorization: DocusignAuthorization, fetchFn: typeof fetch) => Promise<T>): Promise<T> {
    assertLocalOnlyAllowsExternal('Send for DocuSign signature');
    let authorization: DocusignAuthorization | undefined = await this.authorizationProvider();
    try {
      if (Date.parse(authorization.expiresAt) <= Date.now()) throw new Error('DocuSign authorization has expired.');
      authorization = { ...authorization, baseUri: requireDocusignBaseUri(authorization.baseUri) };
      const fetchFn = await getCorsSafeFetch();
      assertLocalOnlyAllowsExternal('Send for DocuSign signature');
      return await operation(authorization, fetchFn);
    } finally {
      // Deliberately erase the short-lived bearer from this adapter after each use.
      authorization = undefined;
    }
  }

  async createEnvelopeAndRecipientView(input: DocusignEnvelopeInput): Promise<DocusignEnvelopeResult> {
    if (!input.signerName.trim() || !input.signerEmail.trim()) throw new Error('Signer name and email are required.');
    return this.withAuthorization(async (authorization, fetchFn) => {
      const baseUri = authorization.baseUri;
      const envelopeResponse = await fetchFn(`${baseUri}/restapi/v2.1/accounts/${encodeURIComponent(authorization.accountId)}/envelopes`, {
        method: 'POST', headers: { Authorization: `Bearer ${authorization.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailSubject: 'Review and sign with DocuSign', status: 'sent', documents: [{ documentBase64: base64(input.pdfBytes), name: 'Completed form', fileExtension: 'pdf', documentId: '1' }], recipients: { signers: [{ name: input.signerName, email: input.signerEmail, recipientId: '1', clientUserId: input.clientUserId, tabs: { signHereTabs: [tab(input.tabMap.signatureTab)], dateSignedTabs: [tab(input.tabMap.dateSignedTab)], fullNameTabs: [tab(input.tabMap.signerNameTab)] } }] } }),
      });
      if (!envelopeResponse.ok) throw new Error(`DocuSign envelope creation failed with HTTP ${String(envelopeResponse.status)}.`);
      const envelope = await envelopeResponse.json() as { envelopeId?: unknown };
      if (typeof envelope.envelopeId !== 'string' || !envelope.envelopeId) throw new Error('DocuSign did not return an envelope id.');
      const viewKey = `${authorization.accountId}:${envelope.envelopeId}`;
      if (this.recipientViewGeneratedFor.has(viewKey)) throw new Error('A recipient view was already generated for this envelope.');
      assertLocalOnlyAllowsExternal('Send for DocuSign signature');
      const viewResponse = await fetchFn(`${baseUri}/restapi/v2.1/accounts/${encodeURIComponent(authorization.accountId)}/envelopes/${encodeURIComponent(envelope.envelopeId)}/views/recipient`, {
        method: 'POST', headers: { Authorization: `Bearer ${authorization.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnUrl: input.returnUrl, authenticationMethod: 'none', email: input.signerEmail, userName: input.signerName, clientUserId: input.clientUserId, recipientId: '1' }),
      });
      if (!viewResponse.ok) throw new Error(`DocuSign recipient view failed with HTTP ${String(viewResponse.status)}.`);
      const view = await viewResponse.json() as { url?: unknown };
      if (typeof view.url !== 'string' || !/^https:\/\/.+\.docusign\.net\//iu.test(view.url)) throw new Error('DocuSign returned an unsafe recipient view URL.');
      this.recipientViewGeneratedFor.add(viewKey);
      return { envelopeId: envelope.envelopeId, recipientViewUrl: view.url };
    });
  }

  async pollEnvelopeStatus(envelopeId: string, attempts = 5, initialDelayMs = 1_000): Promise<DocusignEnvelopeStatus> {
    if (!envelopeId) throw new Error('Envelope id is required.');
    return this.withAuthorization(async (authorization, fetchFn) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const response = await fetchFn(`${authorization.baseUri}/restapi/v2.1/accounts/${encodeURIComponent(authorization.accountId)}/envelopes/${encodeURIComponent(envelopeId)}`, { headers: { Authorization: `Bearer ${authorization.accessToken}` } });
        if (!response.ok) throw new Error(`DocuSign status check failed with HTTP ${String(response.status)}.`);
        const body = await response.json() as { status?: unknown };
        const status = parseDocusignEnvelopeStatus(body.status);
        if (status !== 'sent' && status !== 'delivered') return status;
        if (attempt + 1 < attempts) await new Promise<void>((resolve) => { window.setTimeout(resolve, initialDelayMs * (2 ** attempt)); });
        assertLocalOnlyAllowsExternal('Send for DocuSign signature');
      }
      return 'sent';
    });
  }

  async retrieveCompletion(envelopeId: string): Promise<DocusignRetrievedCompletion> {
    return this.withAuthorization(async (authorization, fetchFn) => {
      const root = `${authorization.baseUri}/restapi/v2.1/accounts/${encodeURIComponent(authorization.accountId)}/envelopes/${encodeURIComponent(envelopeId)}`;
      const [signed, certificate] = await Promise.all([
        fetchFn(`${root}/documents/combined`, { headers: { Authorization: `Bearer ${authorization.accessToken}` } }),
        fetchFn(`${root}/documents/certificate`, { headers: { Authorization: `Bearer ${authorization.accessToken}` } }),
      ]);
      if (!signed.ok || !certificate.ok) throw new Error('DocuSign could not retrieve the signed form and certificate.');
      return { signedPdf: new Uint8Array(await signed.arrayBuffer()), certificate: new Uint8Array(await certificate.arrayBuffer()) };
    });
  }
}
