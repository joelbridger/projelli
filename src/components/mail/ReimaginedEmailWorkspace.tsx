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
import { Button, SearchField, SegmentedToggle, FilterToggle, FilterPanel, Badge, Card, EmptyState, Dropdown } from '@/components/ui/kp';
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

/**
 * Maps a raw backend/provider error to a plain-language message suitable for display.
 * Auth/401 variants become a reconnect prompt; everything else becomes a generic retry message.
 */
function mapMailError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  if (
    lower.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('unauthenticated') ||
    lower.includes('token') ||
    lower.includes('auth')
  ) {
    return "Your email account isn't fully connected. Reconnect it in Settings.";
  }
  // scope_upgrade_required is handled separately at the compose level — don't remap it
  if (lower.includes('scope_upgrade_required')) return msg;
  return 'Something went wrong with that email action. Try again.';
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
          fontSize: 'var(--kp-font-2xs)',
          fontWeight: isPrivileged(privilege) ? 'var(--kp-weight-semibold)' : 'var(--kp-weight-regular)',
          background: isPrivileged(privilege) ? 'rgba(10,37,64,0.08)' : 'transparent',
          color: isPrivileged(privilege) ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
          border: isPrivileged(privilege)
            ? '1px solid rgba(10,37,64,0.18)'
            : '1px solid var(--color-border)',
          cursor: 'pointer',
        }}
      >
        <ShieldCheck style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2 }} />
        {isPrivileged(privilege) ? privilegeLabels[privilege] : 'Privilege'}
        <ChevronDown style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2 }} />
      </button>

      {open && (
        <Dropdown
          style={{
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: 170,
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
                padding: `var(--kp-space-xs) var(--kp-space-sm)`,
                fontSize: 'var(--kp-font-xs)',
                fontWeight: privilege === status ? 'var(--kp-weight-semibold)' : 'var(--kp-weight-regular)',
                color: 'var(--color-foreground)',
                background: privilege === status ? 'rgba(10,37,64,0.04)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {privilegeLabels[status]}
              {privilege === status && (
                <Check style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', color: 'var(--kp-navy)', strokeWidth: 2.5 }} />
              )}
            </button>
          ))}
        </Dropdown>
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
  const [matterSearch, setMatterSearch] = useState('');
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

  const filteredMatters = matterSearch.trim()
    ? matters.filter((m) => matterLabel(m).toLowerCase().includes(matterSearch.toLowerCase()))
    : matters;

  return (
    <Dropdown
      ref={containerRef}
      style={{
        top: 'calc(100% + 4px)',
        right: 0,
        minWidth: 200,
        maxHeight: 300,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      <div style={{ padding: `var(--kp-space-2xs) var(--kp-space-xs)`, borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <SearchField
          size="sm"
          value={matterSearch}
          onChange={(v) => { setMatterSearch(v); }}
          placeholder="Search matters..."
          aria-label="Search matters"
          data-testid="matter-picker-search"
          onClick={(e: React.MouseEvent<HTMLInputElement>) => { e.stopPropagation(); }}
        />
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {fileError && (
          <div
            style={{
              padding: `var(--kp-space-xs) var(--kp-space-sm)`,
              fontSize: 'var(--kp-font-2xs)',
              color: '#b45309',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <AlertTriangle style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2, flex: 'none' }} />
            {fileError}
          </div>
        )}
        {filteredMatters.length === 0 ? (
          <div
            style={{
              padding: `var(--kp-space-sm) var(--kp-space-sm)`,
              fontSize: 'var(--kp-font-xs)',
              color: 'var(--color-muted-foreground)',
            }}
          >
            {matters.length === 0 ? 'No matters yet' : 'No matching matters'}
          </div>
        ) : (
          filteredMatters.map((m) => (
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
              gap: 'var(--kp-space-xs)',
              width: '100%',
              padding: `var(--kp-space-xs) var(--kp-space-sm)`,
              fontSize: 'var(--kp-font-xs)',
              color: 'var(--color-foreground)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            {filing === m.id ? (
              <Loader2 style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2, animation: 'spin 1s linear infinite', flex: 'none' }} />
            ) : (
              <FolderInput style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 1.75, flex: 'none', color: 'var(--color-muted-foreground)' }} />
            )}
            {matterLabel(m)}
          </button>
          ))
        )}
      </div>
    </Dropdown>
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
  const [matterSearch, setMatterSearch] = useState('');
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

  const filteredMatters = matterSearch.trim()
    ? matters.filter((m) => matterLabel(m).toLowerCase().includes(matterSearch.toLowerCase()))
    : matters;

  return (
    <Dropdown
      ref={containerRef}
      style={{
        top: 'calc(100% + 4px)',
        left: 0,
        minWidth: 210,
        maxHeight: 300,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      <div style={{ padding: `var(--kp-space-2xs) var(--kp-space-xs)`, borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <SearchField
          size="sm"
          value={matterSearch}
          onChange={(v) => { setMatterSearch(v); }}
          placeholder="Search matters..."
          aria-label="Search matters"
          data-testid="bulk-matter-picker-search"
          onClick={(e: React.MouseEvent<HTMLInputElement>) => { e.stopPropagation(); }}
        />
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {fileError && (
          <div style={{ padding: `var(--kp-space-xs) var(--kp-space-sm)`, fontSize: 'var(--kp-font-2xs)', color: '#b45309', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <AlertTriangle style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2, flex: 'none' }} />
            {fileError}
          </div>
        )}
        {filteredMatters.length === 0 ? (
          <div style={{ padding: `var(--kp-space-sm) var(--kp-space-sm)`, fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
            {matters.length === 0 ? 'No matters yet' : 'No matching matters'}
          </div>
        ) : (
          filteredMatters.map((m) => (
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
              gap: 'var(--kp-space-xs)',
              width: '100%',
              padding: `var(--kp-space-xs) var(--kp-space-sm)`,
              fontSize: 'var(--kp-font-xs)',
              color: 'var(--color-foreground)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            {filing === m.id ? (
              <Loader2 style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2, animation: 'spin 1s linear infinite', flex: 'none' }} />
            ) : (
              <FolderInput style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 1.75, flex: 'none', color: 'var(--color-muted-foreground)' }} />
            )}
            {matterLabel(m)}
          </button>
          ))
        )}
      </div>
    </Dropdown>
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
  const [focusWithin, setFocusWithin] = useState(false);
  const [privilegeOpen, setPrivilegeOpen] = useState(false);
  const [matterOpen, setMatterOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);

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
    setExportFailed(false);
    try {
      const msg = await mailGetMessage(item.id);
      const to = msg.to.join(', ');
      const cc = msg.cc.length > 0 ? `\nCc: ${msg.cc.join(', ')}` : '';
      const date = msg.date ?? '';
      const content = `Subject: ${msg.subject}\nFrom: ${msg.from}\nTo: ${to}${cc}\nDate: ${date}\n\n${msg.body}`;
      const suggestedName = `${slugify(item.subject) || 'email'}.txt`;
      await onSaveToWorkspace(content, suggestedName);
    } catch {
      setExportFailed(true);
      // Auto-clear after 3 s so the button returns to normal
      setTimeout(() => { setExportFailed(false); }, 3000);
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
        padding: `var(--kp-space-sm) var(--kp-space-md)`,
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
      onFocus={() => { setFocusWithin(true); }}
      onBlur={(e) => {
        // Only clear when focus moves entirely outside the row
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocusWithin(false);
        }
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
          <CheckSquare style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: 'var(--kp-navy)', strokeWidth: 1.75, flex: 'none' }} />
        ) : (
          <Square style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: 'var(--color-muted-foreground)', strokeWidth: 1.75, flex: 'none' }} />
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Row top: subject + date */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span
            style={{
              fontSize: 'var(--kp-font-sm)',
              fontWeight: 'var(--kp-weight-semibold)',
              lineHeight: 'var(--kp-leading-snug)',
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
              fontSize: 'var(--kp-font-2xs)',
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
          <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.fromName ? `${item.fromName} <${item.fromAddr}>` : item.fromAddr}
          </span>
          {item.hasAttachments && (
            <Paperclip style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', color: 'var(--color-muted-foreground)', strokeWidth: 1.75, flex: 'none' }} />
          )}
          {isPrivileged(privilege) && (
            <Badge variant="privilege" size="sm" icon={ShieldCheck}>Privileged</Badge>
          )}
        </div>

        {/* Snippet */}
        {item.snippet && (
          <span
            style={{
              fontSize: 'var(--kp-font-xs)',
              lineHeight: 'var(--kp-leading-normal)',
              color: 'var(--color-muted-foreground)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.snippet}
          </span>
        )}

        {/* Hover / focus-within actions */}
        {(hovered || focusWithin) && (
          <div
            style={{
              position: 'absolute',
              right: 16,
              bottom: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--kp-space-2xs)',
            }}
            onClick={(e) => { e.stopPropagation(); }}
          >
            {/* Open */}
            <Button
              variant="secondary"
              size="sm"
              iconLeft={Mail}
              data-testid={`open-email-${item.id}`}
              onClick={handleOpen}
              title="Open email"
            >
              Open
            </Button>

            {/* File this email to matter (per-message) */}
            <div style={{ position: 'relative' }}>
              <Button
                variant="secondary"
                size="sm"
                iconLeft={FolderInput}
                data-testid={`file-to-matter-${item.id}`}
                onClick={() => { setMatterOpen((o) => !o); }}
                title="File this email to a matter"
              >
                File
              </Button>
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
              <Button
                variant={exportFailed ? 'danger' : 'secondary'}
                size="sm"
                iconLeft={exportFailed ? AlertTriangle : FileDown}
                loading={exporting}
                data-testid={`export-email-${item.id}`}
                onClick={() => { void handleExport(); }}
                disabled={exporting}
                title={exportFailed ? 'Export failed, try again' : 'Export to workspace'}
              >
                {exportFailed ? 'Export failed' : 'Export'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


// ── AskHit card ────────────────────────────────────────────────────────────

interface AskHitCardProps {
  hit: RagHit;
  rank: number;
  /** Pass the loaded keyword items so we can resolve subject from id when available. */
  items: MailListItem[];
}

function AskHitCard({ hit, rank, items }: AskHitCardProps) {
  const sid = hit.sourceId ?? hit.path;
  const rawId = sid.startsWith('mail:') ? sid.slice(5) : sid;

  // Prefer subject from a loaded list item; otherwise fall back to snippet headline
  const matchedItem = items.find((it) => it.id === rawId);
  const title = matchedItem?.subject || hit.chunkText.slice(0, 100);
  const snippet = matchedItem ? hit.chunkText : null;

  const handleOpen = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('keepance:open-email', {
        detail: { sourceId: sid },
      }),
    );
  }, [sid]);

  return (
    <Card
      variant="interactive"
      data-testid="ask-hit-card"
      onClick={handleOpen}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        marginBottom: 'var(--kp-space-xs)',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: snippet ? 4 : 0 }}>
        <span
          style={{
            fontSize: 'var(--kp-font-2xs)',
            fontWeight: 'var(--kp-weight-bold)',
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
            fontSize: 'var(--kp-font-xs)',
            fontWeight: 'var(--kp-weight-semibold)',
            color: 'var(--kp-navy)',
            fontFamily: 'var(--font-sans)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: 'var(--kp-font-2xs)',
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
      {snippet && (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--kp-font-xs)',
            color: 'var(--color-muted-foreground)',
            lineHeight: 'var(--kp-leading-normal)',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {snippet}
        </p>
      )}
      <span
        style={{
          display: 'block',
          marginTop: 4,
          fontSize: 'var(--kp-font-2xs)',
          color: 'var(--color-muted-foreground)',
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          opacity: 0.6,
        }}
      >
        {rawId}
      </span>
    </Card>
  );
}

// ── No-accounts empty state ────────────────────────────────────────────────

interface NoAccountsStateProps {
  onOpenSettings?: (() => void) | undefined;
}

function NoAccountsState({ onOpenSettings }: NoAccountsStateProps) {
  return (
    /* eslint-disable keepance-i18n/no-hardcoded-string */
    <div data-testid="no-accounts-state">
      <EmptyState
        icon={Mail}
        title="No email connected"
        body="Connect your email to search across it, file messages to a matter, and cite them in answers. It is imported to your machine, not our servers."
        actions={
          onOpenSettings ? (
            <Button variant="primary" size="md" onClick={onOpenSettings}>
              Connect your email
            </Button>
          ) : undefined
        }
      />
    </div>
    /* eslint-enable keepance-i18n/no-hardcoded-string */
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
  // Incrementing this forces Effect A to re-run the query (retry on error)
  const [retryCount, setRetryCount] = useState(0);

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
        setError(mapMailError(e));
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
  }, [mode, accountsLoaded, query, providerFilter, dateFrom, dateTo, hasAttachments, retryCount]);

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
        setError(mapMailError(e));
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
      setAskError('Memory (RAG) is not enabled. Enable it in Settings to use AI search.');
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

  const handleRetry = useCallback(() => {
    setError(null);
    setOffset(0);
    setRetryCount((c) => c + 1);
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

  // Fix 7: persist list scroll position per-matter in sessionStorage
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollKey = `email-scroll-${activeMatter?.id ?? 'all'}`;

  // Restore scroll on mount
  useEffect(() => {
    const saved = sessionStorage.getItem(scrollKey);
    if (saved && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = Number(saved);
    }
    // Save scroll on unmount
    const el = scrollContainerRef.current;
    return () => {
      if (el) {
        sessionStorage.setItem(scrollKey, String(el.scrollTop));
      }
    };
  }, [scrollKey]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={scrollContainerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        flex: 1,
        minWidth: 0,
        background: 'var(--color-background)',
        fontFamily: 'var(--font-sans)',
        overflowY: 'auto',
      }}
    >
      {/* Page header */}
      <div
        style={{
          padding: 'var(--kp-surface-header-pad)',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <SurfaceHeader
          Icon={Mail}
          title="Email"
          description="Search, read, and file your imported email."
          actions={
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 'none' }}>
              <Button
                variant="primary"
                size="md"
                iconLeft={PenLine}
                data-testid="compose-btn"
                onClick={() => {
                  setComposeOpen(true);
                  setComposeSendResult('none');
                  setComposeSendError(null);
                  setComposeAttachments([]);
                }}
              >
                New email
              </Button>

              {/* Scope toggle — only when a matter is active AND in Ask AI mode */}
              {activeMatter && mode !== 'keyword' && (
                <SegmentedToggle
                  ariaLabel="Email scope"
                  variant="pill"
                  size="md"
                  options={[
                    { value: 'matter' as const, label: 'This matter' },
                    { value: 'all' as const, label: 'All email' },
                  ]}
                  value={scopeAllEmail ? 'all' : 'matter'}
                  onChange={(v) => {
                    setScopeAllEmail(v === 'all');
                    setOffset(0);
                  }}
                />
              )}
            </div>
          }
        />

        {/* Hero search bar — a mode pill and a clean search field, side by side
            (no nested-border container). */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--kp-space-sm)',
            marginTop: 'var(--kp-surface-gap)',
            marginBottom: 'var(--kp-space-xs)',
            flexWrap: 'wrap',
          }}
        >
          {/* Mode toggle — Keyword | AI search (segmented pill; testids kept for tests) */}
          <div
            className="kp-segmented kp-segmented--md kp-segmented--pill"
            role="group"
            aria-label="Search mode"
            style={{ flex: 'none' }}
          >
            {(['keyword', 'ask'] as const).map((m) => (
              <button
                key={m}
                type="button"
                data-testid={`mode-${m}`}
                className={`kp-segmented__item${mode === m ? ' is-active' : ''}`}
                aria-pressed={mode === m}
                onClick={() => {
                  setMode(m);
                  setQuery('');
                  setOffset(0);
                  setSelectedIds(new Set());
                }}
              >
                {m === 'keyword' ? 'Keyword' : 'AI search'}
              </button>
            ))}
          </div>

          {/* Search input — a normal bordered field */}
          <SearchField
            size="md"
            icon={Search}
            value={query}
            onChange={(v) => {
              setQuery(v);
              setOffset(0);
              setSelectedIds(new Set());
            }}
            onClear={handleClearQuery}
            placeholder={
              mode === 'keyword'
                ? 'Search email by keyword...'
                : 'Search your email with AI...'
            }
            aria-label="Search email"
            data-testid="email-search-input"
            style={{ flex: 1, minWidth: 280 }}
          />
        </div>

        {/* Filters toggle — only when accounts are loaded and in keyword mode */}
        {accountsLoaded && accounts.length > 0 && mode === 'keyword' && (
          <div style={{ marginBottom: 'var(--kp-space-sm)' }}>
            <FilterToggle
              open={filtersVisible}
              onToggle={() => { setFiltersVisible((v) => !v); }}
              count={activeFilterCount}
              label="Filters"
              data-testid="filters-toggle"
            />

            {/* Expanded filter row */}
            {filtersVisible && (
              <FilterPanel data-testid="filter-row">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
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
                      <option value="">All accounts</option>
                      {uniqueProviders.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Date from */}
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
                    From
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
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
                    To
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
                      fontSize: 'var(--kp-font-xs)',
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
                    Has attachment
                  </label>
                </div>
              </FilterPanel>
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
                  margin: `var(--kp-space-md) var(--kp-gutter) var(--kp-space-xs)`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: 'var(--kp-space-xs) var(--kp-space-sm)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(10,37,64,0.18)',
                  background: 'rgba(10,37,64,0.04)',
                  fontSize: 'var(--kp-font-xs)',
                  color: 'var(--kp-navy)',
                  fontWeight: 'var(--kp-weight-medium)',
                }}
              >
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                <span style={{ flex: 1 }}>
                  {selectedIds.size} selected
                </span>
                <div style={{ position: 'relative' }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={FolderInput}
                    iconRight={ChevronDown}
                    data-testid="bulk-file-to-matter"
                    onClick={() => { setBulkMatterOpen((o) => !o); }}
                  >
                    File to matter
                  </Button>
                  <BulkMatterPicker
                    selectedIds={selectedIds}
                    open={bulkMatterOpen}
                    onOpenChange={setBulkMatterOpen}
                    onDone={handleClearSelection}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  iconLeft={X}
                  onClick={handleClearSelection}
                >
                  Clear selection
                </Button>
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
                  padding: `var(--kp-space-2xl) var(--kp-gutter)`,
                  gap: 'var(--kp-space-xs)',
                  color: 'var(--color-muted-foreground)',
                  fontSize: 'var(--kp-font-sm)',
                }}
              >
                <Loader2
                  style={{
                    width: 'var(--kp-icon-md)',
                    height: 'var(--kp-icon-md)',
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
                  padding: `var(--kp-space-2xl) var(--kp-gutter)`,
                  gap: 'var(--kp-space-xs)',
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
                <p style={{ margin: 0, fontSize: 'var(--kp-font-sm)', color: 'var(--color-foreground)', fontWeight: 'var(--kp-weight-medium)' }}>
                  {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                  Could not load email
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                </p>
                <p style={{ margin: 0, fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', maxWidth: 340 }}>
                  {error}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="error-retry"
                  onClick={handleRetry}
                  style={{ marginTop: 4 }}
                >
                  Try again
                </Button>
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
                  padding: `var(--kp-space-2xl) var(--kp-gutter)`,
                  gap: 'var(--kp-space-xs)',
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
                <p style={{ margin: 0, fontSize: 'var(--kp-font-sm)', color: 'var(--color-foreground)', fontWeight: 'var(--kp-weight-medium)' }}>
                  {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                  No emails found
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                </p>
                <p style={{ margin: 0, fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
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
                  margin: `var(--kp-surface-gap) var(--kp-gutter) var(--kp-gutter)`,
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)',
                  background: '#fff',
                  overflow: 'hidden',
                  boxShadow: 'var(--kp-shadow-1)',
                }}
              >
                <div
                  data-testid="result-count"
                  style={{
                    padding: `var(--kp-space-2xs) var(--kp-space-md)`,
                    fontSize: 'var(--kp-font-2xs)',
                    color: 'var(--color-muted-foreground)',
                    borderBottom: '1px solid var(--color-border)',
                    background: 'rgba(10,37,64,0.02)',
                  }}
                >
                  {total === items.length && !query
                    ? 'All email loaded'
                    : `Showing ${String(items.length)} of ${String(total)}`}
                </div>
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
                      padding: `var(--kp-space-sm) var(--kp-space-md)`,
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
                        fontSize: 'var(--kp-font-xs)',
                        fontWeight: 'var(--kp-weight-medium)',
                        color: 'var(--color-foreground)',
                        background: '#fff',
                        border: '1px solid var(--color-border)',
                        cursor: loadingMore ? 'default' : 'pointer',
                      }}
                    >
                      {loadingMore && (
                        <Loader2
                          style={{
                            width: 'var(--kp-icon-xs)',
                            height: 'var(--kp-icon-xs)',
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
          <div style={{ padding: `var(--kp-surface-gap) var(--kp-gutter) var(--kp-gutter)` }}>
            {askLoading && (
              <div
                data-testid="ask-loading"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--kp-space-xs)',
                  padding: `var(--kp-space-lg) 0`,
                  color: 'var(--color-muted-foreground)',
                  fontSize: 'var(--kp-font-sm)',
                }}
              >
                <Loader2
                  style={{
                    width: 'var(--kp-icon-sm)',
                    height: 'var(--kp-icon-sm)',
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
                  padding: `var(--kp-space-md) 0`,
                  fontSize: 'var(--kp-font-sm)',
                  color: '#b45309',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <AlertTriangle style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2, flex: 'none' }} />
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
                  padding: `var(--kp-space-2xl) 0 var(--kp-space-xl)`,
                  gap: 'var(--kp-space-sm)',
                  textAlign: 'center',
                }}
              >
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                <div
                  style={{
                    fontSize: 'var(--kp-font-lg)',
                    fontWeight: 'var(--kp-weight-bold)',
                    lineHeight: 'var(--kp-leading-tight)',
                    color: 'var(--kp-navy)',
                    fontFamily: 'var(--font-sans)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  Search your email
                </div>
                <div
                  style={{
                    fontSize: 'var(--kp-font-sm)',
                    color: 'var(--color-muted-foreground)',
                    maxWidth: 360,
                    lineHeight: 'var(--kp-leading-normal)',
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
                        fontSize: 'var(--kp-font-xs)',
                        fontWeight: 'var(--kp-weight-medium)',
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
                  padding: `var(--kp-space-lg) 0`,
                  fontSize: 'var(--kp-font-sm)',
                  color: 'var(--color-muted-foreground)',
                  textAlign: 'center',
                  lineHeight: 'var(--kp-leading-relaxed)',
                }}
              >
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                {!isMemoryEnabled() ? (
                  <span>
                    AI search needs memory enabled.{' '}
                    <button
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('keepance:open-settings', { detail: { category: 'ai' } }));
                        onOpenSettings?.();
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: 'var(--kp-navy)',
                        fontWeight: 'var(--kp-weight-semibold)',
                        cursor: 'pointer',
                        fontSize: 'inherit',
                        textDecoration: 'underline',
                      }}
                    >
                      Enable it in Settings
                    </button>
                    .
                  </span>
                ) : activeMatter && !scopeAllEmail ? (
                  <span>
                    No email is filed to this matter yet.{' '}
                    <button
                      type="button"
                      data-testid="ask-no-results-switch-scope"
                      onClick={() => { setScopeAllEmail(true); }}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: 'var(--kp-navy)',
                        fontWeight: 'var(--kp-weight-semibold)',
                        cursor: 'pointer',
                        fontSize: 'inherit',
                        textDecoration: 'underline',
                      }}
                    >
                      Switch to All email
                    </button>
                    {' '}above, or file emails to this matter with the File button.
                  </span>
                ) : (
                  'No matching email found for your question.'
                )}
                {/* eslint-enable keepance-i18n/no-hardcoded-string */}
              </div>
            )}

            {!askLoading && !askError && askHits.map((hit, i) => (
              <AskHitCard key={hit.sourceId ?? hit.path} hit={hit} rank={i + 1} items={items} />
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
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--kp-shadow-3)',
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
                padding: `var(--kp-space-sm) var(--kp-card-pad) var(--kp-space-xs)`,
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <span style={{ fontSize: 'var(--kp-font-md)', fontWeight: 'var(--kp-weight-bold)', color: 'var(--kp-navy)', fontFamily: 'var(--font-sans)' }}>
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
                <X style={{ width: 'var(--kp-icon-md)', height: 'var(--kp-icon-md)', strokeWidth: 2 }} />
              </button>
            </div>

            {/* Modal body (scrollable) */}
            <div style={{ flex: 1, overflowY: 'auto', padding: `var(--kp-space-sm) var(--kp-card-pad) var(--kp-card-pad)`, display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-xs)' }}>
              {/* From selector */}
              {accounts.length === 0 ? (
                <div data-testid="compose-no-accounts" style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', padding: '8px 0' }}>
                  Connect an account first in Settings.
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 40, flexShrink: 0, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                    From
                  </span>
                  <select
                    value={`${composeProvider}::${composeAccount}`}
                    onChange={(e) => {
                      const [p = '', a = ''] = e.target.value.split('::');
                      setComposeProvider(p);
                      setComposeAccount(a);
                    }}
                    style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 'var(--kp-font-sm)', fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
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
                <span style={{ width: 40, flexShrink: 0, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                  To
                </span>
                <input
                  type="text"
                  data-testid="compose-to"
                  value={composeTo}
                  onChange={(e) => { setComposeTo(e.target.value); }}
                  placeholder="recipient@example.com"
                  style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 'var(--kp-font-sm)', fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
                />
                <button
                  type="button"
                  data-testid="compose-cc-bcc-toggle"
                  onClick={() => { setComposeCcBccOpen((o) => !o); }}
                  style={{ flexShrink: 0, fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  Cc / Bcc
                </button>
              </div>

              {/* Cc / Bcc */}
              {composeCcBccOpen && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 40, flexShrink: 0, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                      Cc
                    </span>
                    <input
                      type="text"
                      data-testid="compose-cc"
                      value={composeCc}
                      onChange={(e) => { setComposeCc(e.target.value); }}
                      placeholder="cc@example.com"
                      style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 'var(--kp-font-sm)', fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 40, flexShrink: 0, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                      Bcc
                    </span>
                    <input
                      type="text"
                      data-testid="compose-bcc"
                      value={composeBcc}
                      onChange={(e) => { setComposeBcc(e.target.value); }}
                      placeholder="bcc@example.com"
                      style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 'var(--kp-font-sm)', fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
                    />
                  </div>
                </>
              )}

              {/* Subject */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 50, flexShrink: 0, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                  Subject
                </span>
                <input
                  type="text"
                  data-testid="compose-subject"
                  value={composeSubject}
                  onChange={(e) => { setComposeSubject(e.target.value); }}
                  placeholder="Subject"
                  style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 'var(--kp-font-sm)', fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
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
                  fontSize: 'var(--kp-font-sm)',
                  lineHeight: 'var(--kp-leading-normal)',
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
                      fontSize: 'var(--kp-font-xs)',
                      fontWeight: 'var(--kp-weight-medium)',
                      background: 'transparent',
                      color: 'var(--color-muted-foreground)',
                      border: '1px solid var(--color-border)',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    <Paperclip style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2 }} />
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
                          fontSize: 'var(--kp-font-2xs)',
                          background: '#f0f4ff',
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-foreground)',
                          fontFamily: 'var(--font-sans)',
                        }}
                      >
                        <Paperclip style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2, color: 'var(--color-muted-foreground)' }} />
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
                          <X style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2 }} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Send result states */}
              {composeSendResult === 'success' && (
                <div data-testid="compose-success" style={{ fontSize: 'var(--kp-font-xs)', color: '#047857' }}>
                  Email sent
                </div>
              )}
              {composeSendResult === 'error' && composeSendError && (
                <div data-testid="compose-error" style={{ fontSize: 'var(--kp-font-xs)', color: '#b45309', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertTriangle style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2, flex: 'none' }} />
                  {composeSendError}
                </div>
              )}
              {composeSendResult === 'scope_upgrade' && (
                <div data-testid="compose-scope-upgrade" style={{ fontSize: 'var(--kp-font-xs)', color: '#b45309' }}>
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
                        fontSize: 'var(--kp-font-2xs)',
                        fontWeight: 'var(--kp-weight-semibold)',
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
                padding: `var(--kp-space-xs) var(--kp-card-pad)`,
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
                      const msg = e instanceof Error ? e.message : '';
                      if (msg.includes('scope_upgrade_required')) {
                        setComposeSendResult('scope_upgrade');
                      } else {
                        setComposeSendResult('error');
                        setComposeSendError(mapMailError(e));
                      }
                    });
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 18px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--kp-font-sm)',
                  fontWeight: 'var(--kp-weight-semibold)',
                  background: 'var(--kp-navy)',
                  color: '#fff',
                  border: 'none',
                  cursor: composeSending || accounts.length === 0 ? 'default' : 'pointer',
                  opacity: composeSending || accounts.length === 0 ? 0.6 : 1,
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {composeSending && (
                  <Loader2 style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2, animation: 'spin 1s linear infinite' }} />
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
  height: 'var(--kp-control-sm)',
  padding: '0 8px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  fontSize: 'var(--kp-font-xs)',
  color: 'var(--color-foreground)',
  background: '#fff',
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
};
