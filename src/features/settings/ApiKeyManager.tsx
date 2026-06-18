/**
 * ApiKeyManager — the "Manage AI Account Keys" surface.
 *
 * Opened from AI & Privacy settings. Unlike the add-only wizard, this lists the
 * AI provider keys that are already saved, one row per provider, with:
 *   - the provider name
 *   - a masked key prefix (from KeychainService metadata)
 *   - a status (Working / Invalid / Unverified) the user can check on demand
 *   - a Remove button (deletes through KeychainService + updates metadata)
 *
 * It also keeps an "Add a provider key" button that opens the existing
 * ApiKeyWizard, so this one entry point now both shows and adds keys.
 *
 * Storage is never touched directly here — every read/delete goes through the
 * KeychainService abstraction the rest of the app uses. Verification reuses the
 * same minimal-call path as the wizard and the "Test this key" button
 * (validateApiKeyLive), so a 401 surfaces as "Invalid" rather than silently
 * looking fine.
 *
 * Light-theme styling, matching the surrounding settings surfaces.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Key, Plus, Trash2, CheckCircle, XCircle, Loader2, ShieldQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KeyProvider, StoredKey } from '@/platform/providers/KeychainService';
import {
  validateApiKeyLive,
  type ValidationProvider,
} from '@/platform/providers/apiKeyValidation';
import { markKeyVerified, markKeyInvalid, clearKeyStatus } from '@/platform/providers/keyVerification';

/** The subset of KeychainService this surface needs. */
export interface ApiKeyManagerKeychain {
  getKey(provider: KeyProvider): Promise<string | null>;
  deleteKey(provider: KeyProvider): Promise<void>;
  getMaskedKey(provider: KeyProvider): Promise<string | null>;
  getStoredKeys(): StoredKey[];
}

export interface ApiKeyManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keychainService: ApiKeyManagerKeychain;
  /** Open the add-a-key wizard. The manager closes; the wizard takes over. */
  onAddKey: () => void;
  /**
   * Called after a key is removed (with the provider that was removed), so
   * callers can refresh dependent state (e.g. clear the mirrored AI key state).
   */
  onKeyRemoved?: (provider: KeyProvider) => void;
}

const PROVIDER_NAMES: Record<KeyProvider, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  google: 'Google AI (Gemini)',
};

// Plain-literal UI copy, consistent with ApiKeyWizard. Hoisted to a const so
// the i18n lint rule (which can't target a JSX text node split from its
// element) sees it on a statement instead of inline button text.
const ADD_KEY_LABEL = 'Add a provider key';

type RowStatus = 'unverified' | 'checking' | 'working' | 'invalid';

interface KeyRow {
  provider: KeyProvider;
  masked: string;
  status: RowStatus;
}

