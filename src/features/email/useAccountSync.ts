import { useState, useEffect, useRef, useCallback } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  mailConnectedAccounts,
  mailSyncAll,
  mailCancelSync,
  MAIL_SYNC_EVENT,
  type ConnectedAccount,
  type MailSyncProgress,
} from '@/platform/utils/mail-commands';
import { buildMailMatterMap } from '@/platform/rag/matterResolver';
import { getMatters } from '@/platform/matter/matterStore';
import { withTimeout } from '@/lib/withTimeout';

// A sync that genuinely never returns (backend deadlock, dropped IPC reply)
// used to leave "Syncing…" greyed out forever, with `syncing` only ever
// cleared by the `.finally` of a promise that never settled. This hard caps
// it so the button always becomes usable again. The stall warning fires much
// sooner, mirroring the 90s threshold the m365/Gmail connector panels already
// use (MailConnect.tsx), so the user gets an early heads-up before the hard
// timeout forces a reset.
const SYNC_STALL_WARNING_MS = 90_000;
const SYNC_HARD_TIMEOUT_MS = 5 * 60_000;

// Deduplicates connected accounts by (provider, account) key.
function sanitizeConnectedAccounts(accounts: ConnectedAccount[]): ConnectedAccount[] {
  const byKey = new Map<string, ConnectedAccount>();
  for (const account of accounts) {
    const provider = account.provider.trim();
    const accountId = account.account.trim();
    if (!provider || !accountId) continue;
    const key = `${provider}:${accountId}`;
    if (!byKey.has(key)) {
      byKey.set(key, { ...account, provider, account: accountId });
    }
  }
  return Array.from(byKey.values());
}

// ── Options ────────────────────────────────────────────────────────────────

interface UseAccountSyncOptions {
  /** Called when accounts resolve to empty — parent should clear result state. */
  onNoAccounts: () => void;
  /** Called when a sync finishes or window regains focus — parent triggers re-query. */
  onSyncDone: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useAccountSync({ onNoAccounts, onSyncDone }: UseAccountSyncOptions): {
  syncing: boolean;
  /** True once a sync has been running for SYNC_STALL_WARNING_MS with no resolution. */
  syncStalled: boolean;
  /** Set when a sync hard-times-out or otherwise fails to start; cleared on the next attempt. */
  syncError: string | null;
  syncImportedMessages: number | null;
  accounts: ConnectedAccount[];
  accountsLoaded: boolean;
  /** True when the desktop mail connection check itself failed. */
  accountLoadError: boolean;
  hasConnectedMail: boolean;
  handleSyncNow: () => void;
} {
  const [syncing, setSyncing] = useState(false);
  const [syncStalled, setSyncStalled] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncImportedMessages, setSyncImportedMessages] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [accountLoadError, setAccountLoadError] = useState(false);
  const hasConnectedMail = accountsLoaded && accounts.length > 0;
  const liveWrittenByProviderRef = useRef(new Map<string, number>());
  const activeAllProviderSyncRef = useRef(false);

