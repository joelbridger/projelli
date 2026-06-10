// Thin wrappers around the mail Tauri commands defined in
// `src-tauri/src/commands/mail/mod.rs`. Each wrapper guards with isTauri()
// so callers work in browser/test mode without throwing.
//
// Mirror of tauri-commands.ts conventions: import invoke + isTauri from
// @tauri-apps/api/core, guard every call site.

import { invoke, isTauri } from '@tauri-apps/api/core';
import type { MailMatterMapEntry } from '@/modules/memory/matterResolver';

export interface DeviceCodePrompt { userCode: string; verificationUri: string; deviceCode: string; intervalSecs: number; expiresInSecs: number; }

/** One attachment, name only (v1 mail lists names; opening is a follow-up). */
export interface MailAttachmentRef { name: string; }

/** A decrypted, structured email message for the read-only viewer. Mirror of
 *  the Rust `MailView` returned by `mail_get_message`. */
export interface MailView {
  id: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: string | null;
  provider: string | null;
  body: string;
  hasAttachments: boolean;
  attachments: MailAttachmentRef[];
}
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
/** Run a full mail sync. `matterMap` (from the matter store) scopes each mail
 *  folder to a matter at index time; omit it (or pass an empty array) to leave
 *  mail unassigned. */
export async function mailSyncAll(matterMap: MailMatterMapEntry[] = []): Promise<void> {
  if (!isTauri()) throw new Error('Email sync is only available in the desktop app.');
  // The Rust command expects camelCase `folderId` / `matterId` on each entry,
  // which matches MailMatterMapEntry, so we can pass it straight through.
  return invoke<void>('mail_sync_all', { matterMap });
}
export async function mailCancelSync(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>('mail_cancel_sync');
}

/** Option B healing: re-index mail that was imported while the embedding model
 *  was still downloading. No-ops fast (one marker read, returns 0) when no
 *  backfill is needed, so it is safe to call on every boot / model-ready
 *  transition. `matterMap` scopes each backfilled message exactly as a sync
 *  would have. Returns the number of messages re-indexed. */
export async function mailBackfillRag(matterMap: MailMatterMapEntry[] = []): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>('mail_backfill_rag', { matterMap });
}

/** Fetch + decrypt ONE stored message for the read-only viewer. `id` may be the
 *  raw message id or a `mail:<id>` citation source id. */
export async function mailGetMessage(id: string): Promise<MailView> {
  if (!isTauri()) throw new Error('Email viewer is only available in the desktop app.');
  return invoke<MailView>('mail_get_message', { id });
}

/** Re-tag every message in a (provider, account, folder) to a matter in place.
 *  Empty `folderId` re-tags every folder in the account. Returns the count of
 *  messages re-tagged. No-op outside Tauri. */
export async function mailRetagFolderMatter(
  provider: string,
  account: string,
  folderId: string,
  matterId: string,
): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>('mail_retag_folder_matter', { provider, account, folderId, matterId });
}

/** A connected mail account offered for matter mapping. Mirror of the Rust
 *  `ConnectedAccount`. */
export interface ConnectedAccount { provider: string; account: string; label: string; }

/** List the mail accounts currently connected, for the matter-mapping UI. */
export async function mailConnectedAccounts(): Promise<ConnectedAccount[]> {
  if (!isTauri()) return [];
  return invoke<ConnectedAccount[]>('mail_connected_accounts');
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
