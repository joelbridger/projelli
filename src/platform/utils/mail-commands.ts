// Thin wrappers around the mail Tauri commands defined in
// `src-tauri/src/commands/mail/mod.rs`. Each wrapper guards with isTauri()
// so callers work in browser/test mode without throwing.
//
// Mirror of tauri-commands.ts conventions: import invoke + isTauri from
// @tauri-apps/api/core, guard every call site.

import { invoke, isTauri } from '@tauri-apps/api/core';
import type { MailMatterMapEntry } from '@/platform/rag/matterResolver';
import {
  holdPendingMailRagRetagSources,
  markPendingMailRagRetagLoading,
  setPendingMailRagRetagSources,
} from '@/platform/rag/pendingMailRagRetagHold';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';

/**
 * True when a mail connect/sync error is the EXPECTED "this needs the desktop
 * app" limitation (the wrappers below throw "... only available in the desktop
 * app." in browser mode). The UI uses this to show a calm info note instead of
 * a red "Something went wrong" alarm (UX-22).
 */
export function isDesktopOnlyMailError(
  message: string | null | undefined
): boolean {
  return !!message && /desktop app/i.test(message);
}

export interface DeviceCodePrompt {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  intervalSecs: number;
  expiresInSecs: number;
}

export type MailAuthVerdict = 'pass' | 'fail' | 'none';
export type MailAuthSource = 'graph' | 'gmail' | 'imap' | 'missing';

export interface MailAuthResult {
  dkim: MailAuthVerdict;
  spf: MailAuthVerdict;
  dmarc: MailAuthVerdict;
  aligned: boolean;
  source: MailAuthSource;
}

export type MailAttachmentKind = 'file' | 'inline' | 'unsupported';

/** One attachment reference. `id` is a stable provider-specific id used to
 *  fetch bytes on demand via `mailGetAttachment`. */
export interface MailAttachmentRef {
  id: string;
  /** Existing viewer label. Same value as `filename` for new Rust refs. */
  name: string;
  /** Provider display filename. Never trusted as a path. */
  filename: string;
  contentType?: string | null;
  byteSize?: number | null;
  kind: MailAttachmentKind;
}

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
  /** Provider account identifier (e.g. "default" or "user@example.com"). */
  account: string | null;
  threadId: string | null;
  authResult: MailAuthResult;
  body: string;
  hasAttachments: boolean;
  attachmentsUnsupported: boolean;
  attachments: MailAttachmentRef[];
  /** BUG-013: the matter this message is currently filed under, looked up from
   *  the RAG store by `mail_get_message`. `null`/absent when not filed to any
   *  matter yet (or not indexed). The viewer uses it to show the filed state. */
  matterId?: string | null;
}
export type MailSyncStatus =
  | 'idle'
  | 'syncing'
  | 'done'
  | 'cancelled'
  | 'error';
/** A sync-progress update for ONE provider. `provider` ("m365" | "imap" |
 *  "gmail") tags which account the update belongs to so each connector panel
 *  reacts only to its own status/count (the two panels are rendered together). */
export interface MailSyncProgress {
  status: MailSyncStatus;
  provider: string;
  folder?: string | null;
  written: number;
  removed: number;
  /** Present only on a terminal `error` update: the raw failure message, for the
   *  owner's own screen. Never persisted to the audit log as-is — only a
   *  sanitized category is stored (see `sanitizeSyncError`). */
  error?: string | null;
  /** True on a terminal `done` update when some imported messages are queued for
   *  the RAG backfill (not yet searchable — e.g. the embedding model is still
   *  downloading). Recall is deferred to the next-launch backfill, never lost. */
  backfillPending?: boolean;
  /** True on a terminal `done` update (Microsoft 365) when a refresh-token
   *  rotation failed to save this run. The sync succeeded; this is a heads-up
   *  that the user may need to reconnect on a later launch. */
  tokenWarning?: boolean;
}
export const MAIL_SYNC_EVENT = 'mail-sync-progress';
export const MAIL_INDEX_CHUNK_EVENT = 'mail-index-chunk';

