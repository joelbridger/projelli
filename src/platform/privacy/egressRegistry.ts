/**
 * Checked descriptions of the network actions Lantern may perform.
 *
 * Keep these field names in step with Rust's `EgressOperation`. Later offline
 * mode lanes add the full inventory here; this small initial set exists only
 * to prove the renderer boundary without claiming that old call sites have
 * already migrated.
 *
 * Intake relay traffic uses the shared `intake-relay` entry below. Offline Mode
 * stops this device from contacting that relay; it does not revoke a link that
 * was already sent to a client.
 */

export type EgressHostClass =
  | 'literal-loopback'
  | 'cloud-ai'
  | 'service'
  /** A person chose the destination at the interaction boundary (for example,
   * opening a link in their browser). Offline Mode still blocks it; a static
   * host allow-list would make ordinary external navigation unusable. */
  | 'user-configured-host';

export interface EgressOperation {
  id: string;
  category: string;
  allowedHostClass: EgressHostClass;
  allowedHosts: readonly string[];
  transfersContent: boolean;
  transfersMetadata: boolean;
  transfersCredential: boolean;
  receiptLabel: string;
}

const initialOperations = [
  {
    id: 'local-loopback',
    category: 'local-ai',
    allowedHostClass: 'literal-loopback',
    allowedHosts: ['127.0.0.1', '::1'],
    transfersContent: true,
    transfersMetadata: false,
    transfersCredential: false,
    receiptLabel: 'local AI',
  },
  {
    id: 'cloud-ai',
    category: 'cloud-ai',
    allowedHostClass: 'cloud-ai',
    allowedHosts: [
      'api.anthropic.com',
      'api.openai.com',
      'generativelanguage.googleapis.com',
    ],
    transfersContent: true,
    transfersMetadata: true,
    transfersCredential: true,
    receiptLabel: 'cloud AI',
  },
  {
    // Firm Assured requests carry provider-native content through Lantern's
    // zero-retention inference proxy, rather than directly to a vendor host.
    id: 'assured-ai',
    category: 'cloud-ai',
    allowedHostClass: 'cloud-ai',
    allowedHosts: ['api.lanternplatform.app'],
    transfersContent: true,
    transfersMetadata: true,
    transfersCredential: true,
    receiptLabel: 'assured cloud AI',
  },
  {
    id: 'license-api',
    category: 'licensing',
    allowedHostClass: 'service',
    allowedHosts: ['licenses.lanternplatform.app'],
    transfersContent: false,
    transfersMetadata: true,
    transfersCredential: true,
    receiptLabel: 'license activation or validation',
  },
  {
    id: 'firm-seat-validation',
    category: 'licensing',
    allowedHostClass: 'service',
    allowedHosts: ['api.lanternplatform.app'],
    transfersContent: false,
    transfersMetadata: true,
    transfersCredential: true,
    receiptLabel: 'firm seat validation',
  },
  {
    id: 'updater-github-releases',
    category: 'product-maintenance',
    allowedHostClass: 'service',
    // GitHub release downloads redirect to this asset host.
    allowedHosts: ['github.com', 'release-assets.githubusercontent.com'],
    transfersContent: false,
    transfersMetadata: true,
    transfersCredential: false,
    receiptLabel: 'app updates',
  },
  {
    id: 'marketplace-manifest',
    category: 'product-maintenance',
    allowedHostClass: 'service',
    allowedHosts: ['raw.githubusercontent.com'],
    transfersContent: false,
    transfersMetadata: true,
    transfersCredential: false,
    // The configured catalog source currently appears unreachable/misconfigured
    // upstream; keep this host aligned with the configured URL for follow-up.
    receiptLabel: 'the marketplace catalog',
  },
  {
    id: 'marketplace-package',
    category: 'product-maintenance',
    allowedHostClass: 'service',
    allowedHosts: ['raw.githubusercontent.com'],
    transfersContent: true,
    transfersMetadata: true,
    transfersCredential: false,
    receiptLabel: 'a marketplace download',
  },
  {
    id: 'telemetry',
    category: 'telemetry',
    allowedHostClass: 'service',
    allowedHosts: ['forms.lanternplatform.app'],
    transfersContent: false,
    transfersMetadata: true,
    transfersCredential: false,
    receiptLabel: 'optional telemetry',
  },
  {
    id: 'diagnostics',
    category: 'diagnostics',
    allowedHostClass: 'service',
    allowedHosts: ['forms.lanternplatform.app'],
    transfersContent: false,
    transfersMetadata: true,
    transfersCredential: false,
    receiptLabel: 'optional diagnostics',
  },
  {
    id: 'external-navigation',
    category: 'navigation',
    allowedHostClass: 'user-configured-host',
    allowedHosts: [],
    transfersContent: false,
    transfersMetadata: true,
    transfersCredential: false,
    receiptLabel: 'external navigation',
  },
  {
    id: 'bug-report',
    category: 'diagnostics',
    allowedHostClass: 'service',
    allowedHosts: ['forms.lanternplatform.app'],
    transfersContent: true,
    transfersMetadata: true,
    transfersCredential: false,
    receiptLabel: 'bug report',
  },
  {
    id: 'ai-setup-help',
    category: 'diagnostics',
    allowedHostClass: 'service',
    allowedHosts: ['forms.lanternplatform.app'],
    transfersContent: true,
    transfersMetadata: true,
    transfersCredential: false,
    receiptLabel: 'AI setup help request',
  },
  {
    // The advisor desktop app creates and manages encrypted intake links, then
    // receives ciphertext from the firm relay. The public phone page is a
    // separate client and intentionally does not use this desktop policy path.
    id: 'intake-relay',
    category: 'intake-sync',
    allowedHostClass: 'service',
    allowedHosts: ['api.lanternplatform.app'],
    transfersContent: true,
    transfersMetadata: true,
    transfersCredential: true,
    receiptLabel: 'the encrypted client intake relay',
  },
] as const satisfies readonly EgressOperation[];

/**
 * The registry deliberately starts small. Add new sinks here before routing
 * them through networkClient; an unregistered id is always denied.
 */
export const EGRESS_OPERATIONS: ReadonlyMap<string, EgressOperation> = new Map(
  initialOperations.map((operation) => [operation.id, operation])
);

export function getEgressOperation(
  operationId: string
): EgressOperation | undefined {
  return EGRESS_OPERATIONS.get(operationId);
}
