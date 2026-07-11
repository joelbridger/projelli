import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import type { AuditEntry } from '@/platform/types/audit';
import type { EgressOperation } from '@/platform/privacy/egressRegistry';

export type NetworkEgressResult =
  | 'allowed'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked-before-network';

export type NetworkEgressDirection =
  | 'send'
  | 'receive'
  | 'sync'
  | 'authentication'
  | 'download'
  | 'external-client-export'
  | 'navigation';

export interface NetworkEgressReceipt {
  version: 1;
  policyGeneration: number;
  operationId: string;
  operationLabel: string;
  destinationClass: string;
  /** Host only. User-configured navigation can have no destination at receipt creation. */
  destination: string | null;
  direction: NetworkEgressDirection;
  dataClasses: {
    content: boolean;
    metadata: boolean;
    credential: boolean;
    binaryDownload: boolean;
  };
  aiMode: 'local-only' | 'direct' | 'assured';
  offlineMode: boolean;
  result: NetworkEgressResult;
  failureCode?: string;
  consentReference?: string;
  matter_id?: string;
}

type AuditEmitter = (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
let emitter: AuditEmitter | null = null;

export function setNetworkEgressReceiptEmitter(next: AuditEmitter | null): void {
  emitter = next;
}

function directionFor(operation: EgressOperation): NetworkEgressDirection {
  if (operation.category === 'local-ai' || operation.category === 'cloud-ai') return 'send';
  if (operation.category === 'licensing') return 'authentication';
  if (operation.category === 'product-maintenance') return 'download';
  if (operation.category === 'navigation') return 'navigation';
  if (operation.category === 'external-client-export') return 'external-client-export';
  return 'sync';
}

function safeFailureCode(error: unknown): string | undefined {
  if (!error) return undefined;
  if (error instanceof DOMException && error.name === 'AbortError') return 'ABORTED';
  if (error instanceof Error && error.name === 'OfflineModeBlockedError') {
    return 'OFFLINE_MODE_BLOCKED';
  }
  if (error instanceof Error && error.name === 'EgressDestinationNotAllowedError') {
    return 'DESTINATION_NOT_ALLOWED';
  }
  return 'NETWORK_REQUEST_FAILED';
}

export function buildNetworkEgressReceipt(
  operation: EgressOperation,
  destination: URL | null | undefined,
  policyGeneration: number,
  offlineMode: boolean,
  result: NetworkEgressResult,
  error?: unknown,
): NetworkEgressReceipt {
  const failureCode = safeFailureCode(error);
  return {
    version: 1,
    policyGeneration,
    operationId: operation.id,
    operationLabel: operation.receiptLabel,
    destinationClass: operation.allowedHostClass,
    // A user-configured navigation normally supplies its actual destination.
    // Keep the synthetic/no-destination case honest too: never stringify an
    // absent host into the misleading literal "undefined".
    destination: destination?.hostname ? destination.hostname.toLowerCase() : null,
    direction: directionFor(operation),
    dataClasses: {
      content: operation.transfersContent,
      metadata: operation.transfersMetadata,
      credential: operation.transfersCredential,
      binaryDownload: operation.category === 'product-maintenance',
    },
    aiMode: getConfidentialityMode(),
    offlineMode,
    result,
    ...(failureCode ? { failureCode } : {}),
  };
}

/** Emits only operation metadata. Request content, raw URLs, and responses never enter this row. */
export function recordNetworkEgressReceipt(receipt: NetworkEgressReceipt): void {
  emitter?.({
    action: 'network_egress',
    model: undefined,
    description:
      receipt.result === 'blocked-before-network'
        ? `Network action blocked before connection: ${receipt.operationLabel}`
        : `Network action ${receipt.result}: ${receipt.operationLabel} contacted ${receipt.destination ?? 'an unknown destination'}`,
    inputs: {},
    outputs: {},
    userDecision: 'auto',
    metadata: receipt as unknown as Record<string, unknown>,
  });
}
