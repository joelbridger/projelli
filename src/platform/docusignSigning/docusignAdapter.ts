import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';
import { assertLocalOnlyAllowsExternal } from '@/platform/privacy/localOnlyGuard';

export interface DocusignAuthorization {
  /** A fresh short-lived DocuSign bearer minted for one explicit advisor send action. The adapter only keeps it in memory for one call. */
  accessToken: string;
  accountId: string;
  baseUri: string;
  expiresAt: string;
  /** The broker's pinned, allow-listed return URL; authoritative over caller input. */
  allowedReturnUrl: string;
}
export type DocusignAuthorizationProvider = () => Promise<DocusignAuthorization>;
export interface DocusignTabPosition { page: number; xPosition: number; yPosition: number; width: number; height: number; }
export interface ResolvedDocusignTabMap { signatureTab: DocusignTabPosition; dateSignedTab: DocusignTabPosition; signerNameTab: DocusignTabPosition; }
export interface DocusignEnvelopeInput {
  pdfBytes: Uint8Array;
  signerName: string;
  signerEmail: string;
  requestId: string;
  signatureItemId: string;
  clientUserId: string;
  /** Absolute page points, resolved from the reviewed normalized anchors before this direct API boundary. */
  tabMap: ResolvedDocusignTabMap;
  returnUrl: string;
}
/** Inputs needed to generate one embedded recipient view for an existing envelope. */
export interface DocusignRecipientViewInput {
  envelopeId: string;
  signerName: string;
  signerEmail: string;
  clientUserId: string;
  returnUrl: string;
}
export interface DocusignEnvelopeResult { envelopeId: string; recipientViewUrl: string; }
export interface DocusignRetrievedCompletion { envelopeId: string; signedPdf: Uint8Array; certificate: Uint8Array; }
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
const DOCUSIGN_SIGNER_RECIPIENT_ID = '1';
// This records that Lantern performed no separate recipient authentication.
// It is DocuSign's documented embedded-signing example value, not a delivery setting.
const DOCUSIGN_EMBEDDED_AUTHENTICATION_METHOD = 'none';

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
function tab(position: DocusignTabPosition) { return { pageNumber: String(position.page), xPosition: String(position.xPosition), yPosition: String(position.yPosition), width: String(position.width), height: String(position.height) }; }
function docusignErrorCode(response: Response): Promise<string> {
  // DocuSign can return an empty or non-JSON response. Its short error code is
  // safe to surface and is enough to diagnose a real sandbox failure.
  return response.json()
    .then((body: unknown) => {
      const errorCode = body && typeof body === 'object' ? (body as Record<string, unknown>)['errorCode'] : undefined;
      if (typeof errorCode !== 'string') return '';
      return ` (${errorCode})`;
    })
    // eslint-disable-next-line lantern-async/no-silent-failure -- A non-JSON DocuSign error has no safe error code to surface; the HTTP status remains available.
    .catch(() => '');
}
function recipientViewRequest(input: DocusignRecipientViewInput) {
  // createRecipient identifies an embedded recipient by this exact identity:
  // recipient ID + clientUserId + the original name/email pair.
  return {
    returnUrl: input.returnUrl,
    authenticationMethod: DOCUSIGN_EMBEDDED_AUTHENTICATION_METHOD,
    email: input.signerEmail,
    userName: input.signerName,
    clientUserId: input.clientUserId,
    recipientId: DOCUSIGN_SIGNER_RECIPIENT_ID,
  };
}

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

  private async createRecipientViewWithAuthorization(
    authorization: DocusignAuthorization,
    fetchFn: typeof fetch,
    input: DocusignRecipientViewInput,
  ): Promise<DocusignEnvelopeResult> {
    const viewKey = `${authorization.accountId}:${input.envelopeId}`;
    if (this.recipientViewGeneratedFor.has(viewKey)) throw new Error('A recipient view was already generated for this envelope.');
    assertLocalOnlyAllowsExternal('Send for DocuSign signature');
    const viewResponse = await fetchFn(`${authorization.baseUri}/restapi/v2.1/accounts/${encodeURIComponent(authorization.accountId)}/envelopes/${encodeURIComponent(input.envelopeId)}/views/recipient`, {
      method: 'POST', headers: { Authorization: `Bearer ${authorization.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(recipientViewRequest(input)),
    });
    if (!viewResponse.ok) throw new Error(`DocuSign recipient view failed with HTTP ${String(viewResponse.status)}${await docusignErrorCode(viewResponse)}.`);
    const view = await viewResponse.json() as { url?: unknown };
    if (typeof view.url !== 'string' || !/^https:\/\/.+\.docusign\.net\//iu.test(view.url)) throw new Error('DocuSign returned an unsafe recipient view URL.');
    this.recipientViewGeneratedFor.add(viewKey);
    return { envelopeId: input.envelopeId, recipientViewUrl: view.url };
  }

  /**
   * Generates one recipient view only. Kept public so real integrations can
   * prove the one-time-view guard without creating another envelope.
   */
  async createRecipientView(input: DocusignRecipientViewInput): Promise<DocusignEnvelopeResult> {
    if (!input.envelopeId || !input.signerName.trim() || !input.signerEmail.trim() || !input.clientUserId.trim()) {
      throw new Error('Envelope id, signer name, signer email, and client user id are required.');
    }
    return this.withAuthorization((authorization, fetchFn) => {
      if (input.returnUrl !== authorization.allowedReturnUrl) throw new Error('DocuSign return URL is not the broker-allowed URL.');
      return this.createRecipientViewWithAuthorization(authorization, fetchFn, input);
    });
  }

  async createEnvelopeAndRecipientView(input: DocusignEnvelopeInput): Promise<DocusignEnvelopeResult> {
    if (!input.signerName.trim() || !input.signerEmail.trim()) throw new Error('Signer name and email are required.');
    return this.withAuthorization(async (authorization, fetchFn) => {
      if (input.returnUrl !== authorization.allowedReturnUrl) throw new Error('DocuSign return URL is not the broker-allowed URL.');
      const baseUri = authorization.baseUri;
      const envelopeResponse = await fetchFn(`${baseUri}/restapi/v2.1/accounts/${encodeURIComponent(authorization.accountId)}/envelopes`, {
        method: 'POST', headers: { Authorization: `Bearer ${authorization.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailSubject: 'Review and sign with DocuSign', status: 'sent', documents: [{ documentBase64: base64(input.pdfBytes), name: 'Completed form', fileExtension: 'pdf', documentId: '1' }], recipients: { signers: [{ name: input.signerName, email: input.signerEmail, recipientId: DOCUSIGN_SIGNER_RECIPIENT_ID, clientUserId: input.clientUserId, tabs: { signHereTabs: [tab(input.tabMap.signatureTab)], dateSignedTabs: [tab(input.tabMap.dateSignedTab)], fullNameTabs: [tab(input.tabMap.signerNameTab)] } }] } }),
      });
      if (!envelopeResponse.ok) {
        throw new Error(`DocuSign envelope creation failed with HTTP ${String(envelopeResponse.status)}${await docusignErrorCode(envelopeResponse)}.`);
      }
      const envelope = await envelopeResponse.json() as { envelopeId?: unknown };
      if (typeof envelope.envelopeId !== 'string' || !envelope.envelopeId) throw new Error('DocuSign did not return an envelope id.');
      return this.createRecipientViewWithAuthorization(authorization, fetchFn, {
        envelopeId: envelope.envelopeId,
        signerName: input.signerName,
        signerEmail: input.signerEmail,
        clientUserId: input.clientUserId,
        returnUrl: input.returnUrl,
      });
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
      return { envelopeId, signedPdf: new Uint8Array(await signed.arrayBuffer()), certificate: new Uint8Array(await certificate.arrayBuffer()) };
    });
  }
}
