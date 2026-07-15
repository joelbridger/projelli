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
] satisfies readonly EgressOperation[];
