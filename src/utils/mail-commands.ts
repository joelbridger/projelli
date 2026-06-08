// Thin wrappers around the mail Tauri commands defined in
// `src-tauri/src/commands/mail/mod.rs`. Each wrapper guards with isTauri()
// so callers work in browser/test mode without throwing.
//
// Mirror of tauri-commands.ts conventions: import invoke + isTauri from
// @tauri-apps/api/core, guard every call site.

import { invoke, isTauri } from '@tauri-apps/api/core';

export interface DeviceCodePrompt { userCode: string; verificationUri: string; deviceCode: string; intervalSecs: number; expiresInSecs: number; }
export type MailSyncStatus = 'idle' | 'syncing' | 'done' | 'cancelled' | 'error';
export interface MailSyncProgress { status: MailSyncStatus; folder?: string | null; written: number; removed: number; }
export const MAIL_SYNC_EVENT = 'mail-sync-progress';
export const MAIL_INDEX_CHUNK_EVENT = 'mail-index-chunk';
export interface MailIndexChunk { docId: string; subject: string; decryptedText: string; }

export async function mailSetWorkspace(path: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>('mail_set_workspace', { path });
}
export async function mailBeginLogin(): Promise<DeviceCodePrompt> {
  if (!isTauri()) throw new Error('Email connect is only available in the desktop app.');
  return invoke<DeviceCodePrompt>('mail_begin_login');
}
/** Result of one device-code poll. `slow_down` means lengthen the interval. */
export type PollResult = 'authorized' | 'pending' | 'slow_down';
export async function mailPollLogin(deviceCode: string): Promise<PollResult> {
  if (!isTauri()) return 'pending';
  return invoke<PollResult>('mail_poll_login', { deviceCode });
}
export async function mailIsConnected(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('mail_is_connected');
}
export async function mailSyncAll(): Promise<void> {
  if (!isTauri()) throw new Error('Email sync is only available in the desktop app.');
  return invoke<void>('mail_sync_all');
}
export async function mailCancelSync(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>('mail_cancel_sync');
}

// G6: OS full-disk encryption status
export interface FdeStatus {
  status: 'on' | 'off' | 'unknown';
  platform: string;
  detail?: string | null;
}

export async function mailFdeStatus(): Promise<FdeStatus> {
  if (!isTauri()) return { status: 'unknown', platform: 'browser' };
  return invoke<FdeStatus>('mail_fde_status');
}

// IMAP multi-provider support
export interface ImapConnectInput { host: string; port: number; username: string; password: string; }
export async function mailImapConnect(input: ImapConnectInput): Promise<void> {
  if (!isTauri()) throw new Error('Email connect is only available in the desktop app.');
  return invoke<void>('mail_imap_connect', { host: input.host, port: input.port, username: input.username, password: input.password });
}
export async function mailImapIsConnected(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('mail_imap_is_connected');
}
export async function mailImapDisconnect(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>('mail_imap_disconnect');
}

// Gmail native provider (loopback PKCE OAuth)
export async function gmailConnect(): Promise<void> {
  if (!isTauri()) throw new Error('Gmail connect is only available in the desktop app.');
  return invoke<void>('gmail_connect');
}
export async function gmailIsConnected(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('gmail_is_connected');
}
export async function gmailDisconnect(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>('gmail_disconnect');
}