/**
 * One chunk of decrypted email text emitted during a mail sync, used to build
 * the in-memory full-text search index (MiniSearch).
 *
 * TRUST BOUNDARY — decrypted text to renderer via Tauri event:
 *   The Rust sync worker decrypts each stored message and emits this event over
 *   the Tauri event bus (same-process IPC, NOT a network hop). `decryptedText`
 *   lives only in renderer-process memory inside the MiniSearch instance; it is
 *   never written to disk in plaintext and never forwarded to any server. The
 *   App.tsx handler (`handleMailChunk`) passes it directly to `contentIndex.upsert`
 *   — no further transmission occurs. If this path is ever changed to send
 *   `decryptedText` over a network connection, a full security review is required.
 */
export interface MailIndexChunk {
  docId: string;
  subject: string;
  decryptedText: string;
}

export async function mailSetWorkspace(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('mail_set_workspace', { path });
}
export async function mailBeginLogin(): Promise<DeviceCodePrompt> {
  if (!isTauri())
    throw new Error('Email connect is only available in the desktop app.');
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
/** Run a mail sync. `matterMap` (from the matter store) scopes each mail folder
 *  to a matter at index time; omit it (or pass an empty array) to leave mail
 *  unassigned. `onlyProvider` ("m365" | "imap" | "gmail") restricts the sync to a
 *  single provider — a connector panel passes its own provider so connecting one
 *  account never runs (or fails on) another account's credentials. Omit it to
 *  refresh every connected provider. */
export async function mailSyncAll(
  matterMap: MailMatterMapEntry[] = [],
  onlyProvider?: string
): Promise<void> {
  if (!isTauri())
    throw new Error('Email sync is only available in the desktop app.');
  // The Rust command expects camelCase `folderId` / `matterId` on each entry,
  // which matches MailMatterMapEntry, so we can pass it straight through.
  await invoke('mail_sync_all', {
    matterMap,
    onlyProvider: onlyProvider ?? null,
  });
}
export async function mailCancelSync(): Promise<void> {
  if (!isTauri()) return;
  await invoke('mail_cancel_sync');
}

/** Option B healing: re-index mail that was imported while the embedding model
 *  was still downloading. No-ops fast (one marker read, returns 0) when no
 *  backfill is needed, so it is safe to call on every boot / model-ready
 *  transition. `matterMap` scopes each backfilled message exactly as a sync
 *  would have. Returns the number of messages re-indexed. */
export async function mailBackfillRag(
  matterMap: MailMatterMapEntry[] = []
): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>('mail_backfill_rag', { matterMap });
}

/**
 * Fetch + decrypt ONE stored message for the read-only viewer. `id` may be the
 * raw message id or a `mail:<id>` citation source id.
 *
 * TRUST BOUNDARY — decrypted body to renderer:
 *   The `mail_get_message` Rust command reads the encrypted SQLCipher blob for
 *   the requested message, decrypts it entirely in the Tauri/Rust process, and
 *   returns the result as a structured `MailView` over the Tauri IPC bridge
 *   (same-process inter-thread communication, NOT a network hop). The decrypted
 *   body lives only in renderer-process memory for the duration of the viewer's
 *   lifetime; it is never written back to disk in plaintext and never sent to
 *   any Lantern server or AI inference endpoint. The `EmailViewer` component
 *   renders `message.body` as React text content (never `dangerouslySetInnerHTML`)
 *   and runs `stripResidualTags()` as a second defensive layer.
 *
 *   If this function is ever refactored to transmit the body over a real network
 *   hop (e.g. a WebSocket, a proxy, or a cloud relay), STOP and perform a full
 *   security review before shipping — that would break the local-first privacy
 *   guarantee and the firm-tier E2EE contract.
 */
