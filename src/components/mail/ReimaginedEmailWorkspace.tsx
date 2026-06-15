/**
 * ReimaginedEmailWorkspace — full-page email search and browse surface.
 *
 * Two modes:
 *   Search  — debounced mailListMessages() with provider / date / attachment
 *             filters; paginated "Load more" (offset += 50).
 *   Ask AI  — MemoryService.retrieve() scoped to mail: sourceIds; results
 *             ranked by similarity score.
 *
 * Per-row actions: Open (dispatches keepance:open-email), File to matter
 * (popover with matter picker — calls mailRetagMessageMatter per message),
 * Privilege (dropdown), Export (mailGetMessage + onSaveToWorkspace).
 *
 * Privilege is handled by a sub-component (MailRowPrivilege) so the hook
 * can be called per-row without violating the Rules of Hooks.
 *
 * Filter row is hidden by default; a "Filters" toggle shows a badge when
 * any filter is active.
 *
 * In keyword/Search mode the scope toggle is disabled — keyword search covers
 * all email. Scope toggle only works in Ask AI mode.
 *
 * Bulk row selection: checkbox (appears on hover or when any row is selected);
 * a bulk action bar appears when any rows are selected.
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
  Square,
  CheckSquare,
  PenLine,
} from 'lucide-react';
import { useActiveMatter, useMatters } from '@/stores/matterStore';
import { usePrivilegeStore, usePrivilegeForSource } from '@/stores/privilegeStore';
import {
  mailListMessages,
  mailGetMessage,
  mailConnectedAccounts,
  mailRetagFolderMatter,
  mailRetagMessageMatter,
  mailSend,
  type MailListItem,
  type ConnectedAccount,
  type MailAttachmentInput,
} from '@/utils/mail-commands';
import { MemoryService, isMemoryEnabled } from '@/modules/memory/MemoryService';
import { ALL_PRIVILEGE_STATUSES, isPrivileged, type Privilege } from '@/types/privilege';
import type { RagHit, RetrievalScope } from '@/utils/tauri-commands';
import { matterLabel } from '@/modules/memory/matterResolver';
import { SurfaceHeader } from '@/components/layout/SurfaceHeader';

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

function parseRecipients(raw: string): string[] {
  return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Outside click handler to close the dropdown
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => { document.removeEventListener('mousedown', handler); };
  }, [open, onOpenChange]);

  const privilegeLabels: Record<Privilege, string> = {
    none: 'Not privileged',
    'attorney-client': 'Attorney-Client',
    'work-product': 'Work Product',
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
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
  /** 'message' = retag this single message; 'folder' = retag the whole folder. */
  mode?: 'message' | 'folder';
}

