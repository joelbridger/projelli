/**
 * CRM connector egress operations — Wealthbox, Salesforce, Redtail, and the
 * sample migration importer (sign-in, import, and Wealthbox write-back).
 */

import { connectorOperation, HTTP_OR_HTTPS } from './shared';
import type { EgressOperation } from '../egressFollowups/types';
import { BRAND } from '@/config/brand';

export const crmOperations = [
  connectorOperation({
    id: 'crm-auth-wealthbox',
    category: 'connector-authentication',
    title: 'Connect Wealthbox',
    approvalText: 'This contacts Wealthbox to check the API token you entered.',
    dataSummary: 'Your Wealthbox API token and basic account metadata.',
    dataClasses: ['metadata', 'credential'],
    recipient: 'Wealthbox',
    requiresFinalApproval: true,
    destination: { allowedOrigins: ['api.crmworkspace.com'] },
  }),
  connectorOperation({
    id: 'crm-sync-wealthbox',
    category: 'connector-import',
    title: 'Import Wealthbox',
    approvalText:
      'This contacts Wealthbox and downloads the client records you selected.',
    dataSummary: 'Client records, notes, tasks, events, and account metadata.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Wealthbox',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['api.crmworkspace.com'] },
  }),
  connectorOperation({
    id: 'crm-write-wealthbox',
    category: 'connector-write',
    title: 'Write back to Wealthbox',
    approvalText:
      'This sends only the approved note, task, or field update to the selected Wealthbox client record.',
    dataSummary:
      'The approved write and the chosen Wealthbox record reference.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Wealthbox',
    requiresFinalApproval: true,
    destination: { allowedOrigins: ['api.crmworkspace.com'] },
  }),
  connectorOperation({
    id: 'crm-auth-salesforce',
    category: 'connector-authentication',
    title: 'Connect Salesforce',
    approvalText: 'This contacts Salesforce to exchange the sign-in code for a saved connection or refresh that connection.',
    dataSummary: 'The sign-in or refresh credential, app connection details, and connection metadata returned by Salesforce.',
    dataClasses: ['metadata', 'credential'],
    recipient: 'Salesforce',
    requiresFinalApproval: true,
    destination: { allowedOrigins: ['login.salesforce.com'] },
  }),
  connectorOperation({
    id: 'crm-auth-salesforce-instance',
    category: 'connector-authentication',
    title: 'Check the connected Salesforce account',
    approvalText: 'This contacts the Salesforce organization returned by sign-in to check the connected account.',
    dataSummary: 'The saved Salesforce access credential and the account identity returned by your Salesforce organization.',
    dataClasses: ['metadata', 'credential'],
    recipient: 'Your Salesforce organization',
    requiresFinalApproval: false,
    destination: { userSelectedHost: true, rejectPrivateNetwork: true },
  }),
  connectorOperation({
    id: 'crm-auth-salesforce-identity',
    category: 'connector-authentication',
    title: 'Read the connected Salesforce identity',
    approvalText: 'This checks the Salesforce identity returned by sign-in.',
    dataSummary: 'The saved Salesforce access credential and the account identity returned by Salesforce.',
    dataClasses: ['metadata', 'credential'],
    recipient: 'Salesforce',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['login.salesforce.com', 'test.salesforce.com'] },
  }),
  connectorOperation({
    id: 'crm-sync-salesforce',
    category: 'connector-import',
    title: 'Import Salesforce',
    approvalText:
      'This contacts the Salesforce organization you connected and downloads the records you selected.',
    dataSummary: 'Selected CRM records and connection metadata.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Your Salesforce organization',
    requiresFinalApproval: false,
    destination: { userSelectedHost: true, rejectPrivateNetwork: true },
  }),
  connectorOperation({
    id: 'crm-auth-redtail',
    category: 'connector-authentication',
    title: 'Connect Redtail CRM',
    approvalText: 'This contacts Redtail to exchange the login for a saved UserKey.',
    dataSummary: `Your Redtail username and password, ${BRAND.possessive} Redtail API credential, the saved UserKey, and basic account metadata.`,
    dataClasses: ['metadata', 'credential'],
    recipient: 'Redtail CRM',
    requiresFinalApproval: true,
    destination: { allowedOrigins: ['api2.redtailtechnology.com'] },
  }),
  connectorOperation({
    id: 'crm-sync-redtail',
    category: 'connector-import',
    title: 'Import Redtail CRM',
    approvalText:
      'This contacts Redtail CRM and downloads the records you selected.',
    dataSummary: 'Selected CRM records and connection metadata.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Redtail CRM',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['api2.redtailtechnology.com'] },
  }),
  connectorOperation({
    id: 'crm-migration-import',
    category: 'connector-import',
    title: 'Import a CRM sample migration',
    approvalText: 'This contacts the simulator address you entered and imports its prepared sample records.',
    dataSummary: 'Prepared sample CRM records and a fabricated test token.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'The simulator address you entered',
    requiresFinalApproval: true,
    destination: {
      allowedSchemes: HTTP_OR_HTTPS,
      userSelectedHost: true,
      rejectPrivateNetwork: false,
    },
  }),
] satisfies readonly EgressOperation[];