export async function mailGetMessage(id: string): Promise<MailView> {
  if (!isTauri())
    throw new Error('Email viewer is only available in the desktop app.');
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
  /** QA-44 (R7-5b): the workspace root the caller captured when scheduling. The
   *  backend refuses if the workspace has since switched, so a scheduled op can't
   *  re-tag a different workspace's mail. Omit for a live user filing. */
  expectedWorkspace?: string
): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>('mail_retag_folder_matter', {
    provider,
    account,
    folderId,
    matterId,
    expectedWorkspace,
  });
}

/** A connected mail account offered for matter mapping. Mirror of the Rust
 *  `ConnectedAccount`. */
export interface ConnectedAccount {
  provider: string;
  account: string;
  label: string;
}

/** List the mail accounts currently connected, for the matter-mapping UI. */
export async function mailConnectedAccounts(): Promise<ConnectedAccount[]> {
  if (mailFixtureEnabled()) {
    return [
      { provider: 'm365', account: 'default', label: 'Outlook (demo)' },
      { provider: 'gmail', account: 'default', label: 'Gmail (demo)' },
      {
        provider: 'imap',
        account: 'firm@firm.com',
        label: 'firm@firm.com (demo)',
      },
    ];
  }
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
export interface ImapConnectInput {
  host: string;
  port: number;
  username: string;
  password: string;
}
export async function mailImapConnect(input: ImapConnectInput): Promise<void> {
  if (!isTauri())
    throw new Error('Email connect is only available in the desktop app.');
  await invoke('mail_imap_connect', {
    host: input.host,
    port: input.port,
    username: input.username,
    password: input.password,
  });
}
export async function mailImapIsConnected(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('mail_imap_is_connected');
}
export async function mailImapDisconnect(): Promise<void> {
  if (!isTauri()) return;
  await invoke('mail_imap_disconnect');
}

// ---------------------------------------------------------------------------
// Mail browse / search surface
// ---------------------------------------------------------------------------

/** Query parameters for browsing + keyword-searching stored email metadata.
 *  Mirror of the Rust `MailListQuery` (camelCase). */
export interface MailListQuery {
  keyword?: string;
  folderId?: string;
  provider?: string;
  account?: string;
  /** ISO 8601 lower bound (inclusive) on receivedDateTime. */
  dateFrom?: string;
  /** ISO 8601 upper bound (inclusive) on receivedDateTime. */
  dateTo?: string;
  hasAttachments?: boolean;
  /** "date" | "subject" | "from" — default: "date" */
  sortBy: string;
  /** true = descending (newest/Z first) */
  sortDesc: boolean;
  limit: number;
  offset: number;
}

/** One row in a mail list response. No blob is ever decrypted — metadata only. */
export interface MailListItem {
  id: string;
  subject: string;
  fromAddr: string;
  fromName: string;
  snippet: string;
  receivedDateTime: string | null;
  provider: string;
  account: string;
  folderId: string;
  hasAttachments: boolean;
}

/** Paginated result returned by `mailListMessages`. */
export interface MailListPage {
  items: MailListItem[];
  /** Total matching rows (ignoring limit/offset) for pagination UI. */
  total: number;
}

/** True when the dev fixture flag (?mailFixture=1) is present in a DEV build.
 *  Lets the email surfaces render populated without a real mailbox, including
 *  in the desktop parity drive. Production builds never take this path. */
function mailFixtureEnabled(): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('mailFixture') === '1'
  );
}

