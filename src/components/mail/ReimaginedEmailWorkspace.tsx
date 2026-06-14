/**
 * ReimaginedEmailWorkspace — full-page email search and browse surface.
 *
 * Two modes:
 *   Keyword — debounced mailListMessages() with provider / date / attachment
 *             filters; paginated "Load more" (offset += 50).
 *   Ask     — MemoryService.retrieve() scoped to mail: sourceIds; results
 *             ranked by similarity score.
 *
 * Per-row actions: Open (dispatches keepance:open-email), File to matter
 * (popover with matter picker), Privilege (dropdown), Export (mailGetMessage
 * + onSaveToWorkspace).
 *
 * Privilege is handled by a sub-component (MailRowPrivilege) so the hook
 * can be called per-row without violating the Rules of Hooks.
 *
 * Light theme only. CSS variables + inline styles. No dark mode.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mail,
  Search,
  Filter,
  ChevronDown,
  Loader2,
  AlertTriangle,
  Paperclip,
  ShieldCheck,
  FileDown,
  FolderInput,
  X,
  Check,
} from 'lucide-react';
import { useActiveMatter, useMatters } from '@/stores/matterStore';
import { usePrivilegeStore, usePrivilegeForSource } from '@/stores/privilegeStore';
import {
  mailListMessages,
  mailGetMessage,
  mailConnectedAccounts,
  mailRetagFolderMatter,
  type MailListItem,
  type ConnectedAccount,
} from '@/utils/mail-commands';
import { MemoryService, isMemoryEnabled } from '@/modules/memory/MemoryService';
import { ALL_PRIVILEGE_STATUSES, isPrivileged, type Privilege } from '@/types/privilege';
import type { RagHit, RetrievalScope } from '@/utils/tauri-commands';
import { matterLabel } from '@/modules/memory/matterResolver';

// ── Props ──────────────────────────────────────────────────────────────────

export interface ReimaginedEmailWorkspaceProps {
  onSaveToWorkspace?: ((content: string, suggestedName: string) => Promise<void>) | undefined;
  onOpenSettings?: (() => void) | undefined;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRelativeDate(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) {
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    if (diffDays < 7) {
      return d.toLocaleDateString(undefined, { weekday: 'short' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function slugify(s: string): string {
  return s
    .slice(0, 50)
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}

// ── MailRowPrivilege sub-component ─────────────────────────────────────────
// Must be a component so it can call hooks per-row.

interface MailRowPrivilegeProps {
  sourceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function MailRowPrivilege({ sourceId, open, onOpenChange }: MailRowPrivilegeProps) {
  const mailSourceId = sourceId.startsWith('mail:') ? sourceId : `mail:${sourceId}`;
  const privilege = usePrivilegeForSource(mailSourceId);
  const setPrivilege = usePrivilegeStore((s) => s.setPrivilege);

  const privilegeLabels: Record<Privilege, string> = {
    none: 'Not privileged',
    'attorney-client': 'Attorney-Client',
    'work-product': 'Work Product',
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        title="Set privilege"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(!open);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 7px',
          borderRadius: 4,
          fontSize: 11,
          fontWeight: isPrivileged(privilege) ? 600 : 400,
          background: isPrivileged(privilege) ? 'rgba(10,37,64,0.08)' : 'transparent',
          color: isPrivileged(privilege) ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
          border: isPrivileged(privilege)
            ? '1px solid rgba(10,37,64,0.18)'
            : '1px solid var(--color-border)',
          cursor: 'pointer',
        }}
      >
        <ShieldCheck style={{ width: 11, height: 11, strokeWidth: 2 }} />
        {isPrivileged(privilege) ? privilegeLabels[privilege] : 'Privilege'}
        <ChevronDown style={{ width: 10, height: 10, strokeWidth: 2 }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 50,
            background: '#fff',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
            minWidth: 170,
            overflow: 'hidden',
          }}
        >
          {ALL_PRIVILEGE_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              data-testid={`privilege-option-${status}`}
              onClick={(e) => {
                e.stopPropagation();
                setPrivilege(mailSourceId, status);
                onOpenChange(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '8px 12px',
                fontSize: 12,
                fontWeight: privilege === status ? 600 : 400,
                color: 'var(--color-foreground)',
                background: privilege === status ? 'rgba(10,37,64,0.04)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {privilegeLabels[status]}
              {privilege === status && (
                <Check style={{ width: 12, height: 12, color: 'var(--kp-navy)', strokeWidth: 2.5 }} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── MatterPickerPopover ────────────────────────────────────────────────────

interface MatterPickerProps {
  item: MailListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

function MatterPickerPopover({ item, open, onOpenChange, onDone }: MatterPickerProps) {
  const matters = useMatters();
  const [filing, setFiling] = useState<string | null>(null);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 4px)',
        right: 0,
        zIndex: 50,
        background: '#fff',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
        minWidth: 200,
        maxHeight: 240,
        overflowY: 'auto',
      }}
    >
      {/* eslint-disable keepance-i18n/no-hardcoded-string */}
      {matters.length === 0 ? (
        <div
          style={{
            padding: '12px 14px',
            fontSize: 12,
            color: 'var(--color-muted-foreground)',
          }}
        >
          No matters yet
        </div>
      ) : (
        matters.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={filing === m.id}
            onClick={(e) => {
              e.stopPropagation();
              setFiling(m.id);
              void mailRetagFolderMatter(item.provider, item.account, item.folderId, m.id)
                .catch(() => { /* swallow; retry is caller's concern */ })
                .finally(() => {
                  setFiling(null);
                  onOpenChange(false);
                  onDone();
                });
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '8px 12px',
              fontSize: 12,
              color: 'var(--color-foreground)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            {filing === m.id ? (
              <Loader2 style={{ width: 11, height: 11, strokeWidth: 2, animation: 'spin 1s linear infinite', flex: 'none' }} />
            ) : (
              <FolderInput style={{ width: 11, height: 11, strokeWidth: 1.75, flex: 'none', color: 'var(--color-muted-foreground)' }} />
            )}
            {matterLabel(m)}
          </button>
        ))
      )}
      {/* eslint-enable keepance-i18n/no-hardcoded-string */}
    </div>
  );
}

