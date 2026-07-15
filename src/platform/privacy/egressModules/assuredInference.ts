/**
 * Assured AI egress operation — the zero-retention inference relay path.
 */

import { connectorOperation } from './shared';
import type { EgressOperation } from '../egressFollowups/types';

export const assuredInferenceOperations = [
  connectorOperation({
    id: 'assured-ai',
    category: 'assured-inference',
    title: 'Use Assured AI',
    approvalText:
      'This sends your prompt through Lantern’s zero-retention service before it reaches your firm’s AI provider. Lantern says it does not retain the prompt or answer, but the bytes still pass through that service.',
    dataSummary:
      'The prompt, selected AI context, and the provider request needed to answer.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Lantern’s zero-retention service, then your firm’s AI provider',
    requiresFinalApproval: true,
    destination: { allowedOrigins: ['api.lanternplatform.app'] },
  }),
] satisfies readonly EgressOperation[];