// Dev fixture data — exercisable in browser dev server when ?mailFixture=1.
// Realistic financial-advisor inbox: client reviews, custodian notices,
// beneficiary updates, RMD reminders, and a CRM integration note. No law-era
// content (Lantern's audience is RIAs and wealth managers, not litigators).
const DEV_FIXTURES: MailListItem[] = [
  {
    id: 'fix-1',
    subject: 'Re: Annual review meeting',
    fromAddr: 'marcus.webb@gmail.com',
    fromName: 'Marcus Webb',
    snippet:
      "Thursday at 2pm works for us. We want to talk through the 401(k) rollover and Caleb's 529.",
    receivedDateTime: '2026-06-12T14:30:00Z',
    provider: 'm365',
    account: 'default',
    folderId: 'inbox',
    hasAttachments: false,
  },
  {
    id: 'fix-2',
    subject: 'Q2 statement ready - Webb household',
    fromAddr: 'no-reply@schwab.com',
    fromName: 'Schwab Advisor Services',
    snippet:
      'The Q2 2026 statement for account ending 4471 is now available to download.',
    receivedDateTime: '2026-06-11T09:15:00Z',
    provider: 'm365',
    account: 'default',
    folderId: 'inbox',
    hasAttachments: true,
  },
  {
    id: 'fix-3',
    subject: 'Beneficiary form - signed and returned',
    fromAddr: 'tanya.webb@outlook.com',
    fromName: 'Tanya Webb',
    snippet:
      'Signed beneficiary designation attached. We updated the contingent beneficiaries to the kids 50/50.',
    receivedDateTime: '2026-06-10T16:00:00Z',
    provider: 'gmail',
    account: 'default',
    folderId: 'INBOX',
    hasAttachments: true,
  },
  {
    id: 'fix-4',
    subject: 'RMD reminder - Patel IRA',
    fromAddr: 'notifications@fidelity.com',
    fromName: 'Fidelity Institutional',
    snippet:
      'A required minimum distribution of $18,420 is due by December 31 for this traditional IRA.',
    receivedDateTime: '2026-06-09T11:45:00Z',
    provider: 'm365',
    account: 'default',
    folderId: 'inbox',
    hasAttachments: true,
  },
  {
    id: 'fix-5',
    subject: 'Wealthbox integration update',
    fromAddr: 'support@wealthbox.com',
    fromName: 'Wealthbox Support',
    snippet:
      'Your API key has been rotated. Please update your integration settings to keep contacts syncing.',
    receivedDateTime: '2026-06-08T08:00:00Z',
    provider: 'm365',
    account: 'default',
    folderId: 'inbox',
    hasAttachments: false,
  },
  {
    id: 'fix-6',
    subject: 'FW: Signed advisory agreement',
    fromAddr: 'jane.ellison@gmail.com',
    fromName: 'Jane Ellison',
    snippet:
      'Forwarding the signed advisory agreement for your records. Original attached.',
    receivedDateTime: '2026-06-07T13:20:00Z',
    provider: 'imap',
    account: 'firm@firm.com',
    folderId: 'INBOX',
    hasAttachments: true,
  },
  {
    id: 'fix-7',
    subject: 'Roth conversion question',
    fromAddr: 'david.nakamura@gmail.com',
    fromName: 'David Nakamura',
    snippet:
      'Before year-end I want to revisit the Roth conversion we discussed. How much room is left in the 24% bracket?',
    receivedDateTime: '2026-06-06T17:00:00Z',
    provider: 'm365',
    account: 'default',
    folderId: 'sent',
    hasAttachments: false,
  },
  {
    id: 'fix-8',
    subject: 'Tax documents deadline',
    fromAddr: 'jhollings@cpafirm.com',
    fromName: 'Janet Hollings, CPA',
    snippet:
      'Reminder: I need the 1099 and realized-gains report by October 15 to finish the Voss return.',
    receivedDateTime: '2026-06-05T09:00:00Z',
    provider: 'm365',
    account: 'default',
    folderId: 'inbox',
    hasAttachments: false,
  },
];

