/**
 * Assured AI egress operation — the zero-retention inference relay path.
 */

import { connectorOperation } from './shared';
import type { EgressOperation } from '../egressFollowups/types';
import { BRAND } from '@/config/brand';

export const assuredInferenceOperations = [
  connectorOperation({
    id: 'assured-ai',
    category: 'assured-inference',
    title: 'Use Assured AI',
    approvalText:
      `This sends your prompt through ${BRAND.possessive} zero-retention service before it reaches your firm’s AI provider. ${BRAND.name} says it does not retain the prompt or answer, but the bytes still pass through that service.`,
    dataSummary:
      'The prompt, selected AI context, and the provider request needed to answer.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: `${BRAND.possessive} zero-retention service, then your firm’s AI provider`,
    requiresFinalApproval: true,
    destination: { allowedOrigins: ['api.lanternplatform.app'] },
  }),
] satisfies readonly EgressOperation[];
