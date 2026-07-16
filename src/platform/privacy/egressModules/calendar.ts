/**
 * Calendar egress operations — provider import today. Wave-4 calendar write
 * operations (create/update events, write-back confirmations) append here.
 */

import { connectorOperation } from './shared';
import type { EgressOperation } from '../egressFollowups/types';

export const calendarOperations = [
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
  // Wave-2 Part B calendar WRITE. Create/update a one-time event on the
  // advisor's own home calendar. Final approval required on every write; exact
  // provider host only; never a wildcard. Never weakens the read operations
  // above — a write is its own operation.
  connectorOperation({
    id: 'calendar-write-microsoft',
    category: 'connector-write',
    title: 'Write to Outlook Calendar',
    approvalText:
      'This creates or updates one event on your own Outlook calendar.',
    dataSummary: 'The event title, time, location, and notes you are booking.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Microsoft Outlook Calendar',
    requiresFinalApproval: true,
    destination: { allowedOrigins: ['graph.microsoft.com'] },
  }),
  connectorOperation({
    id: 'calendar-write-google',
    category: 'connector-write',
    title: 'Write to Google Calendar',
    approvalText:
      'This creates or updates one event on your own Google calendar.',
    dataSummary: 'The event title, time, location, and notes you are booking.',
    dataClasses: ['content', 'metadata', 'credential'],
    recipient: 'Google Calendar',
    requiresFinalApproval: true,
    destination: { allowedOrigins: ['www.googleapis.com'] },
  }),
] satisfies readonly EgressOperation[];