/** Apply query filters + sort to a fixture array (for dev fixture mode). */
function applyQueryToFixtures(
  fixtures: MailListItem[],
  q: MailListQuery
): MailListPage {
  const filtered = fixtures.filter((item) => {
    if (q.keyword) {
      const kw = q.keyword.toLowerCase();
      const hit =
        item.subject.toLowerCase().includes(kw) ||
        item.fromAddr.toLowerCase().includes(kw) ||
        item.fromName.toLowerCase().includes(kw);
      if (!hit) return false;
    }
    if (q.folderId && item.folderId !== q.folderId) return false;
    if (q.provider && item.provider !== q.provider) return false;
    if (q.account && item.account !== q.account) return false;
    if (
      q.dateFrom &&
      item.receivedDateTime &&
      item.receivedDateTime < q.dateFrom
    )
      return false;
    // Treat dateTo as end-of-day inclusive: append T23:59:59.999Z if it's a date-only string.
    if (q.dateTo && item.receivedDateTime) {
      const upperBound = q.dateTo.includes('T')
        ? q.dateTo
        : `${q.dateTo}T23:59:59.999Z`;
      if (item.receivedDateTime > upperBound) return false;
    }
    if (
      q.hasAttachments !== undefined &&
      item.hasAttachments !== q.hasAttachments
    )
      return false;
    return true;
  });

  // Sort
  const dir = q.sortDesc ? -1 : 1;
  filtered.sort((a, b) => {
    let av = '',
      bv = '';
    if (q.sortBy === 'subject') {
      av = a.subject;
      bv = b.subject;
    } else if (q.sortBy === 'from') {
      av = a.fromName;
      bv = b.fromName;
    } else {
      av = a.receivedDateTime ?? '';
      bv = b.receivedDateTime ?? '';
    }
    return av < bv ? -dir : av > bv ? dir : 0;
  });

  const total = filtered.length;
  const items = filtered.slice(q.offset, q.offset + q.limit);
  return { items, total };
}

/** Browse / keyword-search stored email metadata without decrypting blobs.
 *  Returns an empty page outside Tauri (or when `?mailFixture=1` in dev). */
export async function mailListMessages(
  query: MailListQuery
): Promise<MailListPage> {
  // Dev fixture path: exercisable in browser dev server without Tauri.
  if (mailFixtureEnabled()) {
    return applyQueryToFixtures(DEV_FIXTURES, query);
  }
  if (!isTauri()) return { items: [], total: 0 };
  return invoke<MailListPage>('mail_list_messages', { query });
}

/**
 * Per-client browse: like `mailListMessages`, but the backend enforces per-client
 * isolation in the ENGINE — it resolves the exact set of messages that belong to
 * `matterId` (each message's durable filing taken over its folder→matter mapping,
 * via the SAME resolver sync/backfill use) and applies the query only to that set.
 * The embedded per-client Email tab uses this so it can never surface another
 * client's mail and its pagination totals are honest.
 *
 * `matterMap` is the folder→matter mapping from the matter store
 * (`buildMailMatterMap`). Returns an empty page outside Tauri; in dev fixture mode
 * it falls back to the unscoped fixture query (fixtures carry no matter mapping).
 */
export async function mailListMessagesByMatter(
  matterId: string,
  matterMap: MailMatterMapEntry[],
  query: MailListQuery
): Promise<MailListPage> {
  if (mailFixtureEnabled()) {
    return applyQueryToFixtures(DEV_FIXTURES, query);
  }
  if (!isTauri()) return { items: [], total: 0 };
  return invoke<MailListPage>('mail_list_messages_by_matter', {
    matterId,
    matterMap,
    query,
  });
}

// Microsoft 365 loopback OAuth (one-click flow, mirrors gmail_connect)
export async function outlookConnect(): Promise<void> {
  if (!isTauri())
    throw new Error(
      'Microsoft 365 connect is only available in the desktop app.'
    );
  await invoke('outlook_connect');
}

/** Abort a pending outlookConnect() sign-in immediately (user clicked Cancel,
 *  or closed the Microsoft popup and gave up) instead of leaving it to hit the
 *  5-minute server-side timeout. No-op outside Tauri. Never touches an
 *  already-working connection. */
export async function outlookConnectCancel(): Promise<void> {
  if (!isTauri()) return;
  await invoke('outlook_connect_cancel');
}

// Disconnect the Microsoft 365 account (delete its refresh token from the
// keychain). Mirrors gmailDisconnect; the BUG-008 follow-up so a stale M365
// sign-in can be removed, not only re-authenticated.
export async function mailDisconnect(): Promise<void> {
  if (!isTauri()) return;
  await invoke('mail_disconnect');
}