function MatterPickerPopover({ item, open, onOpenChange, onDone, mode = 'message' }: MatterPickerProps) {
  const matters = useMatters();
  const [filing, setFiling] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Outside click handler
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => { document.removeEventListener('mousedown', handler); };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
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
        maxHeight: 260,
        overflowY: 'auto',
      }}
    >
      {/* eslint-disable keepance-i18n/no-hardcoded-string */}
      {fileError && (
        <div
          style={{
            padding: '8px 12px',
            fontSize: 11,
            color: '#b45309',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <AlertTriangle style={{ width: 11, height: 11, strokeWidth: 2, flex: 'none' }} />
          {fileError}
        </div>
      )}
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
              setFileError(null);
              const promise = mode === 'message'
                ? mailRetagMessageMatter(item.id, m.id)
                : mailRetagFolderMatter(item.provider, item.account, item.folderId, m.id);
              void promise
                .then(() => {
                  setFiling(null);
                  onOpenChange(false);
                  onDone();
                })
                .catch((err: unknown) => {
                  setFiling(null);
                  setFileError(err instanceof Error ? err.message : 'Failed to file email. Please try again.');
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

// ── BulkMatterPicker ───────────────────────────────────────────────────────

interface BulkMatterPickerProps {
  selectedIds: Set<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

function BulkMatterPicker({ selectedIds, open, onOpenChange, onDone }: BulkMatterPickerProps) {
  const matters = useMatters();
  const [filing, setFiling] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => { document.removeEventListener('mousedown', handler); };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 'calc(100% + 4px)',
        left: 0,
        zIndex: 60,
        background: '#fff',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        minWidth: 210,
        maxHeight: 260,
        overflowY: 'auto',
      }}
    >
      {/* eslint-disable keepance-i18n/no-hardcoded-string */}
      {fileError && (
        <div style={{ padding: '8px 12px', fontSize: 11, color: '#b45309', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <AlertTriangle style={{ width: 11, height: 11, strokeWidth: 2, flex: 'none' }} />
          {fileError}
        </div>
      )}
      {matters.length === 0 ? (
        <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--color-muted-foreground)' }}>
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
              const matterId = m.id;
              setFiling(matterId);
              setFileError(null);
              void (async () => {
                try {
                  await Promise.all(Array.from(selectedIds).map((id) => mailRetagMessageMatter(id, matterId)));
                  setFiling(null);
                  onOpenChange(false);
                  onDone();
                } catch (err: unknown) {
                  setFiling(null);
                  setFileError(err instanceof Error ? err.message : 'Failed to file emails. Please try again.');
                }
              })();
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
  selected: boolean;
  anySelected: boolean;
  onToggleSelect: (id: string) => void;
  onSaveToWorkspace?: ((content: string, suggestedName: string) => Promise<void>) | undefined;
}

function MailRow({ item, selected, anySelected, onToggleSelect, onSaveToWorkspace }: MailRowProps) {
  const [hovered, setHovered] = useState(false);
  const [privilegeOpen, setPrivilegeOpen] = useState(false);
  const [matterOpen, setMatterOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleOpen = useCallback(() => {
    const sourceId = `mail:${item.id}`;
    window.dispatchEvent(
      new CustomEvent('keepance:open-email', {
        detail: { sourceId },
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

  const showCheckbox = hovered || anySelected || selected;

  return (
    <div
      data-testid="mail-row"
      role="button"
      tabIndex={0}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: '11px 20px',
        borderBottom: '1px solid var(--color-border)',
        background: selected
          ? 'rgba(10,37,64,0.04)'
          : hovered
          ? 'rgba(10,37,64,0.02)'
          : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.1s',
      }}
      onMouseEnter={() => { setHovered(true); }}
      onMouseLeave={() => {
        setHovered(false);
        setPrivilegeOpen(false);
        setMatterOpen(false);
      }}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      }}
    >
      {/* Checkbox column */}
      <div
        style={{
          width: showCheckbox ? 28 : 0,
          overflow: 'hidden',
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          paddingTop: 2,
          transition: 'width 0.1s',
        }}
        onClick={(e) => { e.stopPropagation(); onToggleSelect(item.id); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelect(item.id);
          }
        }}
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select ${item.subject}`}
        tabIndex={showCheckbox ? 0 : -1}
      >
        {selected ? (
          <CheckSquare style={{ width: 15, height: 15, color: 'var(--kp-navy)', strokeWidth: 1.75, flex: 'none' }} />
        ) : (
          <Square style={{ width: 15, height: 15, color: 'var(--color-muted-foreground)', strokeWidth: 1.75, flex: 'none' }} />
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
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

            {/* File this email to matter (per-message) */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                data-testid={`file-to-matter-${item.id}`}
                onClick={() => { setMatterOpen((o) => !o); }}
                style={actionBtnStyle}
                title="File this email to a matter"
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
                mode="message"
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
          maxWidth: 340,
          lineHeight: 1.6,
        }}
      >
        Connect your email to search across it, file messages to a matter, and cite them in answers. It is imported to your machine, not our servers.
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

  // Scope toggle: "This matter" vs "All email" — only effective in Ask AI mode
  const [scopeAllEmail, setScopeAllEmail] = useState(false);

  // Mode toggle: "keyword" (shows as "Search") vs "ask" (shows as "Ask AI")
  const [mode, setMode] = useState<'keyword' | 'ask'>('keyword');

  // Filter row visibility (collapsed by default)
  const [filtersVisible, setFiltersVisible] = useState(false);

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

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMatterOpen, setBulkMatterOpen] = useState(false);

  // Compose state
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeProvider, setComposeProvider] = useState('');
  const [composeAccount, setComposeAccount] = useState('');
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeBcc, setComposeBcc] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeCcBccOpen, setComposeCcBccOpen] = useState(false);
  const [composeSending, setComposeSending] = useState(false);
  const [composeSendResult, setComposeSendResult] = useState<'none' | 'success' | 'error' | 'scope_upgrade'>('none');
  const [composeSendError, setComposeSendError] = useState<string | null>(null);
  const [composeAttachments, setComposeAttachments] = useState<MailAttachmentInput[]>([]);
  const attachFileRef = useRef<HTMLInputElement>(null);

  // Debounce ref and request fingerprint tracking
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef(0);
  // Fingerprint tracks query/filter params (not offset) to detect filter changes in Effect B
  const queryFingerprintRef = useRef('');

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

  // Auto-select first account when compose opens and accounts are available
  useEffect(() => {
    if (composeOpen && composeProvider === '' && accounts.length > 0) {
      const first = accounts[0];
      if (first) {
        setComposeProvider(first.provider);
        setComposeAccount(first.account);
      }
    }
  }, [composeOpen, accounts, composeProvider]);

  // Effect A: fires on query/filter param changes (debounced 200ms, resets offset to 0)
  useEffect(() => {
    if (mode !== 'keyword') return;
    if (!accountsLoaded) return;

    // Update fingerprint for current filter params
    const fingerprint = JSON.stringify({ query, providerFilter, dateFrom, dateTo, hasAttachments, mode });
    queryFingerprintRef.current = fingerprint;

    const thisQuery = ++latestQueryRef.current;

    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => { void (async () => {
      // Reset to first page when filters change
      setOffset(0);
      setLoading(true);
      setError(null);

      try {
        const listQuery: Parameters<typeof mailListMessages>[0] = {
          sortBy: 'date',
          sortDesc: true,
          limit: 50,
          offset: 0,
        };
        if (query) listQuery.keyword = query;
        if (providerFilter) listQuery.provider = providerFilter;
        if (dateFrom) listQuery.dateFrom = dateFrom;
        // Ensure dateTo is end-of-day inclusive when it's a date-only string
        if (dateTo) {
          listQuery.dateTo = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59.999Z`;
        }
        if (hasAttachments) listQuery.hasAttachments = true;

        const result = await mailListMessages(listQuery);

        if (latestQueryRef.current !== thisQuery) return;

        setItems(result.items);
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
  }, [mode, accountsLoaded, query, providerFilter, dateFrom, dateTo, hasAttachments]);

  // Effect B: fires immediately when offset > 0 (load-more), but only if the
  // fingerprint hasn't changed (i.e., purely a pagination action, not a filter change).
  useEffect(() => {
    if (offset === 0) return; // first page is handled by Effect A
    if (mode !== 'keyword') return;
    if (!accountsLoaded) return;

    // Check that fingerprint matches current filter state — if not, Effect A handles it
    const currentFingerprint = JSON.stringify({ query, providerFilter, dateFrom, dateTo, hasAttachments, mode });
    if (currentFingerprint !== queryFingerprintRef.current) return;

    const thisQuery = ++latestQueryRef.current;
    setLoadingMore(true);
    setError(null);

    void (async () => {
      try {
        const listQuery: Parameters<typeof mailListMessages>[0] = {
          sortBy: 'date',
          sortDesc: true,
          limit: 50,
          offset,
        };
        if (query) listQuery.keyword = query;
        if (providerFilter) listQuery.provider = providerFilter;
        if (dateFrom) listQuery.dateFrom = dateFrom;
        if (dateTo) {
          listQuery.dateTo = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59.999Z`;
        }
        if (hasAttachments) listQuery.hasAttachments = true;

        const result = await mailListMessages(listQuery);

        if (latestQueryRef.current !== thisQuery) return;

        setItems((prev) => [...prev, ...result.items]);
        setTotal(result.total);
      } catch (e: unknown) {
        if (latestQueryRef.current !== thisQuery) return;
        setError(
          e instanceof Error ? e.message : 'Failed to load emails. Please try again.',
        );
      } finally {
        if (latestQueryRef.current === thisQuery) {
          setLoadingMore(false);
        }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  // Ask mode search
  useEffect(() => {
    if (mode !== 'ask') return;
    if (!query.trim()) {
      setAskHits([]);
      return;
    }
    if (!isMemoryEnabled()) {
      setAskError('Memory (RAG) is not enabled. Enable it in Settings to use Ask AI mode.');
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

  // Reset offset + selection when filters change
  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setOffset(0);
    setSelectedIds(new Set());
  }, []);

  const handleProviderChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setProviderFilter(e.target.value);
    setOffset(0);
    setSelectedIds(new Set());
  }, []);

  const handleDateFromChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDateFrom(e.target.value);
    setOffset(0);
    setSelectedIds(new Set());
  }, []);

  const handleDateToChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDateTo(e.target.value);
    setOffset(0);
    setSelectedIds(new Set());
  }, []);

  const handleAttachmentToggle = useCallback(() => {
    setHasAttachments((v) => !v);
    setOffset(0);
    setSelectedIds(new Set());
  }, []);

  const handleLoadMore = useCallback(() => {
    setOffset((o) => o + 50);
  }, []);

  const handleClearQuery = useCallback(() => {
    setQuery('');
    setOffset(0);
    setSelectedIds(new Set());
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const uniqueProviders = Array.from(new Set(accounts.map((a) => a.provider)));

  // Active filter count for badge
  const activeFilterCount = [providerFilter, dateFrom, dateTo, hasAttachments].filter(Boolean).length;

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
        <SurfaceHeader
          Icon={Mail}
          title="Email"
          description="Search, read, and file your email."
          actions={
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 'none' }}>
              <button
                type="button"
                data-testid="compose-btn"
                onClick={() => {
                  setComposeOpen(true);
                  setComposeSendResult('none');
                  setComposeSendError(null);
                  setComposeAttachments([]);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'var(--kp-navy)',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                <PenLine style={{ width: 13, height: 13, strokeWidth: 2 }} />
                {' '}New email{' '}
              </button>

              {/* Scope toggle — only when a matter is active AND in Ask AI mode */}
              {activeMatter && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      background: mode === 'keyword' ? 'rgba(10,37,64,0.03)' : 'rgba(10,37,64,0.05)',
                      borderRadius: 6,
                      padding: 2,
                      gap: 2,
                      opacity: mode === 'keyword' ? 0.5 : 1,
                      pointerEvents: mode === 'keyword' ? 'none' : 'auto',
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
                        disabled={mode === 'keyword'}
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
                          cursor: mode === 'keyword' ? 'default' : 'pointer',
                          boxShadow: scopeAllEmail === all ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                          transition: 'all 0.1s',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                    { }
                  </div>
                  {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                  {mode === 'keyword' && (
                    <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      Keyword search covers all email. Use Ask AI for matter scope.
                    </span>
                  )}
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                </div>
              )}
            </div>
          }
        />

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
            marginBottom: 8,
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
                  setSelectedIds(new Set());
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
                { }
                {m === 'keyword' ? 'Search' : 'Ask AI'}
                { }
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
                : 'Ask about your email...'
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
              minWidth: 0,
            }}
          />

          {/* Clear */}
          {query && (
            <button
              type="button"
              aria-label="Clear search"
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

        {/* Filters toggle — only when accounts are loaded and in keyword mode */}
        {accountsLoaded && accounts.length > 0 && mode === 'keyword' && (
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              data-testid="filters-toggle"
              onClick={() => { setFiltersVisible((v) => !v); }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 5,
                fontSize: 11,
                fontWeight: 500,
                color: activeFilterCount > 0 ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
                background: activeFilterCount > 0 ? 'rgba(10,37,64,0.06)' : 'transparent',
                border: '1px solid var(--color-border)',
                cursor: 'pointer',
              }}
            >
              <Filter style={{ width: 11, height: 11, strokeWidth: 1.75 }} />
              { }
              Filters
              {activeFilterCount > 0 && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 15,
                    height: 15,
                    borderRadius: '50%',
                    background: 'var(--kp-navy)',
                    color: '#fff',
                    fontSize: 9,
                    fontWeight: 700,
                  }}
                >
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown
                style={{
                  width: 10,
                  height: 10,
                  strokeWidth: 2,
                  transform: filtersVisible ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.15s',
                }}
              />
              { }
            </button>

            {/* Expanded filter row */}
            {filtersVisible && (
              <div
                data-testid="filter-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginTop: 8,
                  flexWrap: 'wrap',
                }}
              >
                {/* Provider filter */}
                {uniqueProviders.length > 1 && (
                  <select
                    data-testid="provider-filter"
                    value={providerFilter}
                    onChange={handleProviderChange}
                    aria-label="Filter by provider"
                    style={filterInputStyle}
                  >
                    { }
                    { }
                    <option value="">All accounts</option>
                    { }
                    {uniqueProviders.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                    { }
                  </select>
                )}

                {/* Date from */}
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-muted-foreground)' }}>
                  { }
                  From
                  { }
                  <input
                    type="date"
                    data-testid="date-from"
                    value={dateFrom}
                    onChange={handleDateFromChange}
                    aria-label="From date"
                    style={filterInputStyle}
                  />
                </label>

                {/* Date to */}
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-muted-foreground)' }}>
                  { }
                  To
                  { }
                  <input
                    type="date"
                    data-testid="date-to"
                    value={dateTo}
                    onChange={handleDateToChange}
                    aria-label="To date"
                    style={filterInputStyle}
                  />
                </label>

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
                  { }
                  Has attachment
                  { }
                  { }
                </label>
              </div>
            )}
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
            {/* Bulk action bar */}
            {selectedIds.size > 0 && (
              <div
                data-testid="bulk-action-bar"
                style={{
                  margin: '0 24px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 14px',
                  borderRadius: 6,
                  border: '1px solid rgba(10,37,64,0.18)',
                  background: 'rgba(10,37,64,0.04)',
                  fontSize: 12,
                  color: 'var(--kp-navy)',
                  fontWeight: 500,
                }}
              >
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                <span style={{ flex: 1 }}>
                  {selectedIds.size} selected
                </span>
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    data-testid="bulk-file-to-matter"
                    onClick={() => { setBulkMatterOpen((o) => !o); }}
                    style={actionBtnStyle}
                  >
                    <FolderInput style={{ width: 12, height: 12, strokeWidth: 1.75 }} />
                    File to matter
                    <ChevronDown style={{ width: 10, height: 10, strokeWidth: 2 }} />
                  </button>
                  <BulkMatterPicker
                    selectedIds={selectedIds}
                    open={bulkMatterOpen}
                    onOpenChange={setBulkMatterOpen}
                    onDone={handleClearSelection}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--color-muted-foreground)',
                    background: 'transparent',
                    border: '1px solid var(--color-border)',
                    cursor: 'pointer',
                  }}
                >
                  <X style={{ width: 11, height: 11, strokeWidth: 2 }} />
                  Clear selection
                </button>
                {/* eslint-enable keepance-i18n/no-hardcoded-string */}
              </div>
            )}

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
                { }
                Loading email...
                { }
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
                    selected={selectedIds.has(item.id)}
                    anySelected={selectedIds.size > 0}
                    onToggleSelect={handleToggleSelect}
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
                      { }
                      {loadingMore ? 'Loading...' : `Load more (${String(total - items.length)} remaining)`}
                      { }
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
                { }
                Searching email...
                { }
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

            {/* Ask AI empty state — no query typed yet */}
            {!askLoading && !askError && !query.trim() && (
              <div
                data-testid="ask-empty-state"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '48px 24px 32px',
                  gap: 12,
                  textAlign: 'center',
                }}
              >
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: 'var(--kp-navy)',
                    fontFamily: 'var(--font-sans)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  Ask about your email
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--color-muted-foreground)',
                    maxWidth: 360,
                    lineHeight: 1.55,
                  }}
                >
                  I search across your imported email and answer with citations you can open.
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  {[
                    'Who emailed about the deposition?',
                    'Find emails with attachments from opposing counsel',
                    'What did the client agree to over email?',
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      data-testid="ask-chip"
                      onClick={() => {
                        setQuery(chip);
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '6px 12px',
                        borderRadius: 20,
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--kp-navy)',
                        background: 'rgba(10,37,64,0.05)',
                        border: '1px solid rgba(10,37,64,0.14)',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-sans)',
                        transition: 'background 0.1s, border-color 0.1s',
                        textAlign: 'left',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(10,37,64,0.09)';
                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(10,37,64,0.22)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(10,37,64,0.05)';
                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(10,37,64,0.14)';
                      }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
                {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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
              <AskHitCard key={hit.sourceId ?? hit.path} hit={hit} rank={i + 1} />
            ))}
          </div>
        )}
      </div>

      {/* Compose modal */}
      {composeOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setComposeOpen(false);
            }
          }}
        >
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}
          <div
            style={{
              background: '#fff',
              borderRadius: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              width: 560,
              maxWidth: '95vw',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Modal header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px 10px',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--kp-navy)', fontFamily: 'var(--font-sans)' }}>
                New email
              </span>
              <button
                type="button"
                data-testid="compose-close"
                onClick={() => { setComposeOpen(false); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: 4,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-muted-foreground)',
                  borderRadius: 4,
                }}
              >
                <X style={{ width: 16, height: 16, strokeWidth: 2 }} />
              </button>
            </div>

            {/* Modal body (scrollable) */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* From selector */}
              {accounts.length === 0 ? (
                <div data-testid="compose-no-accounts" style={{ fontSize: 12, color: 'var(--color-muted-foreground)', padding: '8px 0' }}>
                  Connect an account first in Settings.
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 40, flexShrink: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                    From
                  </span>
                  <select
                    value={`${composeProvider}::${composeAccount}`}
                    onChange={(e) => {
                      const [p = '', a = ''] = e.target.value.split('::');
                      setComposeProvider(p);
                      setComposeAccount(a);
                    }}
                    style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 13, fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
                  >
                    {accounts.map((acc) => (
                      <option key={`${acc.provider}::${acc.account}`} value={`${acc.provider}::${acc.account}`}>
                        {acc.label} ({acc.account})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* To field */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 40, flexShrink: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                  To
                </span>
                <input
                  type="text"
                  data-testid="compose-to"
                  value={composeTo}
                  onChange={(e) => { setComposeTo(e.target.value); }}
                  placeholder="recipient@example.com"
                  style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 13, fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
                />
                <button
                  type="button"
                  data-testid="compose-cc-bcc-toggle"
                  onClick={() => { setComposeCcBccOpen((o) => !o); }}
                  style={{ flexShrink: 0, fontSize: 11, color: 'var(--color-muted-foreground)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  Cc / Bcc
                </button>
              </div>

              {/* Cc / Bcc */}
              {composeCcBccOpen && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 40, flexShrink: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                      Cc
                    </span>
                    <input
                      type="text"
                      data-testid="compose-cc"
                      value={composeCc}
                      onChange={(e) => { setComposeCc(e.target.value); }}
                      placeholder="cc@example.com"
                      style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 13, fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 40, flexShrink: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                      Bcc
                    </span>
                    <input
                      type="text"
                      data-testid="compose-bcc"
                      value={composeBcc}
                      onChange={(e) => { setComposeBcc(e.target.value); }}
                      placeholder="bcc@example.com"
                      style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 13, fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
                    />
                  </div>
                </>
              )}

              {/* Subject */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 50, flexShrink: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                  Subject
                </span>
                <input
                  type="text"
                  data-testid="compose-subject"
                  value={composeSubject}
                  onChange={(e) => { setComposeSubject(e.target.value); }}
                  placeholder="Subject"
                  style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 13, fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
                />
              </div>

              {/* Body */}
              <textarea
                data-testid="compose-body"
                value={composeBody}
                onChange={(e) => { setComposeBody(e.target.value); }}
                placeholder="Write your message..."
                rows={10}
                style={{
                  width: '100%',
                  border: '1px solid var(--color-border)',
                  borderRadius: 5,
                  padding: '8px',
                  fontSize: 13,
                  fontFamily: 'var(--font-sans)',
                  background: '#fff',
                  color: 'var(--color-foreground)',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />

              {/* Attachments */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    data-testid="compose-attach"
                    onClick={() => { attachFileRef.current?.click(); }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '4px 10px',
                      borderRadius: 5,
                      fontSize: 12,
                      fontWeight: 500,
                      background: 'transparent',
                      color: 'var(--color-muted-foreground)',
                      border: '1px solid var(--color-border)',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    <Paperclip style={{ width: 12, height: 12, strokeWidth: 2 }} />
                    Attach
                  </button>
                  <input
                    ref={attachFileRef}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    data-testid="compose-attach-input"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      files.forEach((file) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                          const dataUrl = reader.result as string;
                          // dataUrl is "data:<mime>;base64,<data>"
                          const b64 = dataUrl.split(',')[1] ?? '';
                          setComposeAttachments((prev) => [
                            ...prev,
                            { name: file.name, contentBase64: b64, contentType: file.type || 'application/octet-stream' },
                          ]);
                        };
                        reader.readAsDataURL(file);
                      });
                      // Reset so the same file can be re-added after removal
                      e.target.value = '';
                    }}
                  />
                </div>
                {composeAttachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {composeAttachments.map((att, idx) => (
                      <div
                        key={`${att.name}-${String(idx)}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          background: '#f0f4ff',
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-foreground)',
                          fontFamily: 'var(--font-sans)',
                        }}
                      >
                        <Paperclip style={{ width: 10, height: 10, strokeWidth: 2, color: 'var(--color-muted-foreground)' }} />
                        <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {att.name}
                        </span>
                        <button
                          type="button"
                          data-testid={`compose-remove-attachment-${String(idx)}`}
                          onClick={() => {
                            setComposeAttachments((prev) => prev.filter((_, i) => i !== idx));
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                            display: 'flex',
                            color: 'var(--color-muted-foreground)',
                          }}
                        >
                          <X style={{ width: 10, height: 10, strokeWidth: 2 }} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Send result states */}
              {composeSendResult === 'success' && (
                <div data-testid="compose-success" style={{ fontSize: 12, color: '#047857' }}>
                  Email sent
                </div>
              )}
              {composeSendResult === 'error' && composeSendError && (
                <div data-testid="compose-error" style={{ fontSize: 12, color: '#b45309', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertTriangle style={{ width: 12, height: 12, strokeWidth: 2, flex: 'none' }} />
                  {composeSendError}
                </div>
              )}
              {composeSendResult === 'scope_upgrade' && (
                <div data-testid="compose-scope-upgrade" style={{ fontSize: 12, color: '#b45309' }}>
                  Sending needs a one-time reconnect for the send permission. Go to Settings to reconnect your email.
                  {onOpenSettings && (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      style={{
                        display: 'block',
                        marginTop: 6,
                        padding: '4px 10px',
                        borderRadius: 5,
                        fontSize: 11,
                        fontWeight: 600,
                        background: 'transparent',
                        color: 'var(--kp-navy)',
                        border: '1px solid var(--color-border)',
                        cursor: 'pointer',
                      }}
                    >
                      Go to Settings
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div
              style={{
                padding: '10px 18px',
                borderTop: '1px solid var(--color-border)',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button
                type="button"
                data-testid="compose-send"
                disabled={composeSending || accounts.length === 0}
                onClick={() => {
                  const toArr = parseRecipients(composeTo);
                  const ccArr = parseRecipients(composeCc);
                  const bccArr = parseRecipients(composeBcc);
                  setComposeSending(true);
                  setComposeSendResult('none');
                  setComposeSendError(null);
                  void mailSend(composeProvider, composeAccount, toArr, ccArr, bccArr, composeSubject, composeBody, undefined, composeAttachments.length > 0 ? composeAttachments : undefined)
                    .then(() => {
                      setComposeSending(false);
                      setComposeSendResult('success');
                      setTimeout(() => {
                        setComposeOpen(false);
                        setComposeTo('');
                        setComposeCc('');
                        setComposeBcc('');
                        setComposeSubject('');
                        setComposeBody('');
                        setComposeCcBccOpen(false);
                        setComposeSendResult('none');
                        setComposeSendError(null);
                        setComposeAttachments([]);
                      }, 1500);
                    })
                    .catch((e: unknown) => {
                      setComposeSending(false);
                      if (e instanceof Error && e.message.includes('scope_upgrade_required')) {
                        setComposeSendResult('scope_upgrade');
                      } else {
                        setComposeSendResult('error');
                        setComposeSendError(e instanceof Error ? e.message : 'Failed to send email.');
                      }
                    });
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 18px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  background: 'var(--kp-navy)',
                  color: '#fff',
                  border: 'none',
                  cursor: composeSending || accounts.length === 0 ? 'default' : 'pointer',
                  opacity: composeSending || accounts.length === 0 ? 0.6 : 1,
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {composeSending && (
                  <Loader2 style={{ width: 13, height: 13, strokeWidth: 2, animation: 'spin 1s linear infinite' }} />
                )}
                Send
              </button>
            </div>
          </div>
          {/* eslint-enable keepance-i18n/no-hardcoded-string */}
        </div>
      )}
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
