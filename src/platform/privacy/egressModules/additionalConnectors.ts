/**
 * Additional connector-import egress operations — DocuSign, Jotform, Calendly,
 * Addepar, and Zocks. Each is a single-product import sink.
 */

import { connectorOperation } from './shared';
import type { EgressOperation } from '../egressFollowups/types';

export const additionalConnectorOperations = [
  connectorOperation({
    id: 'docusign-import',
    category: 'connector-import',
    title: 'Import DocuSign envelopes',
    approvalText:
      'This contacts DocuSign and downloads the envelopes and documents you selected.',
    dataSummary:
      'Envelope details, recipients, audit events, and selected document bytes.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'DocuSign',
    requiresFinalApproval: false,
    destination: {
      allowedOrigins: ['account-d.docusign.com', 'www.docusign.net'],
    },
  }),
  connectorOperation({
    id: 'jotform-import',
    category: 'connector-import',
    title: 'Import Jotform submissions',
    approvalText:
      'This contacts Jotform and downloads the forms and submissions you selected.',
    dataSummary: 'Form definitions and selected submission data.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Jotform',
    requiresFinalApproval: false,
    destination: {
      allowedOrigins: ['api.jotform.com'],
      // Jotform accepts a query-string API key today. This contract makes the
      // safer header-only migration explicit, so neither URLs nor proxy logs
      // receive a reusable credential.
      forbidCredentialQuery: true,
    },
  }),
  connectorOperation({
    id: 'calendly-import',
    category: 'connector-import',
    title: 'Import Calendly events',
    approvalText:
      'This contacts Calendly and downloads the scheduling information you selected.',
    dataSummary: 'Scheduled events, invitees, and event details.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Calendly',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['api.calendly.com'] },
  }),
  connectorOperation({
    id: 'addepar-import',
    category: 'connector-import',
    title: 'Import Addepar data',
    approvalText:
      'This contacts Addepar and downloads the accounts and reports you selected.',
    dataSummary: 'Client, account, portfolio, and selected report data.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Addepar',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['api.addepar.com'] },
  }),
  connectorOperation({
    id: 'zocks-import',
    category: 'connector-import',
    title: 'Import Zocks meetings',
    approvalText:
      'This contacts Zocks and downloads the meeting records you selected.',
    dataSummary: 'Meeting records, transcripts, and account metadata.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Zocks',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['api.zocks.io'] },
  }),
] satisfies readonly EgressOperation[];
