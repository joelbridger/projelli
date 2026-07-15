/**
 * External-client egress operation — the MCP boundary that lets a named
 * external AI client read a selected client until its session expires.
 */

import { connectorOperation } from './shared';
import type { EgressOperation } from '../egressFollowups/types';

export const externalClientOperations = [
  connectorOperation({
    id: 'mcp-external-client-session',
    category: 'external-client',
    title: 'Allow an external AI client to read this client',
    approvalText:
      'This lets the named external AI client read the selected client’s files until the session expires. That client may have its own network rules.',
    dataSummary:
      'The selected client’s files, search results, and approved tool output.',
    dataClasses: ['content', 'metadata'],
    recipient: 'The named external AI client',
    requiresFinalApproval: true,
    destination: { allowedSchemes: ['mcp'], userSelectedHost: true },
  }),
] satisfies readonly EgressOperation[];