// Gmail native provider (loopback PKCE OAuth)
export async function gmailConnect(): Promise<void> {
  if (!isTauri())
    throw new Error('Gmail connect is only available in the desktop app.');
  await invoke('gmail_connect');
}

/** Abort a pending gmailConnect() sign-in immediately (user clicked Cancel,
 *  or closed the Google tab and gave up) instead of leaving it to hit the
 *  5-minute server-side timeout. No-op outside Tauri. Never touches an
 *  already-working connection. */
export async function gmailConnectCancel(): Promise<void> {
  if (!isTauri()) return;
  await invoke('gmail_connect_cancel');
}

/** True when this build has real Google OAuth client credentials baked in.
 *  A build missing them (e.g. a local dev build where the secret env vars
 *  were never exported before `cargo build` ran) can never complete a Google
 *  sign-in — the UI checks this up front so it can show an honest "not set
 *  up" note instead of letting the user hit Google's raw OAuth error.
 *  Defaults to true outside Tauri (fixture/browser mode never calls
 *  gmailConnect for real, so there's nothing to warn about). */
export async function gmailOauthConfigured(): Promise<boolean> {
  if (!isTauri()) return true;
  return invoke<boolean>('gmail_oauth_configured');
}

export async function gmailIsConnected(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('gmail_is_connected');
}
export async function gmailDisconnect(): Promise<void> {
  if (!isTauri()) return;
  await invoke('gmail_disconnect');
}

/** Re-tag a single message's RAG chunks to a new matter in place.
 *  `messageId` may be the raw provider id or a `mail:<id>` citation source id.
 *  No-op outside Tauri (fixture mode: resolves immediately). */
export async function mailRetagMessageMatter(
  messageId: string,
  matterId: string,
): Promise<MailRetagResult> {
  if (mailFixtureEnabled()) return { filedCount: 1, searchRepairPending: false };
  if (!isTauri()) return { filedCount: 1, searchRepairPending: false };
  return withLiveMailRetagHold([messageId], (expectedWorkspace) =>
    invoke<MailRetagResult>('mail_retag_message_matter', {
      messageId,
      matterId,
      expectedWorkspace,
    }),
  );
}

/** File selected messages in one bounded desktop request. The backend performs
 * one durable transaction and at most one LanceDB table update per 512 ids. */
export async function mailRetagMessagesMatter(
  messageIds: string[],
  matterId: string,
): Promise<MailRetagResult> {
  if (mailFixtureEnabled()) return { filedCount: messageIds.length, searchRepairPending: false };
  if (!isTauri()) return { filedCount: messageIds.length, searchRepairPending: false };
  return withLiveMailRetagHold(messageIds, (expectedWorkspace) =>
    invoke<MailRetagResult>('mail_retag_messages_matter', {
      messageIds,
      matterId,
      expectedWorkspace,
    }),
  );
}

/** A filing either has current search immediately or is safely queued for repair. */
export interface MailRetagResult {
  filedCount: number;
  searchRepairPending: boolean;
}

export interface PendingMailRagRetag {
  messageId: string;
  sourceId: string;
  matterId: string;
}

/** Exact mail sources held out of search until their durable filing is mirrored. */
export async function mailListPendingRagRetags(): Promise<PendingMailRagRetag[]> {
  if (!isTauri()) return [];
  return invoke<PendingMailRagRetag[]>('mail_list_pending_rag_retags');
}

/**
 * Protect mail from its old client scope for the full live filing window, then
 * replace that temporary hold with the backend's durable repair markers. If the
 * marker read itself fails, hold all mail rather than risking a stale result.
 */
