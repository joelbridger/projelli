import { invoke, isTauri } from '@tauri-apps/api/core';

export interface WealthboxConnectResult {
  connected: boolean;
  accountName?: string | null;
}

export interface WealthboxContactSummary {
  id: string;
  name: string;
  type: 'person' | 'household' | string;
}

export interface WealthboxSyncMapping {
  wealthboxContactId: string;
  matterId: string;
}

export interface WealthboxSyncSummary {
  wealthboxContactId: string;
  matterId: string;
  contactsIndexed: number;
  notesIndexed: number;
  tasksIndexed: number;
  eventsIndexed: number;
  chunksIndexed: number;
  modelNotReady: boolean;
  error?: string | null;
}

export async function wealthboxConnect(token: string): Promise<WealthboxConnectResult> {
  if (!isTauri()) throw new Error('Wealthbox connect is only available in the desktop app.');
  return invoke<WealthboxConnectResult>('wealthbox_connect', { token });
}

export async function wealthboxIsConnected(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('wealthbox_is_connected');
}

export async function wealthboxDisconnect(): Promise<void> {
  if (!isTauri()) return;
  await invoke('wealthbox_disconnect');
}

export async function wealthboxListContacts(): Promise<WealthboxContactSummary[]> {
  if (!isTauri()) return [];
  return invoke<WealthboxContactSummary[]>('wealthbox_list_contacts');
}

export async function wealthboxSync(
  mappings: WealthboxSyncMapping[],
): Promise<WealthboxSyncSummary[]> {
  if (!isTauri()) throw new Error('Wealthbox sync is only available in the desktop app.');
  return invoke<WealthboxSyncSummary[]>('wealthbox_sync', { mappings });
}
