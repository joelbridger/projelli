/**
 * Checked descriptions of the network actions Lantern may perform.
 *
 * Keep these field names in step with Rust's `EgressOperation`. Later offline
 * mode lanes add the full inventory here; this small initial set exists only
 * to prove the renderer boundary without claiming that old call sites have
 * already migrated.
 */

export type EgressHostClass = 'literal-loopback' | 'cloud-ai' | 'service';

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
    allowedHosts: ['github.com'],
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