async function withLiveMailRetagHold<T>(
  messageIds: string[],
  action: (expectedWorkspace: string) => Promise<T>,
): Promise<T> {
  const workspaceRoot = useWorkspaceStore.getState().rootPath;
  if (!workspaceRoot) {
    throw new Error('Choose a workspace before filing email.');
  }
  const sourceIds = messageIds
    .map((id) => id.startsWith('mail:') ? id : `mail:${id}`);
  const releaseLiveHold = holdPendingMailRagRetagSources(workspaceRoot, sourceIds);
  try {
    return await action(workspaceRoot);
  } finally {
    // Do not let a request from the old workspace alter the newly-opened one.
    if (useWorkspaceStore.getState().rootPath === workspaceRoot) {
      try {
        const pending = await mailListPendingRagRetags();
        setPendingMailRagRetagSources(workspaceRoot, pending.map((entry) => entry.sourceId));
      } catch {
        markPendingMailRagRetagLoading(workspaceRoot);
      }
    }
    // This request releases only its own temporary hold. A second filing that
    // is still in progress remains excluded even if this marker refresh did
    // not yet see its durable repair row.
    releaseLiveHold();
  }
}

/** Retry only mail sources whose durable filing still has a pending RAG mirror. */
export async function mailRepairPendingRagRetags(): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>('mail_repair_pending_rag_retags');
}

/** Clear every email's "filed to this matter" tag for a matter being deleted
 *  (BUG-042), so the emails don't resurface on the next sync tagged with a
 *  matter that no longer exists. Returns how many filings were cleared.
 *  No-op outside Tauri (fixture mode: resolves to 0). */
export async function mailClearMatterFilings(
  matterId: string
): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>('mail_clear_matter_filings', { matterId });
}

/** On-demand fetched attachment bytes. The bytes never touch the local
 *  filesystem — they are held only in renderer-process memory. */
export interface MailAttachmentData {
  bytesBase64: string;
  contentType: string;
  filename: string;
}

/** Fetch one attachment's bytes from the provider on demand.
 *  Never persists to disk. Throws outside Tauri. */
export async function mailGetAttachment(
  provider: string,
  account: string,
  messageId: string,
  attachmentId: string
): Promise<MailAttachmentData> {
  if (!isTauri())
    throw new Error('Attachment fetch is only available in the desktop app.');
  return invoke<MailAttachmentData>('mail_get_attachment', {
    provider,
    account,
    messageId,
    attachmentId,
  });
}

export interface MailPersistedAttachment {
  path: string;
  filename: string;
  contentType: string;
  byteSize: number;
}

/** Fetch one provider attachment and write it directly into the workspace.
 *  The backend returns the saved path, not the bytes. */
export async function mailPersistAttachment(
  provider: string,
  account: string,
  messageId: string,
  attachmentId: string,
  destinationDir: string,
  filename?: string
): Promise<MailPersistedAttachment> {
  if (!isTauri())
    throw new Error('Attachment save is only available in the desktop app.');
  return invoke<MailPersistedAttachment>('mail_persist_attachment', {
    provider,
    account,
    messageId,
    attachmentId,
    destinationDir,
    filename: filename ?? null,
  });
}

/** One file attachment to include in an outgoing email. */
export interface MailAttachmentInput {
  /** Filename shown to the recipient (e.g. "contract.pdf"). */
  name: string;
  /** Standard base64-encoded file content (not URL-safe). */
  contentBase64: string;
  /** MIME type (e.g. "application/pdf"). Falls back to "application/octet-stream". */
  contentType: string;
}

export interface MailAttachmentLimit {
  maxBytes: number;
  label: string;
}

const DEFAULT_MAIL_ATTACHMENT_LIMIT: MailAttachmentLimit = {
  maxBytes: 25 * 1024 * 1024,
  label: '25 MB',
};

const MAIL_ATTACHMENT_LIMITS: Record<string, MailAttachmentLimit> = {
  // Graph simple fileAttachment sends must stay under roughly 3 MB per file.
  m365: { maxBytes: 3 * 1024 * 1024, label: '3 MB' },
  gmail: DEFAULT_MAIL_ATTACHMENT_LIMIT,
  imap: DEFAULT_MAIL_ATTACHMENT_LIMIT,
};

