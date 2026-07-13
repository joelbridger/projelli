/**
 * Whole-app egress catalogue — P2/P3 follow-up contract.
 *
 * This is intentionally separate from the offline-mode lane's registry. It
 * names the user-facing approval, receipt, and destination checks required by
 * the connector, mail, maintenance, and external-client follow-up work. It
 * contains no payloads and makes no network request itself.
 */

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

const HTTPS = ['https'] as const;
const HTTP_OR_HTTPS = ['http', 'https'] as const;
const IMAPS = ['imaps'] as const;
const SMTPS = ['smtps'] as const;

function connectorOperation(
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

// These are the previously registered Offline Mode sinks, expressed in the
// whole-app contract format. Keep them here rather than maintaining a second
// registry, so one lookup can both block unregistered traffic and describe it
// honestly to the person using Lantern.
const offlineModeOperations = [
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

const operations = [
  ...offlineModeOperations,
  connectorOperation({
    id: 'mail-auth-microsoft',
    category: 'connector-authentication',
    title: 'Connect Microsoft 365 mail',
    approvalText:
      'This opens Microsoft sign-in so Lantern can connect the mailbox you choose.',
    dataSummary: 'Microsoft sign-in details and the permission you approve.',
    dataClasses: ['metadata', 'credential'],
    recipient: 'Microsoft',
    requiresFinalApproval: true,
    destination: { allowedOrigins: ['login.microsoftonline.com'] },
  }),
  connectorOperation({
    id: 'mail-auth-google',
    category: 'connector-authentication',
    title: 'Connect Gmail',
    approvalText:
      'This opens Google sign-in so Lantern can connect the mailbox you choose.',
    dataSummary: 'Google sign-in details and the permission you approve.',
    dataClasses: ['metadata', 'credential'],
    recipient: 'Google',
    requiresFinalApproval: true,
    destination: { allowedOrigins: ['accounts.google.com'] },
  }),
  connectorOperation({
    id: 'mail-sync-microsoft',
    category: 'connector-import',
    title: 'Import Microsoft 365 mail',
    approvalText:
      'This contacts Microsoft 365 and downloads the mail and attachments you selected.',
    dataSummary: 'Mail messages, headers, attachments, and mailbox metadata.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Microsoft 365',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['graph.microsoft.com'] },
  }),
  connectorOperation({
    id: 'mail-sync-gmail',
    category: 'connector-import',
    title: 'Import Gmail',
    approvalText:
      'This contacts Gmail and downloads the mail and attachments you selected.',
    dataSummary: 'Mail messages, headers, attachments, and mailbox metadata.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Gmail',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['gmail.googleapis.com'] },
  }),
  connectorOperation({
    id: 'mail-sync-imap',
    category: 'connector-import',
    title: 'Import IMAP mail',
    approvalText:
      'This contacts the secure IMAP server you chose and downloads mail from that account.',
    dataSummary:
      'Mail messages, headers, and mailbox metadata from the selected account.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'The IMAP server you selected',
    requiresFinalApproval: true,
    destination: {
      allowedSchemes: IMAPS,
      userSelectedHost: true,
      rejectPrivateNetwork: true,
    },
  }),
  connectorOperation({
    id: 'mail-send',
    category: 'outgoing-email',
    title: 'Send email',
    approvalText:
      'Sending contacts the selected mail service with the recipients, subject, message, and attachments shown above.',
    dataSummary:
      'Recipient addresses, subject, message body, and selected attachments.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'The selected mail service and the recipients you approve',
    requiresFinalApproval: true,
    destination: {
      allowedOrigins: ['graph.microsoft.com', 'gmail.googleapis.com'],
    },
  }),
  connectorOperation({
    id: 'mail-send-imap',
    category: 'outgoing-email',
    title: 'Send email through IMAP mail',
    approvalText:
      'Sending contacts the secure mail server you chose with the recipients, subject, message, and attachments shown above.',
    dataSummary:
      'Recipient addresses, subject, message body, and selected attachments.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'The SMTP server and recipients you approve',
    requiresFinalApproval: true,
    destination: {
      allowedSchemes: SMTPS,
      userSelectedHost: true,
      rejectPrivateNetwork: true,
    },
  }),
  connectorOperation({
    id: 'mail-save-draft',
    category: 'outgoing-email',
    title: 'Save email draft',
    approvalText:
      'This saves the draft shown above to the mailbox you selected. It does not send the email.',
    dataSummary: 'Draft recipients, subject, and message body.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'The selected mail service',
    requiresFinalApproval: true,
    destination: {
      allowedOrigins: ['graph.microsoft.com', 'gmail.googleapis.com'],
    },
  }),
  connectorOperation({
    id: 'calendar-sync-microsoft',
    category: 'connector-import',
    title: 'Import Outlook calendar',
    approvalText:
      'This contacts Outlook Calendar and downloads the events you selected.',
    dataSummary: 'Event titles, times, invitees, meeting links, and notes.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Microsoft Outlook Calendar',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['graph.microsoft.com'] },
  }),
  connectorOperation({
    id: 'calendar-sync-google',
    category: 'connector-import',
    title: 'Import Google Calendar',
    approvalText:
      'This contacts Google Calendar and downloads the events you selected.',
    dataSummary: 'Event titles, times, invitees, meeting links, and notes.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Google Calendar',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['www.googleapis.com'] },
  }),
  connectorOperation({
    id: 'calendar-import-ics',
    category: 'connector-import',
    title: 'Import an ICS calendar link',
    approvalText:
      'This contacts the calendar link you pasted and downloads its event feed.',
    dataSummary: 'The pasted calendar address and the events it returns.',
    dataClasses: ['content', 'metadata'],
    recipient: 'The calendar host in the link you pasted',
    requiresFinalApproval: true,
    destination: { userSelectedHost: true, rejectPrivateNetwork: true },
  }),
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
    dataSummary: 'Your Redtail username and password, Lantern’s Redtail API credential, the saved UserKey, and basic account metadata.',
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
  connectorOperation({
    id: 'files-sync-onedrive',
    category: 'connector-import',
    title: 'Import OneDrive or SharePoint files',
    approvalText:
      'This contacts Microsoft and downloads the files and folders you selected.',
    dataSummary: 'File names, folder metadata, and selected document bytes.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Microsoft OneDrive or SharePoint',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['graph.microsoft.com'] },
  }),
  connectorOperation({
    id: 'files-sync-box',
    category: 'connector-import',
    title: 'Import Box files',
    approvalText:
      'This contacts Box and downloads the files and folders you selected.',
    dataSummary: 'File names, folder metadata, and selected document bytes.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Box',
    requiresFinalApproval: false,
    destination: { allowedOrigins: ['api.box.com'] },
  }),
  connectorOperation({
    id: 'files-sync-sharefile',
    category: 'connector-import',
    title: 'Import ShareFile files',
    approvalText:
      'This contacts the ShareFile account you connected and downloads the selected files.',
    dataSummary: 'File names, folder metadata, and selected document bytes.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Your ShareFile account',
    requiresFinalApproval: false,
    destination: { userSelectedHost: true, rejectPrivateNetwork: true },
  }),
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
