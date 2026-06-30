import { useState, useEffect, useRef, useCallback } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  mailConnectedAccounts,
  mailSyncAll,
  MAIL_SYNC_EVENT,
  type ConnectedAccount,
  type MailSyncProgress,
} from '@/platform/utils/mail-commands';
import { buildMailMatterMap } from '@/platform/rag/matterResolver';
import { getMatters } from '@/platform/matter/matterStore';

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
  accounts: ConnectedAccount[];
  accountsLoaded: boolean;
  hasConnectedMail: boolean;
  handleSyncNow: () => void;
} {
  const [syncing, setSyncing] = useState(false);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const hasConnectedMail = accountsLoaded && accounts.length > 0;

  // Hold latest callbacks in a ref so effects with [] deps always call the
  // current version without needing to re-register listeners on every render.
  const callbacksRef = useRef({ onNoAccounts, onSyncDone });
  useEffect(() => {
    callbacksRef.current = { onNoAccounts, onSyncDone };
  });

  // Load connected accounts on mount and re-check on window focus so the view
  // updates automatically after the user connects an account in the Account window.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
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
    setSyncing(true);
    mailSyncAll(buildMailMatterMap(getMatters()))
      .catch(() => { /* surfaced via the MAIL_SYNC_EVENT error status */ })
      .finally(() => { setSyncing(false); });
  }, [accountsLoaded, accounts.length]);

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
        if (e.payload.status === 'done') refresh();
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
    setSyncing(true);
    mailSyncAll(buildMailMatterMap(getMatters()))
      .catch(() => { /* error status surfaced via MAIL_SYNC_EVENT listener */ })
      .finally(() => { setSyncing(false); });
  }, [syncing]);

  return { syncing, accounts, accountsLoaded, hasConnectedMail, handleSyncNow };
}