// ── MailRow ────────────────────────────────────────────────────────────────

interface MailRowProps {
  item: MailListItem;
  onSaveToWorkspace?: ((content: string, suggestedName: string) => Promise<void>) | undefined;
}

function MailRow({ item, onSaveToWorkspace }: MailRowProps) {
  const [hovered, setHovered] = useState(false);
  const [privilegeOpen, setPrivilegeOpen] = useState(false);
  const [matterOpen, setMatterOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleOpen = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('keepance:open-email', {
        detail: { sourceId: `mail:${item.id}` },
      }),
    );
  }, [item.id]);

  const handleExport = useCallback(async () => {
    if (!onSaveToWorkspace) return;
    setExporting(true);
    try {
      const msg = await mailGetMessage(item.id);
      const to = msg.to.join(', ');
      const cc = msg.cc.length > 0 ? `\nCc: ${msg.cc.join(', ')}` : '';
      const date = msg.date ?? '';
      const content = `Subject: ${msg.subject}\nFrom: ${msg.from}\nTo: ${to}${cc}\nDate: ${date}\n\n${msg.body}`;
      const suggestedName = `${slugify(item.subject) || 'email'}.txt`;
      await onSaveToWorkspace(content, suggestedName);
    } catch {
      // swallow; no UI disruption
    } finally {
      setExporting(false);
    }
  }, [item.id, item.subject, onSaveToWorkspace]);

  const mailSourceId = `mail:${item.id}`;
  const privilege = usePrivilegeForSource(mailSourceId);

  return (
    <div
      data-testid="mail-row"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        padding: '11px 20px',
        borderBottom: '1px solid var(--color-border)',
        background: hovered ? 'rgba(10,37,64,0.02)' : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.1s',
      }}
      onMouseEnter={() => { setHovered(true); }}
      onMouseLeave={() => {
        setHovered(false);
        // close dropdowns on mouse leave so they don't float
      }}
      onClick={handleOpen}
    >
      {/* Row top: subject + date */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--kp-navy)',
            fontFamily: 'var(--font-sans)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {item.subject || '(no subject)'}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-muted-foreground)',
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
            flex: 'none',
          }}
        >
          {formatRelativeDate(item.receivedDateTime)}
        </span>
      </div>

      {/* From + badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
        <span style={{ fontSize: 12, color: 'var(--color-muted-foreground)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.fromName ? `${item.fromName} <${item.fromAddr}>` : item.fromAddr}
        </span>
        {item.hasAttachments && (
          <Paperclip style={{ width: 11, height: 11, color: 'var(--color-muted-foreground)', strokeWidth: 1.75, flex: 'none' }} />
        )}
        {isPrivileged(privilege) && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              padding: '1px 5px',
              borderRadius: 3,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.03em',
              background: 'rgba(10,37,64,0.07)',
              color: 'var(--kp-navy)',
              border: '1px solid rgba(10,37,64,0.18)',
              whiteSpace: 'nowrap',
              flex: 'none',
            }}
          >
            <ShieldCheck style={{ width: 9, height: 9, strokeWidth: 2 }} />
            { }
            Privileged
            { }
          </span>
        )}
      </div>

      {/* Snippet */}
      {item.snippet && (
        <span
          style={{
            fontSize: 12,
            color: 'var(--color-muted-foreground)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.snippet}
        </span>
      )}

      {/* Hover actions */}
      {hovered && (
        <div
          style={{
            position: 'absolute',
            right: 16,
            bottom: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          onClick={(e) => { e.stopPropagation(); }}
        >
          {/* Open */}
          <button
            type="button"
            data-testid={`open-email-${item.id}`}
            onClick={handleOpen}
            style={actionBtnStyle}
            title="Open email"
          >
            { }
            <Mail style={{ width: 12, height: 12, strokeWidth: 1.75 }} />
            Open
            { }
          </button>

          {/* File to matter */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              data-testid={`file-to-matter-${item.id}`}
              onClick={() => { setMatterOpen((o) => !o); }}
              style={actionBtnStyle}
              title="File to matter"
            >
              { }
              <FolderInput style={{ width: 12, height: 12, strokeWidth: 1.75 }} />
              File
              { }
            </button>
            <MatterPickerPopover
              item={item}
              open={matterOpen}
              onOpenChange={setMatterOpen}
              onDone={() => { setMatterOpen(false); }}
            />
          </div>

          {/* Privilege */}
          <MailRowPrivilege
            sourceId={item.id}
            open={privilegeOpen}
            onOpenChange={setPrivilegeOpen}
          />

          {/* Export */}
          {onSaveToWorkspace && (
            <button
              type="button"
              data-testid={`export-email-${item.id}`}
              onClick={() => { void handleExport(); }}
              disabled={exporting}
              style={actionBtnStyle}
              title="Export to workspace"
            >
              {exporting ? (
                <Loader2 style={{ width: 12, height: 12, strokeWidth: 2, animation: 'spin 1s linear infinite' }} />
              ) : (
                <FileDown style={{ width: 12, height: 12, strokeWidth: 1.75 }} />
              )}
              { }
              Export
              { }
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const actionBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--color-foreground)',
  background: '#fff',
  border: '1px solid var(--color-border)',
  cursor: 'pointer',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
};

// ── AskHit card ────────────────────────────────────────────────────────────

interface AskHitCardProps {
  hit: RagHit;
  rank: number;
}

function AskHitCard({ hit, rank }: AskHitCardProps) {
  const sid = hit.sourceId ?? hit.path;
  const displayId = sid.startsWith('mail:') ? sid.slice(5) : sid;

  const handleOpen = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('keepance:open-email', {
        detail: { sourceId: sid },
      }),
    );
  }, [sid]);

  return (
    <button
      type="button"
      data-testid="ask-hit-card"
      onClick={handleOpen}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '12px 16px',
        borderRadius: 8,
        border: '1px solid var(--color-border)',
        background: '#fff',
        cursor: 'pointer',
        marginBottom: 8,
        transition: 'box-shadow 0.12s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--color-muted-foreground)',
            fontVariantNumeric: 'tabular-nums',
            flex: 'none',
          }}
        >
          { }
          #{rank}
          { }
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--kp-navy)',
            fontFamily: 'var(--font-sans)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {displayId}
        </span>
        <span
          style={{
            fontSize: 10,
            color: 'var(--color-muted-foreground)',
            fontVariantNumeric: 'tabular-nums',
            flex: 'none',
          }}
        >
          { }
          score {hit.score.toFixed(3)}
          { }
        </span>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          color: 'var(--color-muted-foreground)',
          lineHeight: 1.5,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {hit.chunkText}
      </p>
    </button>
  );
}

// ── No-accounts empty state ────────────────────────────────────────────────

interface NoAccountsStateProps {
  onOpenSettings?: (() => void) | undefined;
}

function NoAccountsState({ onOpenSettings }: NoAccountsStateProps) {
  return (
    <div
      data-testid="no-accounts-state"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 24px',
        textAlign: 'center',
        gap: 12,
      }}
    >
      <Mail
        style={{
          width: 36,
          height: 36,
          color: 'var(--color-muted-foreground)',
          strokeWidth: 1.5,
          marginBottom: 4,
        }}
      />
      {/* eslint-disable keepance-i18n/no-hardcoded-string */}
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--kp-navy)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        No email connected
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--color-muted-foreground)',
          maxWidth: 300,
          lineHeight: 1.5,
        }}
      >
        Connect your Microsoft 365 or Gmail account to search and file email inside Keepance.
      </div>
      {onOpenSettings && (
        <button
          type="button"
          onClick={onOpenSettings}
          style={{
            marginTop: 8,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            background: 'var(--kp-navy)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >
          Connect your email
        </button>
      )}
      {/* eslint-enable keepance-i18n/no-hardcoded-string */}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export function ReimaginedEmailWorkspace({
  onSaveToWorkspace,
  onOpenSettings,
}: ReimaginedEmailWorkspaceProps) {
  const activeMatter = useActiveMatter();

  // Scope toggle: "This matter" vs "All email"
  const [scopeAllEmail, setScopeAllEmail] = useState(false);

  // Mode toggle: "Keyword" vs "Ask"
  const [mode, setMode] = useState<'keyword' | 'ask'>('keyword');

  // Search / filter state
  const [query, setQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [hasAttachments, setHasAttachments] = useState(false);

  // Connected accounts (loaded once on mount)
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);

  // Keyword results
  const [items, setItems] = useState<MailListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Ask mode results
  const [askHits, setAskHits] = useState<RagHit[]>([]);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  // Debounce ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef(0);

  // Load connected accounts on mount
  useEffect(() => {
    let cancelled = false;
    mailConnectedAccounts()
      .then((accs) => {
        if (!cancelled) {
          setAccounts(accs);
          setAccountsLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccounts([]);
          setAccountsLoaded(true);
        }
      });
    return () => { cancelled = true; };
  }, []);

  // Keyword search — debounced 200ms, fires when query/filters/offset change
  useEffect(() => {
    if (mode !== 'keyword') return;
    if (!accountsLoaded) return;

    const thisQuery = ++latestQueryRef.current;

    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => { void (async () => {
      if (offset === 0) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);

      try {
        // Build the query carefully: exactOptionalPropertyTypes means we must
        // omit optional fields entirely rather than set them to undefined.
        const listQuery: Parameters<typeof mailListMessages>[0] = {
          sortBy: 'date',
          sortDesc: true,
          limit: 50,
          offset,
        };
        if (query) listQuery.keyword = query;
        if (providerFilter) listQuery.provider = providerFilter;
        if (dateFrom) listQuery.dateFrom = dateFrom;
        if (dateTo) listQuery.dateTo = dateTo;
        if (hasAttachments) listQuery.hasAttachments = true;

        const result = await mailListMessages(listQuery);

        if (latestQueryRef.current !== thisQuery) return;

        if (offset === 0) {
          setItems(result.items);
        } else {
          setItems((prev) => [...prev, ...result.items]);
        }
        setTotal(result.total);
      } catch (e: unknown) {
        if (latestQueryRef.current !== thisQuery) return;
        setError(
          e instanceof Error ? e.message : 'Failed to load emails. Please try again.',
        );
      } finally {
        if (latestQueryRef.current === thisQuery) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    })(); }, 200);

    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [mode, accountsLoaded, query, providerFilter, dateFrom, dateTo, hasAttachments, offset]);

  // Ask mode search
  useEffect(() => {
    if (mode !== 'ask') return;
    if (!query.trim()) {
      setAskHits([]);
      return;
    }
    if (!isMemoryEnabled()) {
      setAskError('Memory (RAG) is not enabled. Enable it in Settings to use Ask mode.');
      return;
    }

    let cancelled = false;
    const thisQuery = ++latestQueryRef.current;
    setAskLoading(true);
    setAskError(null);

    const scope: RetrievalScope = activeMatter && !scopeAllEmail
      ? { kind: 'matter', matterId: activeMatter.id }
      : { kind: 'allMatters' };

    MemoryService.retrieve(query, 10, scope, false)
      .then((hits) => {
        if (cancelled || latestQueryRef.current !== thisQuery) return;
        // Filter to mail: sourceIds only (sourceId is optional on RagHit)
        const mailHits = hits.filter((h) => {
          const sid = h.sourceId ?? h.path;
          return sid.startsWith('mail:');
        });
        // Deduplicate by sourceId, keep highest score
        const bySource = new Map<string, RagHit>();
        for (const h of mailHits) {
          const key = h.sourceId ?? h.path;
          const existing = bySource.get(key);
          if (!existing || h.score > existing.score) {
            bySource.set(key, h);
          }
        }
        const deduped = Array.from(bySource.values()).sort((a, b) => b.score - a.score);
        setAskHits(deduped);
      })
      .catch((e: unknown) => {
        if (cancelled || latestQueryRef.current !== thisQuery) return;
        setAskError(
          e instanceof Error ? e.message : 'Ask retrieval failed. Please try again.',
        );
      })
      .finally(() => {
        if (!cancelled && latestQueryRef.current === thisQuery) {
          setAskLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [mode, query, activeMatter, scopeAllEmail]);

  // Reset offset when filters change
  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setOffset(0);
  }, []);

  const handleProviderChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setProviderFilter(e.target.value);
    setOffset(0);
  }, []);

  const handleDateFromChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDateFrom(e.target.value);
    setOffset(0);
  }, []);

  const handleDateToChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDateTo(e.target.value);
    setOffset(0);
  }, []);

  const handleAttachmentToggle = useCallback(() => {
    setHasAttachments((v) => !v);
    setOffset(0);
  }, []);

  const handleLoadMore = useCallback(() => {
    setOffset((o) => o + 50);
  }, []);

  const handleClearQuery = useCallback(() => {
    setQuery('');
    setOffset(0);
  }, []);

  const uniqueProviders = Array.from(new Set(accounts.map((a) => a.provider)));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-background)',
        fontFamily: 'var(--font-sans)',
        overflowY: 'auto',
      }}
    >
      {/* Page header */}
      <div
        style={{
          padding: '24px 24px 0',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Mail
              style={{
                width: 18,
                height: 18,
                color: 'var(--kp-navy)',
                strokeWidth: 1.75,
                flex: 'none',
              }}
            />
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                color: 'var(--kp-navy)',
                letterSpacing: '-0.01em',
                lineHeight: 1.2,
              }}
            >
              { }
              Email
              { }
            </h1>
          </div>

          {/* Scope toggle — only when a matter is active */}
          {activeMatter && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'rgba(10,37,64,0.05)',
                borderRadius: 6,
                padding: 2,
                gap: 2,
                flex: 'none',
              }}
            >
              { }
              {[
                { label: 'This matter', all: false },
                { label: 'All email', all: true },
              ].map(({ label, all }) => (
                <button
                  key={label}
                  type="button"
                  data-testid={`scope-${all ? 'all' : 'matter'}`}
                  onClick={() => {
                    setScopeAllEmail(all);
                    setOffset(0);
                  }}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: scopeAllEmail === all ? 600 : 400,
                    background: scopeAllEmail === all ? '#fff' : 'transparent',
                    color: scopeAllEmail === all ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
                    border: scopeAllEmail === all ? '1px solid var(--color-border)' : '1px solid transparent',
                    cursor: 'pointer',
                    boxShadow: scopeAllEmail === all ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                    transition: 'all 0.1s',
                  }}
                >
                  {label}
                </button>
              ))}
              { }
            </div>
          )}
        </div>

        {/* Hero search bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            background: '#fff',
            overflow: 'hidden',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            marginBottom: 12,
          }}
        >
          {/* Mode toggle tabs */}
          <div
            style={{
              display: 'flex',
              borderRight: '1px solid var(--color-border)',
              flex: 'none',
            }}
          >
            { }
            {(['keyword', 'ask'] as const).map((m) => (
              <button
                key={m}
                type="button"
                data-testid={`mode-${m}`}
                onClick={() => {
                  setMode(m);
                  setQuery('');
                  setOffset(0);
                }}
                style={{
                  padding: '9px 14px',
                  fontSize: 12,
                  fontWeight: mode === m ? 600 : 400,
                  color: mode === m ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
                  background: mode === m ? 'rgba(10,37,64,0.05)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  borderBottom: mode === m ? '2px solid var(--kp-navy)' : '2px solid transparent',
                }}
              >
                {m === 'keyword' ? 'Keyword' : 'Ask'}
              </button>
            ))}
            { }
          </div>

          {/* Search icon */}
          <Search
            style={{
              width: 15,
              height: 15,
              color: 'var(--color-muted-foreground)',
              strokeWidth: 1.75,
              flex: 'none',
              margin: '0 10px',
            }}
          />

          {/* Input */}
          <input
            type="text"
            data-testid="email-search-input"
            value={query}
            onChange={handleQueryChange}
            placeholder={
              mode === 'keyword'
                ? 'Search email...'
                : 'Ask a question about your email...'
            }
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              fontSize: 14,
              color: 'var(--color-foreground)',
              background: 'transparent',
              padding: '9px 0',
              fontFamily: 'var(--font-sans)',
            }}
          />

          {/* Clear */}
          {query && (
            <button
              type="button"
              onClick={handleClearQuery}
              style={{
                flex: 'none',
                padding: '6px 10px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-muted-foreground)',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X style={{ width: 13, height: 13, strokeWidth: 2 }} />
            </button>
          )}
        </div>

        {/* Filter row — only when accounts are loaded and at least one exists */}
        {accountsLoaded && accounts.length > 0 && mode === 'keyword' && (
          <div
            data-testid="filter-row"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 16,
              flexWrap: 'wrap',
            }}
          >
            <Filter
              style={{
                width: 13,
                height: 13,
                color: 'var(--color-muted-foreground)',
                strokeWidth: 1.75,
                flex: 'none',
              }}
            />

            {/* Provider filter */}
            {uniqueProviders.length > 1 && (
              <select
                data-testid="provider-filter"
                value={providerFilter}
                onChange={handleProviderChange}
                style={filterInputStyle}
              >
                { }
                <option value="">All accounts</option>
                {uniqueProviders.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                { }
              </select>
            )}

            {/* Date from */}
            <input
              type="date"
              data-testid="date-from"
              value={dateFrom}
              onChange={handleDateFromChange}
              placeholder="From"
              style={filterInputStyle}
            />

            {/* Date to */}
            <input
              type="date"
              data-testid="date-to"
              value={dateTo}
              onChange={handleDateToChange}
              placeholder="To"
              style={filterInputStyle}
            />

            {/* Has attachment toggle */}
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 12,
                color: 'var(--color-muted-foreground)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                data-testid="attachment-filter"
                checked={hasAttachments}
                onChange={handleAttachmentToggle}
                style={{ accentColor: 'var(--kp-navy)', cursor: 'pointer' }}
              />
              { }
              Has attachment
              { }
            </label>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* No accounts state */}
        {accountsLoaded && accounts.length === 0 && (
          <NoAccountsState onOpenSettings={onOpenSettings} />
        )}

        {/* Keyword mode */}
        {accountsLoaded && accounts.length > 0 && mode === 'keyword' && (
          <>
            {/* Loading skeleton */}
            {loading && (
              <div
                data-testid="loading-state"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 24px',
                  gap: 8,
                  color: 'var(--color-muted-foreground)',
                  fontSize: 13,
                }}
              >
                <Loader2
                  style={{
                    width: 16,
                    height: 16,
                    strokeWidth: 2,
                    animation: 'spin 1s linear infinite',
                  }}
                />
                { }
                Loading email...
                { }
              </div>
            )}

            {/* Error state */}
            {!loading && error && (
              <div
                data-testid="error-state"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 24px',
                  gap: 8,
                  textAlign: 'center',
                }}
              >
                <AlertTriangle
                  style={{
                    width: 24,
                    height: 24,
                    color: '#f59e0b',
                    strokeWidth: 1.75,
                  }}
                />
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-foreground)', fontWeight: 500 }}>
                  {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                  Could not load email
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                </p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--color-muted-foreground)', maxWidth: 340 }}>
                  {error}
                </p>
              </div>
            )}

            {/* No results state */}
            {!loading && !error && items.length === 0 && (
              <div
                data-testid="no-results-state"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '48px 24px',
                  gap: 8,
                  textAlign: 'center',
                }}
              >
                <Mail
                  style={{
                    width: 28,
                    height: 28,
                    color: 'var(--color-muted-foreground)',
                    strokeWidth: 1.5,
                  }}
                />
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-foreground)', fontWeight: 500 }}>
                  {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                  No emails found
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                </p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--color-muted-foreground)' }}>
                  { }
                  {query ? 'Try a different keyword or adjust the filters.' : 'No email has been synced yet.'}
                  { }
                </p>
              </div>
            )}

            {/* Results list */}
            {!loading && !error && items.length > 0 && (
              <div
                style={{
                  margin: '0 24px 24px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  background: '#fff',
                  overflow: 'hidden',
                }}
              >
                {items.map((item) => (
                  <MailRow
                    key={item.id}
                    item={item}
                    onSaveToWorkspace={onSaveToWorkspace}
                  />
                ))}

                {/* Load more */}
                {items.length < total && (
                  <div
                    style={{
                      padding: '12px 20px',
                      borderTop: '1px solid var(--color-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <button
                      type="button"
                      data-testid="load-more"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 14px',
                        borderRadius: 5,
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--color-foreground)',
                        background: '#fff',
                        border: '1px solid var(--color-border)',
                        cursor: loadingMore ? 'default' : 'pointer',
                      }}
                    >
                      {loadingMore && (
                        <Loader2
                          style={{
                            width: 12,
                            height: 12,
                            strokeWidth: 2,
                            animation: 'spin 1s linear infinite',
                          }}
                        />
                      )}
                      { }
                      {loadingMore ? 'Loading...' : `Load more (${String(total - items.length)} remaining)`}
                      { }
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Ask mode */}
        {accountsLoaded && accounts.length > 0 && mode === 'ask' && (
          <div style={{ padding: '0 24px 24px' }}>
            {askLoading && (
              <div
                data-testid="ask-loading"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '24px 0',
                  color: 'var(--color-muted-foreground)',
                  fontSize: 13,
                }}
              >
                <Loader2
                  style={{
                    width: 15,
                    height: 15,
                    strokeWidth: 2,
                    animation: 'spin 1s linear infinite',
                  }}
                />
                { }
                Searching email...
                { }
              </div>
            )}

            {askError && (
              <div
                data-testid="ask-error"
                style={{
                  padding: '16px 0',
                  fontSize: 13,
                  color: '#b45309',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <AlertTriangle style={{ width: 14, height: 14, strokeWidth: 2, flex: 'none' }} />
                {askError}
              </div>
            )}

            {!askLoading && !askError && askHits.length === 0 && query.trim() && (
              <div
                data-testid="ask-no-results"
                style={{
                  padding: '24px 0',
                  fontSize: 13,
                  color: 'var(--color-muted-foreground)',
                  textAlign: 'center',
                }}
              >
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                No matching email found for your question.
                {/* eslint-enable keepance-i18n/no-hardcoded-string */}
              </div>
            )}

            {!askLoading && !askError && askHits.map((hit, i) => (
              <AskHitCard key={hit.sourceId} hit={hit} rank={i + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const filterInputStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 5,
  border: '1px solid var(--color-border)',
  fontSize: 12,
  color: 'var(--color-foreground)',
  background: '#fff',
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
};