export function ApiKeyManager({
  open,
  onOpenChange,
  keychainService,
  onAddKey,
  onKeyRemoved,
}: ApiKeyManagerProps) {
  const [rows, setRows] = useState<KeyRow[] | null>(null);
  // Aborts any in-flight per-row checks when the dialog closes / unmounts.
  const abortRefs = useRef<Map<KeyProvider, AbortController>>(new Map());

  const loadRows = useCallback(async () => {
    const stored = keychainService.getStoredKeys();
    const next = await Promise.all(
      stored.map(async (entry): Promise<KeyRow> => {
        const masked = await keychainService.getMaskedKey(entry.provider);
        return {
          provider: entry.provider,
          masked: masked ?? `${entry.keyPrefix}...`,
          status: 'unverified',
        };
      }),
    );
    setRows(next);
  }, [keychainService]);

  // (Re)load the list each time the dialog opens so it always reflects reality.
  // Defer to a microtask so the setState inside loadRows doesn't fire directly
  // in the effect body (satisfies react-hooks/set-state-in-effect, matching the
  // AiSetupStep pattern).
  useEffect(() => {
    if (!open) return;
    void Promise.resolve().then(loadRows);
  }, [open, loadRows]);

  // Abort outstanding checks when the dialog closes or the component unmounts.
  useEffect(() => {
    if (open) return;
    const refs = abortRefs.current;
    for (const ac of refs.values()) ac.abort();
    refs.clear();
  }, [open]);
  useEffect(() => {
    const refs = abortRefs.current;
    return () => {
      for (const ac of refs.values()) ac.abort();
      refs.clear();
    };
  }, []);

  const setRowStatus = useCallback((provider: KeyProvider, status: RowStatus) => {
    setRows((prev) =>
      prev ? prev.map((r) => (r.provider === provider ? { ...r, status } : r)) : prev,
    );
  }, []);

  const handleCheck = useCallback(
    async (provider: KeyProvider) => {
      const key = await keychainService.getKey(provider);
      if (!key) {
        // Key vanished underneath us — refresh the list.
        await loadRows();
        return;
      }
      abortRefs.current.get(provider)?.abort();
      const ac = new AbortController();
      abortRefs.current.set(provider, ac);
      setRowStatus(provider, 'checking');

      const result = await validateApiKeyLive(provider as ValidationProvider, key, ac.signal);
      if (ac.signal.aborted) return;
      abortRefs.current.delete(provider);

      // 'rejected'/'malformed' = the key does not work. 'ok' = working.
      // 'network' = couldn't reach the provider, so we can't claim either way:
      // leave it unverified rather than mislabel a possibly-good key as invalid.
      if (result.outcome === 'ok') {
        setRowStatus(provider, 'working');
        // Remember this provider is verified so a new chat prefers it.
        markKeyVerified(provider);
      } else if (result.outcome === 'rejected' || result.outcome === 'malformed') {
        setRowStatus(provider, 'invalid');
        // The stored key is bad, so a new chat must never default to it.
        markKeyInvalid(provider);
      } else {
        setRowStatus(provider, 'unverified');
      }
    },
    [keychainService, loadRows, setRowStatus],
  );

  const handleRemove = useCallback(
    async (provider: KeyProvider) => {
      if (!confirm(`Remove the ${PROVIDER_NAMES[provider]} key? You can add it again at any time.`)) {
        return;
      }
      abortRefs.current.get(provider)?.abort();
      abortRefs.current.delete(provider);
      await keychainService.deleteKey(provider);
      clearKeyStatus(provider);
      await loadRows();
      onKeyRemoved?.(provider);
    },
    [keychainService, loadRows, onKeyRemoved],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg flex flex-col max-h-[85vh] gap-0"
        data-testid="api-key-manager"
      >
        <DialogHeader className="shrink-0">
          {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string -- matches the wizard's plain-literal copy; no locale key exists yet */}
          <DialogTitle>Manage AI Account Keys</DialogTitle>
          {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string -- matches the wizard's plain-literal copy; no locale key exists yet */}
          <DialogDescription>
            The provider keys saved on this computer. Remove one any time, or add another.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto py-4">
          {rows === null ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
          ) : rows.length === 0 ? (
            <div
              data-testid="api-key-manager-empty"
              className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center"
            >
              <Key className="h-5 w-5 mx-auto text-muted-foreground" />
              {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string -- matches the wizard's plain-literal copy; no locale key exists yet */}
              <p className="mt-2 text-sm font-medium">No provider keys saved yet</p>
              {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string -- matches the wizard's plain-literal copy; no locale key exists yet */}
              <p className="mt-1 text-xs text-muted-foreground">
                Add an Anthropic, OpenAI, or Google AI key to start using the assistant.
              </p>
            </div>
          ) : (
            <ul className="space-y-2" data-testid="api-key-manager-list">
              {rows.map((row) => (
                <li
                  key={row.provider}
                  data-testid={`api-key-manager-row-${row.provider}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate">
                        {PROVIDER_NAMES[row.provider]}
                      </span>
                      <StatusBadge status={row.status} />
                    </div>
                    <code className="mt-1 block text-xs text-muted-foreground">{row.masked}</code>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleCheck(row.provider)}
                      disabled={row.status === 'checking'}
                      data-testid={`api-key-manager-check-${row.provider}`}
                      className="gap-1.5"
                    >
                      {row.status === 'checking' ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Checking
                        </>
                      ) : (
                        'Check'
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleRemove(row.provider)}
                      data-testid={`api-key-manager-remove-${row.provider}`}
                      className="text-destructive hover:text-destructive gap-1.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-end pt-4 border-t border-border bg-background">
          <Button
            type="button"
            size="sm"
            onClick={onAddKey}
            data-testid="api-key-manager-add"
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {ADD_KEY_LABEL}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: RowStatus }) {
  if (status === 'working') {
    return (
      <span
        data-testid="api-key-manager-status-working"
        className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium"
      >
        <CheckCircle className="h-3 w-3" />
        Working
      </span>
    );
  }
  if (status === 'invalid') {
    return (
      <span
        data-testid="api-key-manager-status-invalid"
        className="inline-flex items-center gap-1 text-xs text-destructive font-medium"
      >
        <XCircle className="h-3 w-3" />
        Invalid
      </span>
    );
  }
  if (status === 'checking') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking
      </span>
    );
  }
  return (
    <span
      data-testid="api-key-manager-status-unverified"
      className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground')}
    >
      <ShieldQuestion className="h-3 w-3" />
      Unverified
    </span>
  );
}

export default ApiKeyManager;