export function mailAttachmentLimitForProvider(
  provider: string
): MailAttachmentLimit {
  return MAIL_ATTACHMENT_LIMITS[provider] ?? DEFAULT_MAIL_ATTACHMENT_LIMIT;
}

export function mailAttachmentDecodedBytes(
  attachment: MailAttachmentInput
): number {
  const clean = attachment.contentBase64.replace(/\s/g, '');
  if (clean.length === 0) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

export function validateMailAttachmentsForProvider(
  provider: string,
  attachments: MailAttachmentInput[] | undefined
): void {
  if (!attachments || attachments.length === 0) return;
  const limit = mailAttachmentLimitForProvider(provider);
  const tooLarge = attachments
    .map((attachment) => ({
      attachment,
      bytes: mailAttachmentDecodedBytes(attachment),
    }))
    .filter((entry) => entry.bytes > limit.maxBytes);
  if (tooLarge.length === 0) return;
  throw new Error(
    `These attachments are too large for ${provider}: ${tooLarge
      .map(
        (entry) =>
          `${entry.attachment.name} (${formatBytes(entry.bytes)}, limit ${limit.label})`
      )
      .join(', ')}.`
  );
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  const kb = bytes / 1024;
  if (kb >= 1) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  return `${String(bytes)} B`;
}

/**
 * Send an email via the named provider/account.
 *
 * @param provider       - "m365" | "gmail" | "imap"
 * @param account        - provider account id (e.g. "default" or the IMAP username)
 * @param to             - recipient address strings (RFC5322 `name <addr>` or bare addr)
 * @param cc             - CC recipients
 * @param bcc            - BCC recipients (never leaked to To/CC in the sent message)
 * @param subject        - email subject
 * @param body           - plain-text body
 * @param inReplyToId    - provider message id of the message being replied to
 *                         (the part after `mail:` in a citation source; a leading
 *                         `mail:` prefix is tolerated). When present, the backend
 *                         fetches the original message's internet_message_id and
 *                         References header for threading.
 * @param attachments    - optional file attachments to include in the message
 *
 * @returns The sent message id (provider-specific) on success, or an empty string
 *          for providers that do not return one (SMTP / Graph sendMail). Treat any
 *          non-error return as success.
 *
 * @throws "scope_upgrade_required" — the stored OAuth token predates the send
 *         scope; prompt the user to reconnect (re-run the login flow).
 * @throws Any other string — a human-readable send error.
 */
export async function mailSend(
  provider: string,
  account: string,
  to: string[],
  cc: string[],
  bcc: string[],
  subject: string,
  body: string,
  inReplyToId?: string,
  attachments?: MailAttachmentInput[]
): Promise<string> {
  if (!isTauri())
    throw new Error('Email send is only available in the desktop app.');
  validateMailAttachmentsForProvider(provider, attachments);
  return invoke<string>('mail_send', {
    provider,
    account,
    to,
    cc,
    bcc,
    subject,
    body,
    inReplyToId: inReplyToId ?? null,
    attachments: attachments && attachments.length > 0 ? attachments : null,
  });
}

/** Compose the "<provider>:<account>" account id `mail_save_draft` parses. */
export function composeMailAccountId(
  provider: string,
  account: string
): string {
  return `${provider}:${account}`;
}

/**
 * Save a draft into the account's REAL mailbox Drafts folder (Wave 0 contract).
 * Never sends. Returns the provider draft id. m365/gmail only — the backend
 * rejects IMAP. Throws "scope_upgrade_required" when the stored token predates
 * the draft scopes (caller shows the standard reconnect prompt).
 */
export async function mailSaveDraft(
  accountId: string,
  to: string[],
  subject: string,
  bodyHtml: string,
  inReplyTo?: string
): Promise<string> {
  if (!isTauri())
    throw new Error('Saving drafts is only available in the desktop app.');
  return invoke<string>('mail_save_draft', {
    accountId,
    to,
    subject,
    bodyHtml,
    inReplyTo: inReplyTo ?? null,
  });
}
