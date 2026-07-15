/**
 * Whole-app egress catalogue — the single lookup for every off-device sink.
 *
 * The operations themselves live in per-domain slice modules under
 * `./egressModules/`, mounted through an append-only registry
 * (`./egressModules/registry.ts`). This file keeps the stable public surface:
 * the id→operation map and the approval / receipt / destination / inventory
 * helpers that the network client and connectors call. It contains no payloads
 * and makes no network request itself.
 *
 * The carve into slices does not change the operation surface. `EGRESS_OPERATIONS`
 * below is byte-identical (same ids, scopes, and strictness) to the pre-carve
 * catalogue; `egressModules/egressParity.test.ts` proves it and fails on any
 * added, removed, or loosened operation.
 */

import {
  collectEgressOperations,
  validateEgressModuleRegistry,
} from './egressModules/registry';
import { createApproval } from './egressFollowups/approval';
import { formatInventoryMarkdown } from './egressFollowups/inventory';
import {
  createReceipt,
  type BuildEgressReceiptInput,
} from './egressFollowups/receipt';
import { EGRESS_RED_TEAM_FIXTURES } from './egressFollowups/redTeamFixtures';
import { validateSourceManifest } from './egressFollowups/sourceManifest';
import type {
  EgressApproval,
  EgressOperation,
  EgressReceipt,
  EgressSourceManifestEntry,
} from './egressFollowups/types';

export { EGRESS_RED_TEAM_FIXTURES };
export type {
  EgressApproval,
  EgressCategory,
  EgressDataClass,
  EgressDestinationPolicy,
  EgressOperation,
  EgressReceipt,
  EgressRedTeamFixture,
  EgressResult,
  EgressSourceManifestEntry,
} from './egressFollowups/types';

// Fail closed at load: a structurally malformed registry (a duplicate id, a
// missing required field, an empty scheme/origin rule) must never build a
// silent, half-formed catalogue. The parity + validation tests also cover this;
// this guard makes the same rule hold in any environment that imports the map.
const registryProblems = validateEgressModuleRegistry();
if (registryProblems.length > 0) {
  throw new Error(
    `Malformed egress module registry:\n${registryProblems.join('\n')}`
  );
}

const operations = collectEgressOperations();

export const EGRESS_OPERATIONS: ReadonlyMap<string, EgressOperation> = new Map(
  operations.map((operation) => [operation.id, operation])
);

export function getEgressOperation(
  operationId: string
): EgressOperation | undefined {
  return EGRESS_OPERATIONS.get(operationId);
}

export function createEgressApproval(operationId: string): EgressApproval {
  const operation = getEgressOperation(operationId);
  if (!operation) throw new Error(`Unknown egress operation: ${operationId}`);
  return createApproval(operation);
}

export function buildEgressReceipt(
  input: Omit<BuildEgressReceiptInput, 'operation'> & { operationId: string }
): EgressReceipt {
  const operation = getEgressOperation(input.operationId);
  if (!operation)
    throw new Error(`Unknown egress operation: ${input.operationId}`);
  return createReceipt({ ...input, operation });
}

export function validateEgressSourceManifest(
  entries: readonly EgressSourceManifestEntry[]
): string[] {
  return validateSourceManifest(entries, new Set(EGRESS_OPERATIONS.keys()));
}

export function formatEgressInventoryMarkdown(): string {
  return formatInventoryMarkdown([...EGRESS_OPERATIONS.values()]);
}

export type DestinationValidation =
  | { ok: true }
  | { ok: false; reason: string };

function isPrivateOrIpLiteral(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '::') return true;
  // IPv6 loopback, link-local, unique-local, and IPv4-mapped addresses.
  if (/^(?:fe[89ab]|f[cd]|::ffff:)/.test(host)) return true;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;

  const octets = host.split('.').map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const [first, second] = octets;
  if (first === undefined || second === undefined) return true;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

/**
 * Check the final destination before a token-bearing request starts. Redirect
 * handling belongs at the HTTP client: `deny` means any redirect is an error;
 * `allow-listed-only` must re-run this check for each redirect target.
 */
export function validateEgressDestination(
  operationId: string,
  rawDestination: string
): DestinationValidation {
  const operation = getEgressOperation(operationId);
  if (!operation)
    return { ok: false, reason: `Unknown egress operation: ${operationId}` };

  let url: URL;
  try {
    url = new URL(rawDestination);
  } catch {
    return { ok: false, reason: 'Destination is not a valid absolute URL' };
  }

  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (!operation.destination.allowedSchemes.includes(scheme)) {
    return {
      ok: false,
      reason: `Scheme ${scheme} is not allowed for ${operationId}`,
    };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      reason: 'Destination must not include URL credentials',
    };
  }
  if (operation.destination.forbidCredentialQuery) {
    const credentialQuery = [...url.searchParams.keys()].some((key) =>
      /(?:api[_-]?key|access[_-]?token|bearer|token|password|secret)/i.test(key)
    );
    if (credentialQuery) {
      return {
        ok: false,
        reason: 'Credentials must not be placed in the URL query string',
      };
    }
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (operation.destination.userSelectedHost) {
    if (!hostname) return { ok: false, reason: 'A host is required' };
    if (
      operation.destination.rejectPrivateNetwork &&
      isPrivateOrIpLiteral(hostname)
    ) {
      return {
        ok: false,
        reason: 'Private-network and IP-literal destinations are not allowed',
      };
    }
    return { ok: true };
  }
  if (!operation.destination.allowedOrigins.includes(hostname)) {
    return {
      ok: false,
      reason: `Host ${hostname} is not allowed for ${operationId}`,
    };
  }
  return { ok: true };
}
