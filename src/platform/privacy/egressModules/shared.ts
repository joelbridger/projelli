/**
 * Shared construction helper for every egress operation slice.
 *
 * This is the ONE place the destination-policy defaults live. Every per-domain
 * slice builds its operations through `connectorOperation`, so a slice cannot
 * accidentally weaken a default (deny redirects, empty origin allowlist, HTTPS
 * only) simply by omitting a field. Splitting the catalogue into slices never
 * changes these defaults — that is what the parity test proves.
 */

import type { EgressOperation } from '../egressFollowups/types';

export const HTTPS = ['https'] as const;
export const HTTP_OR_HTTPS = ['http', 'https'] as const;
export const IMAPS = ['imaps'] as const;
export const SMTPS = ['smtps'] as const;

export function connectorOperation(
  operation: Omit<EgressOperation, 'destination'> & {
    destination: Partial<EgressOperation['destination']>;
  }
): EgressOperation {
  const destination = {
    allowedSchemes: HTTPS,
    allowedOrigins: [],
    redirects: 'deny' as const,
    ...operation.destination,
  };
  return {
    ...operation,
    destination: {
      ...destination,
      ...(destination.userSelectedHost && destination.rejectPrivateNetwork
        ? { requiresResolvedAddressCheck: true }
        : {}),
    },
  };
}
