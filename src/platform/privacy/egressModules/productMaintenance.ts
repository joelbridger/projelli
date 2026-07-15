/**
 * Product-maintenance egress operations — signed app updates, local AI model
 * downloads, and template-marketplace catalog/package downloads.
 */

import { connectorOperation } from './shared';
import type { EgressOperation } from '../egressFollowups/types';

export const productMaintenanceOperations = [
  connectorOperation({
    id: 'app-update-download',
    category: 'product-maintenance',
    title: 'Check for or download an app update',
    approvalText:
      'This contacts GitHub to check for a signed Lantern update or download one you approve.',
    dataSummary: 'App version and update download metadata. No client files.',
    dataClasses: ['metadata', 'binary-download'],
    recipient: 'GitHub Releases',
    requiresFinalApproval: false,
    destination: {
      allowedOrigins: ['github.com', 'release-assets.githubusercontent.com'],
      redirects: 'allow-listed-only',
    },
  }),
  connectorOperation({
    id: 'local-model-download',
    category: 'product-maintenance',
    title: 'Download a local AI model',
    approvalText:
      'This downloads the local AI model you selected. It does not upload client files.',
    dataSummary: 'Model selection and download metadata. No client files.',
    dataClasses: ['metadata', 'binary-download'],
    recipient: 'The model download service shown before download',
    requiresFinalApproval: true,
    destination: {
      userSelectedHost: true,
      rejectPrivateNetwork: true,
      redirects: 'allow-listed-only',
    },
  }),
  connectorOperation({
    id: 'marketplace-catalog-download',
    category: 'product-maintenance',
    title: 'Refresh the template marketplace',
    approvalText:
      'This contacts the Lantern template marketplace to download its catalog.',
    dataSummary: 'Marketplace catalog request metadata. No client files.',
    dataClasses: ['metadata', 'binary-download'],
    recipient: 'The Lantern template marketplace',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['raw.githubusercontent.com'] },
  }),
  connectorOperation({
    id: 'marketplace-package-download',
    category: 'product-maintenance',
    title: 'Download a marketplace template',
    approvalText:
      'This downloads the template package you selected from the Lantern marketplace.',
    dataSummary:
      'The selected template package and download metadata. No client files.',
    dataClasses: ['metadata', 'binary-download'],
    recipient: 'The Lantern template marketplace',
    requiresFinalApproval: true,
    destination: { allowedOrigins: ['raw.githubusercontent.com'] },
  }),
] satisfies readonly EgressOperation[];
