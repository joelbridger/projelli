/**
 * Mail egress operations — connector sign-in, import, and outgoing send/draft.
 */

import { connectorOperation, IMAPS, SMTPS } from './shared';
import type { EgressOperation } from '../egressFollowups/types';
import { BRAND } from '@/config/brand';

export const mailOperations = [
  connectorOperation({
    id: 'mail-auth-microsoft',
    category: 'connector-authentication',
    title: 'Connect Microsoft 365 mail',
    approvalText:
      `This opens Microsoft sign-in so ${BRAND.name} can connect the mailbox you choose.`,
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
      `This opens Google sign-in so ${BRAND.name} can connect the mailbox you choose.`,
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
] satisfies readonly EgressOperation[];
