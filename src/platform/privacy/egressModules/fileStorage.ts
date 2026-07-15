/**
 * File-storage connector egress operations — OneDrive/SharePoint, Box, and
 * ShareFile import.
 */

import { connectorOperation } from './shared';
import type { EgressOperation } from '../egressFollowups/types';

export const fileStorageOperations = [
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
] satisfies readonly EgressOperation[];
