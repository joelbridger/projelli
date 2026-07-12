/**
 * Whole-app egress contracts for the P2/P3 follow-up work.
 *
 * These records deliberately describe the network action without retaining
 * private payloads. A caller supplies the final approval and result, then
 * converts the receipt into the app's durable audit format at its own seam.
 */

export type EgressCategory =
  | 'connector-authentication'
  | 'connector-import'
  | 'connector-write'
  | 'outgoing-email'
  | 'assured-inference'
  | 'product-maintenance'
  | 'external-client';

export type EgressDataClass = 'content' | 'metadata' | 'credential' | 'binary-download';

export type EgressConsent = 'approved' | 'declined' | 'not-required';

export type EgressResult = 'completed' | 'failed' | 'blocked' | 'cancelled';

export type EgressRedirectPolicy = 'deny' | 'allow-listed-only';

export interface EgressDestinationPolicy {
  /** URI schemes the operation may use. `imaps`/`smtps` document mail TLS. */
  allowedSchemes: readonly string[];
  /** Exact hostnames, never wildcard suffixes. Empty only for user-picked hosts. */
  allowedOrigins: readonly string[];
  /** Token-bearing calls must not silently follow a new host after a redirect. */
  redirects: EgressRedirectPolicy;
  /** A person chose this host in the UI; it still needs TLS and explicit approval. */
  userSelectedHost?: boolean;
  /** Reject IP-literal/private-network destinations for user-selected HTTP URLs. */
  rejectPrivateNetwork?: boolean;
  /** The network client must also reject a DNS result that resolves privately. */
  requiresResolvedAddressCheck?: boolean;
  /** Prevent API keys and bearer values from leaking into URLs or request logs. */
  forbidCredentialQuery?: boolean;
}

export interface EgressOperation {
  id: string;
  category: EgressCategory;
  title: string;
  /** One sentence shown before the final action. */
  approvalText: string;
  /** Plain words for the receipt and inventory; never interpolates private values. */
  dataSummary: string;
  dataClasses: readonly EgressDataClass[];
  destination: EgressDestinationPolicy;
  /** A send/write is never allowed to be an automatic background action. */
  requiresFinalApproval: boolean;
  /** Human-readable recipient identity, including the external-client case. */
  recipient: string;
}

export interface EgressApproval {
  operationId: string;
  title: string;
  message: string;
  dataSummary: string;
  recipient: string;
  requiresFinalApproval: boolean;
}

export interface EgressReceipt {
  version: 1;
  operationId: string;
  category: EgressCategory;
  recipient: string;
  /** Hostname only; never a URL path, query string, or fragment. */
  destination: string;
  dataClasses: readonly EgressDataClass[];
  consent: EgressConsent;
  result: EgressResult;
  occurredAt: string;
  /** Optional local client reference. Never a client name or remote identifier. */
  clientScope?: 'active-client' | 'all-clients';
  /** The external-client/session warning should include an expiry, never a token. */
  expiresAt?: string;
}

export interface EgressSourceManifestEntry {
  file: string;
  operationId: string;
  receiptTest: boolean;
}

export interface EgressRedTeamFixture {
  kind:
    | 'signed-url'
    | 'oauth-fragment'
    | 'api-key'
    | 'mixed-case-secret-label'
    | 'instruction-text'
    | 'deceptive-link';
  text: string;
  expectedRedaction: boolean;
}
