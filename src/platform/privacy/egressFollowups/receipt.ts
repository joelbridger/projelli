import type {
  EgressConsent,
  EgressOperation,
  EgressReceipt,
  EgressResult,
} from './types';

export interface BuildEgressReceiptInput {
  operation: EgressOperation;
  destination: string;
  consent: EgressConsent;
  result: EgressResult;
  occurredAt: string;
  clientScope?: 'active-client' | 'all-clients';
  expiresAt?: string;
  /** App name only, used for the scoped MCP/external-client session. */
  recipientIdentity?: string;
}

function receiptHostname(rawDestination: string): string {
  try {
    const hostname = new URL(rawDestination).hostname.toLowerCase();
    if (hostname) return hostname;
  // eslint-disable-next-line lantern-async/no-silent-failure -- Bare hostnames are valid receipt input, so URL parsing deliberately falls through to hostname validation.
  } catch {
    // A few non-HTTP clients hand us a hostname rather than a full URL.
  }
  const hostname = rawDestination.trim().toLowerCase();
  if (/^[a-z0-9.-]+$/.test(hostname)) return hostname;
  throw new Error('Egress receipts require a hostname or absolute URL');
}

/**
 * Build a durable, content-free receipt. Callers must never add URL paths,
 * bodies, recipients, credentials, or remote ids to this object.
 */
export function createReceipt(input: BuildEgressReceiptInput): EgressReceipt {
  const { operation } = input;
  if (input.recipientIdentity && operation.category !== 'external-client') {
    throw new Error('Only external-client sessions may replace the receipt recipient');
  }
  return {
    version: 1,
    operationId: operation.id,
    category: operation.category,
    recipient: input.recipientIdentity?.trim() || operation.recipient,
    destination: receiptHostname(input.destination),
    dataClasses: operation.dataClasses,
    consent: input.consent,
    result: input.result,
    occurredAt: input.occurredAt,
    ...(input.clientScope ? { clientScope: input.clientScope } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  };
}
