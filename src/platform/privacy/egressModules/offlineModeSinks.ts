/**
 * Legacy Offline Mode sinks — the previously registered set, expressed in the
 * whole-app egress contract format.
 *
 * These are kept together as one cohort (matching how they were originally
 * registered) rather than re-sorted into product domains: they predate the
 * per-domain seam. New Wave-4 domain operations (calendar writes, booking
 * confirmations, reminders) belong in a product-domain slice, not here.
 */

import { connectorOperation, HTTP_OR_HTTPS } from './shared';
import type { EgressOperation } from '../egressFollowups/types';

export const offlineModeSinks = [
  connectorOperation({
    id: 'local-loopback',
    category: 'local-ai',
    title: 'Use a local AI server',
    approvalText:
      'This sends the selected AI request to the local AI server running on this device.',
    dataSummary: 'The prompt and selected AI context stay on this device.',
    dataClasses: ['content'],
    recipient: 'The local AI server on this device',
    requiresFinalApproval: false,
    destination: {
      allowedSchemes: HTTP_OR_HTTPS,
      allowedOrigins: ['127.0.0.1', '::1'],
    },
  }),
  connectorOperation({
    id: 'cloud-ai',
    category: 'cloud-ai',
    title: 'Use cloud AI',
    approvalText:
      'This sends the selected AI request to the AI provider you configured.',
    dataSummary:
      'The prompt, selected AI context, and provider credential needed to answer.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'The AI provider you configured',
    requiresFinalApproval: false,
    destination: {
      allowedOrigins: [
        'api.anthropic.com',
        'api.openai.com',
        'generativelanguage.googleapis.com',
      ],
    },
  }),
  connectorOperation({
    id: 'license-api',
    category: 'licensing',
    title: 'Activate or validate a license',
    approvalText:
      'This contacts Lantern’s licensing service to activate or validate your license.',
    dataSummary: 'License and device-validation metadata.',
    dataClasses: ['metadata', 'credential'],
    recipient: 'Lantern licensing',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['licenses.lanternplatform.app'] },
  }),
  connectorOperation({
    id: 'firm-seat-validation',
    category: 'licensing',
    title: 'Validate a firm seat',
    approvalText: 'This contacts Lantern’s firm service to validate this seat.',
    dataSummary: 'Firm-seat validation metadata and credential.',
    dataClasses: ['metadata', 'credential'],
    recipient: 'Lantern firm seat validation',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['api.lanternplatform.app'] },
  }),
  connectorOperation({
    id: 'updater-github-releases',
    category: 'product-maintenance',
    title: 'Check for app updates',
    approvalText:
      'This contacts GitHub to check for or download a signed Lantern update.',
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
    id: 'marketplace-manifest',
    category: 'product-maintenance',
    title: 'Refresh the template marketplace catalog',
    approvalText:
      'This contacts the configured marketplace catalog source to download its catalog.',
    dataSummary: 'Marketplace catalog request metadata. No client files.',
    dataClasses: ['metadata', 'binary-download'],
    recipient: 'The Lantern template marketplace',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['raw.githubusercontent.com'] },
  }),
  connectorOperation({
    id: 'marketplace-package',
    category: 'product-maintenance',
    title: 'Download a marketplace package',
    approvalText: 'This downloads the marketplace package you selected.',
    dataSummary: 'The selected package and download metadata. No client files.',
    dataClasses: ['content', 'metadata'],
    recipient: 'The Lantern template marketplace',
    requiresFinalApproval: true,
    destination: { allowedOrigins: ['raw.githubusercontent.com'] },
  }),
  connectorOperation({
    id: 'telemetry',
    category: 'telemetry',
    title: 'Send optional telemetry',
    approvalText: 'This sends the optional telemetry you enabled to Lantern.',
    dataSummary: 'Optional app-use metadata. No client files.',
    dataClasses: ['metadata'],
    recipient: 'Lantern telemetry',
    requiresFinalApproval: true,
    destination: { allowedOrigins: ['forms.lanternplatform.app'] },
  }),
  connectorOperation({
    id: 'diagnostics',
    category: 'diagnostics',
    title: 'Send optional diagnostics',
    approvalText:
      'This sends the optional diagnostic information you enabled to Lantern.',
    dataSummary: 'Optional app diagnostic metadata. No client files.',
    dataClasses: ['metadata'],
    recipient: 'Lantern diagnostics',
    requiresFinalApproval: true,
    destination: { allowedOrigins: ['forms.lanternplatform.app'] },
  }),
  connectorOperation({
    id: 'external-navigation',
    category: 'navigation',
    title: 'Open an external link',
    approvalText:
      'This opens the external address you selected in your browser.',
    dataSummary: 'The external address you selected.',
    dataClasses: ['metadata'],
    recipient: 'The website you selected',
    requiresFinalApproval: true,
    destination: { userSelectedHost: true, rejectPrivateNetwork: true },
  }),
  connectorOperation({
    id: 'bug-report',
    category: 'diagnostics',
    title: 'Send a bug report',
    approvalText:
      'This sends the bug report and the details you chose to include to Lantern.',
    dataSummary: 'The bug-report text and selected diagnostic information.',
    dataClasses: ['content', 'metadata'],
    recipient: 'Lantern support',
    requiresFinalApproval: true,
    destination: { allowedOrigins: ['forms.lanternplatform.app'] },
  }),
  connectorOperation({
    id: 'ai-setup-help',
    category: 'diagnostics',
    title: 'Ask for AI setup help',
    approvalText:
      'This sends the AI setup help request and the details you chose to include to Lantern.',
    dataSummary: 'The help request and selected diagnostic information.',
    dataClasses: ['content', 'metadata'],
    recipient: 'Lantern support',
    requiresFinalApproval: true,
    destination: { allowedOrigins: ['forms.lanternplatform.app'] },
  }),
  connectorOperation({
    id: 'intake-relay',
    category: 'intake-sync',
    title: 'Use the encrypted client intake relay',
    approvalText:
      'This contacts Lantern’s encrypted client intake relay to create or receive encrypted intake data.',
    dataSummary:
      'Encrypted intake content, relay metadata, and the credential needed to authenticate the device.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Lantern encrypted client intake relay',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['api.lanternplatform.app'] },
  }),
] satisfies readonly EgressOperation[];
