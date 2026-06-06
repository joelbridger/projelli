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
export async function mailPollLogin(deviceCode: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('mail_poll_login', { deviceCode });
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