  // Stall watchdog: warn well before the hard timeout below forces a reset,
  // so a slow-but-alive sync doesn't look identical to a genuinely hung one.
  // Deferred to a microtask so the setState doesn't fire synchronously in the
  // effect body (satisfies react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!syncing) {
      void Promise.resolve().then(() => { setSyncStalled(false); });
      return;
    }
    const timer = setTimeout(() => { setSyncStalled(true); }, SYNC_STALL_WARNING_MS);
    return () => { clearTimeout(timer); };
  }, [syncing]);

  // Hold latest callbacks in a ref so effects with [] deps always call the
  // current version without needing to re-register listeners on every render.
  const callbacksRef = useRef({ onNoAccounts, onSyncDone });
  useEffect(() => {
    callbacksRef.current = { onNoAccounts, onSyncDone };
  });

  // Shared by the startup auto-sync and the manual "Sync now" button. On a
  // hard timeout, also tells the backend to actually stop (mailCancelSync) —
  // otherwise only the renderer-side promise gives up while the Rust sync
  // keeps running and holding its single-sync guard, so the very next click
  // would fail with "a sync is already in progress" even though the button
  // looks idle again.
  const runMailSync = useCallback(async () => {
    liveWrittenByProviderRef.current.clear();
    activeAllProviderSyncRef.current = true;
    setSyncImportedMessages(null);
    setSyncing(true);
    setSyncError(null);
    try {
      await withTimeout(mailSyncAll(buildMailMatterMap(getMatters())), SYNC_HARD_TIMEOUT_MS, 'Email sync');
    } catch (err) {
      // A real backend error is surfaced via the MAIL_SYNC_EVENT error status
      // already; a hard timeout means no such event is coming, so that case
      // needs its own message — and its own cancellation.
      if (err instanceof Error && err.name === 'TimeoutError') {
        setSyncError('Email sync is taking too long and was stopped. Try again.');
        // Fire-and-forget: mailCancelSync() is itself an IPC call that could
        // hang for the same reason the sync did. Don't await it here — the
        // hard timeout's whole point is that the UI recovers unconditionally;
        // it must not get re-blocked by an uncapped cancel request.
        void mailCancelSync().catch(() => { /* best-effort */ });
      }
    } finally {
      activeAllProviderSyncRef.current = false;
      setSyncing(false);
    }
  }, []);

  // Load connected accounts on mount and re-check on window focus so the view
  // updates automatically after the user connects an account in the Account window.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setAccountLoadError(false);
      mailConnectedAccounts()
        .then((accs) => {
          if (!cancelled) {
            const nextAccounts = sanitizeConnectedAccounts(accs);
            setAccounts(nextAccounts);
            if (nextAccounts.length === 0) {
              setSyncing(false);
              callbacksRef.current.onNoAccounts();
            }
            setAccountsLoaded(true);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setAccounts([]);
            setAccountLoadError(true);
            setAccountsLoaded(true);
          }
        });
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
    };
  }, []);

  // BUG-007: Auto-sync on mount when already connected but no sync has run yet.
  // `mail_sync_all` only fires at connect-time; after an app restart the account
  // shows as Connected but the Email tab is empty with no way to refresh. This
  // effect fires once after accounts are resolved: if there are connected accounts
  // and we're running inside Tauri (desktop-only), kick off a background sync.
  // Guard: skip if already syncing (prevents double-fire on HMR / strict-mode).
  const startupSyncFiredRef = useRef(false);
  useEffect(() => {
    if (!isTauri()) return;
    if (!accountsLoaded) return;
    if (accounts.length === 0) return;
    if (startupSyncFiredRef.current) return;
    startupSyncFiredRef.current = true;
    // Deferred to a microtask so the setState calls inside runMailSync don't
    // fire synchronously in the effect body (satisfies react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => { void runMailSync(); });
  }, [accountsLoaded, accounts.length, runMailSync]);

  // Re-query the message list when a sync finishes or this window regains focus.
  // The connectors live in a SEPARATE window, so mail imported there lands in the
  // shared encrypted store while this window's list still shows the pre-import
  // state — without this, an import of hundreds of messages never appears here
  // until a manual filter change. `onSyncDone` re-runs the keyword query (Effect A)
  // from the first page. (`accounts` is intentionally not an Effect-A dependency,
  // so updating it alone would not refresh the list.)
  useEffect(() => {
    const refresh = () => { callbacksRef.current.onSyncDone(); };
    window.addEventListener('focus', refresh);
    let unlisten: (() => void) | undefined;
    let disposed = false;
    if (isTauri()) {
      listen<MailSyncProgress>(MAIL_SYNC_EVENT, (e) => {
        const { provider, status, written } = e.payload;
        if (provider) {
          liveWrittenByProviderRef.current.set(provider, written);
          const totalWritten = Array.from(liveWrittenByProviderRef.current.values()).reduce(
            (sum, count) => sum + count,
            0,
          );
          setSyncImportedMessages(totalWritten);
        }
        if (status === 'syncing') {
          setSyncing(true);
        } else if (!activeAllProviderSyncRef.current) {
          setSyncing(false);
        }
        if (status === 'done') refresh();
      })
        .then((u) => {
          if (disposed) u();
          else unlisten = u;
        })
        .catch(() => {});
    }
    return () => {
      disposed = true;
      window.removeEventListener('focus', refresh);
      if (unlisten) unlisten();
    };
  }, []);

  // BUG-007: Manual "Sync now" — calls mailSyncAll for all connected providers.
  // Disabled while a sync is already in flight (syncing state) or outside Tauri.
  const handleSyncNow = useCallback(() => {
    if (!isTauri()) return;
    if (syncing) return;
    void runMailSync();
  }, [syncing, runMailSync]);

  return {
    syncing,
    syncStalled,
    syncError,
    syncImportedMessages,
    accounts,
    accountsLoaded,
    accountLoadError,
    hasConnectedMail,
    handleSyncNow,
  };
}
