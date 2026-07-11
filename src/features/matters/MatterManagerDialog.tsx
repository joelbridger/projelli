/**
 * MatterManagerDialog (WS-B/C app) — create, rename, delete matters and map
 * each matter to one or more workspace folders.
 *
 * A matter maps to one or more folders; any file under a mapped folder belongs
 * to the matter, and indexing tags those files with the matter id. Changing a
 * mapping re-indexes the affected files (handled by useMemoryWiring's
 * subscription to the matter store).
 *
 * Light theme, navy accent, lean. Folder mapping is done by checking folders
 * from the current workspace tree — the simplest real model (folder = matter).
 *
 * Phase 1 (Task 3) additions:
 *   - "Share with my firm" action on unshared matters (firm session required).
 *   - "Shared matters I can access" section to open remote matters.
 *   - Member roster per shared matter with invite-by-email and remove.
 *   - Sync badge in MatterScopeSelector reads from matterSyncStore.
 *   - All firm UI is invisible when no firm session is active.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Briefcase,
  FileText,
  FolderOpen,
  Mail,
  Trash2,
  Check,
  ShieldAlert,
  ShieldCheck,
  Users,
  Share2,
  LogOut,
  RefreshCw,
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { cn } from '@/lib/utils';
import { useMatters, useActiveMatters, useArchivedMatters, useMatterStore, SAMPLE_MATTER_ID } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { mailConnectedAccounts, type ConnectedAccount } from '@/platform/utils/mail-commands';
import { mailFolderKey, matterLabel } from '@/platform/rag/matterResolver';
import { useFirm } from '@/platform/hooks/useFirm';
import { useFirmStore } from '@/platform/firm/firmStore';
import { obtainMatterKey } from '@/platform/firm/matterKeyService';
import { registerDevice } from '@/platform/firm/deviceKeys';
import type { MatterMineSummary } from '@/platform/firm/contract';
import { parseMatterHandle } from '@/platform/firm/contract';
import { openMatterNotes } from '@/features/matters/logic/openMatterNotes';
import { stopMatterSync } from '@/features/matters/logic/matterNotesSync';
import { promoteMatterToShared } from '@/features/matters/logic/promoteMatterToShared';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import {
  collectFolderPaths,
  relLabel,
  audit,
  folderPathsMatch,
} from './matterManagerDialogHelpers';
import { MemberRoster } from './MemberRoster';

export interface MatterManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * When set, the dialog opens with this client expanded (the "Client settings"
   * row-menu entry passes the client's id). Other clients stay collapsed so the
   * dialog is a clean scannable list, never a wall of every client's details.
   */
  focusMatterId?: string | null;
}

/** Label for a firm matter-share role badge (literal keys per branch — the
 *  i18n extractor can't trace a template-literal key built from `m.role`). */
function firmRoleBadgeLabel(role: 'owner' | 'editor' | 'viewer', t: (key: string) => string): string {
  switch (role) {
    case 'owner':
      return t('matter.manager.firm-owner-badge');
    case 'editor':
      return t('matter.manager.firm-editor-badge');
    case 'viewer':
      return t('matter.manager.firm-viewer-badge');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main dialog
// ────────────────────────────────────────────────────────────────────────────

export function MatterManagerDialog({ open, onOpenChange, focusMatterId }: MatterManagerDialogProps) {
  const { t } = useTranslation();
  const entityLabel = useEntityLabel();
  const matters = useMatters();
  const activeMatters = useActiveMatters();
  const archivedMatters = useArchivedMatters();
  const {
    createMatter,
    renameMatter,
    deleteMatter,
    addFolderPath,
    removeFolderPath,
    addMailFolderPath,
    removeMailFolderPath,
    setMatterPrivileged,
    setMatterMcpAccess,
    setMatterArchived,
    unlinkFirmMatter,
  } = useMatterStore();

  // In-app confirm dialog (native window.confirm is dead + returns a truthy
  // object in the Tauri WebView2 build, so a bare window.confirm() would delete
  // the matter without the user ever seeing a prompt).
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  // Archive section collapse state
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const fileTree = useWorkspaceStore((s) => s.fileTree);

  // Firm session
  const firm = useFirm();
  const getClient = useFirmStore((s) => s.client);
  const seatToken = useFirmStore((s) => s.seatToken);
  const firmSession = firm.isSignedIn && firm.hasActiveSeat;

  const folderPaths = useMemo(() => collectFolderPaths(fileTree), [fileTree]);

  // Connected mail accounts offered for an account-level mail -> matter mapping.
  const [mailAccounts, setMailAccounts] = useState<ConnectedAccount[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    mailConnectedAccounts()
      .then((accts) => {
        if (!cancelled) setMailAccounts(accts);
      })
      .catch(() => {
        /* no mail accounts / browser mode — leave empty */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Remote shared matters (from /matter/mine) that are not yet linked locally
  const [remoteMineMatters, setRemoteMineMatters] = useState<MatterMineSummary[]>([]);
  const [mineLoading, setMineLoading] = useState(false);

  const loadMineMatters = useCallback(async () => {
    if (!firmSession || !seatToken) return;
    setMineLoading(true);
    try {
      const res = await getClient().matterMine(seatToken);
      // Filter to only those not already linked locally
      const linkedFirmIds = new Set(
        matters.filter((m) => m.firmMatterId).map((m) => m.firmMatterId ?? ''),
      );
      setRemoteMineMatters(res.matters.filter((m) => !linkedFirmIds.has(m.matter_handle)));
    } catch {
      setRemoteMineMatters([]);
    } finally {
      setMineLoading(false);
    }
  }, [firmSession, seatToken, getClient, matters]);

  useEffect(() => {
    if (open && firmSession) {
      void loadMineMatters();
    }
  }, [open, firmSession, loadMineMatters]);

  // Accordion: which client's settings are expanded. Only one at a time keeps
  // the dialog a calm, scannable list instead of a wall of every client's
  // details. Seeded from `focusMatterId` when the dialog is opened focused on a
  // specific client (the row-menu "Client settings" path).
  const [expandedMatterId, setExpandedMatterId] = useState<string | null>(
    focusMatterId ?? null,
  );
  // Re-seed the expanded client each time the dialog opens (or the focus
  // target changes), so re-opening "Client settings" for a different client
  // lands on that client.
  useEffect(() => {
    if (open) setExpandedMatterId(focusMatterId ?? null);
  }, [open, focusMatterId]);

  // Isolation UX: pending confirmation for a specific matter, and set of
  // matters that have just been isolated (show affirmation briefly).
  const [isolateConfirmId, setIsolateConfirmId] = useState<string | null>(null);
  const [isolatedAffirmationIds, setIsolatedAffirmationIds] = useState<Set<string>>(new Set());

  /** Called when the user confirms isolation for a specific matter. */
  const confirmIsolate = (matterId: string) => {
    setMatterPrivileged(matterId, true);
    setIsolateConfirmId(null);
    // Show the affirmation callout for 4 s, then fade it.
    setIsolatedAffirmationIds((prev) => new Set(prev).add(matterId));
    setTimeout(() => {
      setIsolatedAffirmationIds((prev) => {
        const next = new Set(prev);
        next.delete(matterId);
        return next;
      });
    }, 4000);
  };

  // ── Per-matter firm operations ──────────────────────────────────────────
  const [sharingMatterId, setSharingMatterId] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [openingRemoteId, setOpeningRemoteId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  // Expanded member roster for a local shared matter
  const [expandedRosterId, setExpandedRosterId] = useState<string | null>(null);

  const handleShare = async (matterId: string, clientName: string) => {
    setSharingMatterId(matterId);
    setShareError(null);
    // Delegates to the shared promote routine (also used by the solo-to-firm
    // carry-over flow) so firm-matter creation + key publishing live in one place.
    const result = await promoteMatterToShared(matterId, clientName, getClient());
    if (result.status === 'failed') {
      setShareError(t('matter.manager.firm-share-error', { error: result.error }));
    }
    setSharingMatterId(null);
  };

  const handleLeave = (matterId: string) => {
    const leavingMatter = matters.find((x) => x.id === matterId);
    // Stop the sync client before unlinking so the WebSocket is torn down
    // before the matter loses its firmMatterId.
    stopMatterSync(matterId);
    unlinkFirmMatter(matterId);
    audit.append({
      type: 'matter_unshared',
      timestamp: new Date().toISOString(),
      payload: {
        matter_id: matterId,
        ...(leavingMatter?.firmMatterId ? { firm_matter_id: leavingMatter.firmMatterId } : {}),
        detail: `unlinked from firm`,
      },
    });
    // Collapse roster if it was open for this matter
    if (expandedRosterId === matterId) setExpandedRosterId(null);
  };

  const handleOpenShared = async (remote: MatterMineSummary) => {
    setOpeningRemoteId(remote.matter_handle);
    setOpenError(null);
    try {
      const client = getClient();

      // Register this device first so the admin can wrap the matter key for it.
      // This is idempotent (upsert) — safe to call every time.
      await registerDevice(client);

      // Attempt to obtain the matter key (seat token required for X-Seat-Token header)
      const key = await obtainMatterKey(client, remote.matter_handle, seatToken ?? '');
      if (key === null) {
        setOpenError(t('matter.manager.firm-key-blocked'));
        return;
      }

      // Create a linked local matter
      createMatter({
        name: 'Shared client waiting for encrypted details',
        client: 'Shared client waiting for encrypted details',
        firmMatterId: remote.matter_handle,
        rootStreamHandle: remote.root_stream_handle,
        orgId: firm.org?.org_id ?? '',
        role: remote.role,
        shared: true,
      });

      // Audit
      audit.append({
        type: 'matter_shared',
        timestamp: new Date().toISOString(),
        payload: {
          matter_id: remote.matter_handle,
          firm_matter_id: remote.matter_handle,
          ...(firm.org?.org_id ? { org_id: firm.org.org_id } : {}),
          detail: 'opened shared client locally',
        },
      });

      // Refresh the mine list
      await loadMineMatters();
    } catch (err) {
      setOpenError(
        t('matter.manager.firm-open-error', {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setOpeningRemoteId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="matter-manager-dialog"
        className="max-w-2xl max-h-[80vh] overflow-y-auto"
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-primary" />
            {t('matter.manager.settings-title')}
          </DialogTitle>
          <DialogDescription>
            {t('matter.manager.settings-description-entity', { entity: entityLabel.one })}
          </DialogDescription>
        </DialogHeader>

        {/* ── Firm: "Shared matters I can access" (remote, not yet linked) ── */}
        {/* Only shown when there is an active firm session */}
        {firmSession && (
          <div
            data-testid="firm-shared-mine-section"
            className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" aria-hidden />
                {t('matter.manager.firm-open-shared-section')}
              </h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                disabled={mineLoading}
                onClick={() => void loadMineMatters()}
                data-testid="firm-refresh-mine"
                title="Refresh"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', mineLoading && 'animate-spin')} />
              </Button>
            </div>

            {mineLoading && (
              <p className="text-xs text-muted-foreground" data-testid="firm-mine-loading">
                {t('matter.manager.firm-open-shared-loading')}
              </p>
            )}

            {!mineLoading && remoteMineMatters.length === 0 && (
              <p className="text-xs text-muted-foreground" data-testid="firm-mine-empty">
                {t('matter.manager.firm-open-shared-empty')}
              </p>
            )}

            {openError && (
              <p className="text-xs text-rose-700" data-testid="firm-open-error">
                {openError}
              </p>
            )}

            {!mineLoading && remoteMineMatters.map((remote) => (
              <div
                key={remote.matter_handle}
                className="flex items-center justify-between rounded-md border bg-white px-3 py-2 text-xs"
                data-testid={`firm-remote-matter-${remote.matter_handle}`}
              >
                <span className="font-medium">Shared client</span>
                <span className="flex items-center gap-2">
                  <span className="capitalize text-muted-foreground">{remote.role}</span>
                  <Button
                    type="button"
                    size="sm"
                    data-testid={`firm-open-remote-${remote.matter_handle}`}
                    disabled={openingRemoteId === remote.matter_handle}
                    onClick={() => void handleOpenShared(remote)}
                  >
                    {openingRemoteId === remote.matter_handle
                      ? t('matter.manager.firm-opening')
                      : t('matter.manager.firm-open-action')}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Existing matters (non-archived only) */}
        <div className="space-y-3" data-testid="matter-list">
          {activeMatters.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              {t('matter.manager.empty-entity', { entityOther: entityLabel.other, entityOne: entityLabel.one })}
            </p>
          ) : (
            activeMatters.map((m) => {
              const expanded = expandedMatterId === m.id;
              return (
              <div
                key={m.id}
                data-testid={`matter-row-${m.id}`}
                className="rounded-md border overflow-hidden"
              >
                {/* Collapsed row: name + created date. Click to expand this
                    client's settings. Only one client is open at a time, so the
                    dialog stays a clean scannable list. */}
                <button
                  type="button"
                  data-testid={`matter-settings-toggle-${m.id}`}
                  aria-expanded={expanded}
                  onClick={() => {
                    setExpandedMatterId((prev) => (prev === m.id ? null : m.id));
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-accent/40"
                >
                  <span className="min-w-0 flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {matterLabel(m)}
                    </span>
                    {m.isSample && (
                      <span className="text-[11px] text-muted-foreground">
                        {t('matter.manager.sample-tag')}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {new Date(m.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    {expanded
                      ? <ChevronUp className="h-4 w-4" aria-hidden />
                      : <ChevronDown className="h-4 w-4" aria-hidden />}
                  </span>
                </button>

                {expanded && (
                <div className="border-t p-3 space-y-3">
                {/* Sample hint shown at the top of the sample matter panel */}
                {m.isSample && (
                  <div className="flex items-center gap-2 pb-1">
                    <span
                      data-testid="matter-manager-sample-badge"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '2px var(--kp-space-xs)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 'var(--kp-font-2xs)',
                        fontWeight: 'var(--kp-weight-semibold)',
                        letterSpacing: '0.03em',
                        background: 'var(--kp-local-bg)',
                        color: 'var(--kp-local)',
                        border: '1px solid var(--kp-local-line)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Sample
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('matter.manager.sample-hint-entity', { entity: entityLabel.one })}
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    data-testid={`matter-name-${m.id}`}
                    value={m.name}
                    onChange={(e) => {
                      renameMatter(m.id, { name: e.target.value });
                    }}
                    className="h-8 text-sm font-medium"
                    aria-label={t('matter.manager.name-label-entity', { entity: entityLabel.One })}
                    disabled={m.id === SAMPLE_MATTER_ID}
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      data-testid={`matter-client-${m.id}`}
                      value={m.client}
                      onChange={(e) => {
                        renameMatter(m.id, { client: e.target.value });
                      }}
                      className="h-8 text-sm"
                      aria-label={t('matter.manager.client-name')}
                      disabled={m.id === SAMPLE_MATTER_ID}
                    />
                    <Button
                      data-testid={`matter-archive-${m.id}`}
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-accent"
                      onClick={() => { setMatterArchived(m.id, true); }}
                      aria-label={t('matter.manager.archive-entity', { entity: entityLabel.one })}
                      title={t('matter.manager.archive-entity', { entity: entityLabel.one })}
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                    <Button
                      data-testid={`matter-delete-${m.id}`}
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        // Always confirm a delete — a matter is a unit of work a
                        // lawyer doesn't want to lose to a stray click. (The store
                        // also clears the matter's folder/mail mappings, notes,
                        // AI cache, and sync state; the files themselves stay on
                        // disk.)
                        const message =
                          m.id === SAMPLE_MATTER_ID
                            ? t('matter.manager.delete-sample-confirm-entity', { entity: entityLabel.one })
                            : t('matter.manager.delete-confirm-entity', {
                                entity: entityLabel.one,
                                name: m.name || m.client || t('ask.message-scope.this-entity-fallback', { entity: entityLabel.one }),
                              });
                        void (async () => {
                          const confirmed = await confirm(message, {
                            title: t('matter.manager.delete-confirm-title-entity', { entity: entityLabel.one }),
                            confirmLabel: t('matter.manager.remove-action'),
                            cancelLabel: t('matter.manager.cancel-action'),
                            variant: 'destructive',
                          });
                          if (!confirmed) return;
                          // deleteMatter also prunes this client from every rail
                          // group (in the store, only after the delete actually
                          // succeeds) — see matterStore.deleteMatter.
                          deleteMatter(m.id);
                        })();
                      }}
                      aria-label={t('matter.manager.delete-entity', { entity: entityLabel.one })}
                      title={t('matter.manager.delete-entity', { entity: entityLabel.one })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Isolated (network lockdown) persistent badge — shown when on */}
                {m.privileged && (
                  <div
                    data-testid={`matter-isolated-badge-${m.id}`}
                    className="flex items-center gap-1.5 rounded-md border border-[rgba(var(--kp-navy-rgb),0.20)] bg-[rgba(var(--kp-navy-rgb),0.05)] px-2 py-1 text-xs font-medium text-[var(--kp-navy)]"
                    style={{ background: 'linear-gradient(90deg, rgba(var(--kp-navy-rgb),0.07) 0%, rgba(16,185,129,0.06) 100%)' }}
                  >
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden />
                    {t('matter.manager.isolated-badge')}
                  </div>
                )}

                {m.mcpAccessGranted && (
                  <div
                    data-testid={`matter-mcp-access-badge-${m.id}`}
                    className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden />
                    {t('matter.manager.mcp-access-badge')}
                  </div>
                )}

                {/* Isolation affirmation callout — visible for ~4 s after enabling */}
                {isolatedAffirmationIds.has(m.id) && (
                  <div
                    data-testid={`matter-isolated-affirmation-${m.id}`}
                    className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
                    style={{ background: 'linear-gradient(90deg, #ecfdf5 0%, #f0f9ff 100%)' }}
                  >
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                    <span>{t('matter.manager.isolated-affirmation')}</span>
                  </div>
                )}

                {/* Isolation confirmation dialog — shown inline when user tries to enable */}
                {isolateConfirmId === m.id && (
                  <div
                    data-testid={`matter-isolate-confirm-${m.id}`}
                    className="rounded-md border border-[rgba(var(--kp-navy-rgb),0.30)] bg-white p-3 space-y-2 shadow-sm"
                  >
                    <div className="flex items-start gap-2">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kp-navy)]" aria-hidden />
                      <div>
                        <p className="text-xs font-medium text-[var(--kp-navy)]">
                          {t('matter.manager.isolated-confirm-title')}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                          {t('matter.manager.isolated-confirm-body')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        data-testid={`matter-isolate-cancel-${m.id}`}
                        onClick={() => { setIsolateConfirmId(null); }}
                      >
                        {t('matter.manager.isolated-confirm-cancel')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs gap-1.5 bg-[var(--kp-navy)] hover:bg-[rgba(var(--kp-navy-rgb),0.90)] text-white"
                        data-testid={`matter-isolate-confirm-action-${m.id}`}
                        onClick={() => { confirmIsolate(m.id); }}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                        {t('matter.manager.isolated-confirm-action')}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Privileged-matter toggle */}
                <label
                  data-testid={`matter-privileged-${m.id}`}
                  data-checked={m.privileged ? 'true' : 'false'}
                  className="flex items-start gap-2 text-xs cursor-pointer select-none rounded-md border border-border/60 px-2 py-1.5"
                >
                  <input
                    type="checkbox"
                    checked={!!m.privileged}
                    onChange={(e) => {
                      if (e.target.checked) {
                        // Intercept enable: show confirm first
                        setIsolateConfirmId(m.id);
                      } else {
                        setMatterPrivileged(m.id, false);
                        // Dismiss any pending confirm/affirmation for this matter
                        setIsolateConfirmId((prev) => (prev === m.id ? null : prev));
                        setIsolatedAffirmationIds((prev) => {
                          const next = new Set(prev);
                          next.delete(m.id);
                          return next;
                        });
                      }
                    }}
                    className="mt-0.5 h-3.5 w-3.5 accent-rose-600"
                    aria-label={t('matter.manager.privileged-label')}
                  />
                  <span>
                    <span className="inline-flex items-center gap-1 font-medium">
                      <ShieldAlert className="h-3.5 w-3.5 text-rose-600" aria-hidden />
                      {t('matter.manager.privileged-label')}
                    </span>
                    <span className="block text-muted-foreground">
                      {t('matter.manager.privileged-hint')}
                    </span>
                  </span>
                </label>

                <label
                  data-testid={`matter-mcp-access-${m.id}`}
                  data-checked={m.mcpAccessGranted ? 'true' : 'false'}
                  className="flex items-start gap-2 text-xs cursor-pointer select-none rounded-md border border-border/60 px-2 py-1.5"
                >
                  <input
                    type="checkbox"
                    checked={!!m.mcpAccessGranted}
                    onChange={(e) => {
                      setMatterMcpAccess(m.id, e.target.checked);
                    }}
                    className="mt-0.5 h-3.5 w-3.5 accent-emerald-700"
                    aria-label={t('matter.manager.mcp-access-label')}
                  />
                  <span>
                    <span className="inline-flex items-center gap-1 font-medium">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" aria-hidden />
                      {t('matter.manager.mcp-access-label')}
                    </span>
                    <span className="block text-muted-foreground">
                      {t('matter.manager.mcp-access-hint')}
                    </span>
                  </span>
                </label>

                {/* ── Firm sharing section (only when firm session active) ── */}
                {firmSession && (
                  <div
                    data-testid={`firm-section-${m.id}`}
                    className="rounded-md border border-primary/20 p-2 space-y-2"
                  >
                    {m.shared && m.firmMatterId ? (
                      // Already shared
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span
                            data-testid={`matter-firm-shared-badge-${m.id}`}
                            className="flex items-center gap-1.5 text-xs font-medium text-primary"
                          >
                            <Share2 className="h-3.5 w-3.5" aria-hidden />
                            {t('matter.manager.firm-shared-section')}
                            <span
                              data-testid="matter-firm-shared-badge"
                              className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                            >
                              {m.role ? firmRoleBadgeLabel(m.role, t) : t('matter.manager.firm-shared-badge')}
                            </span>
                          </span>
                          <div className="flex items-center gap-1">
                            {/* Open shared notes for this matter */}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 gap-1 text-xs"
                              data-testid={`matter-open-notes-${m.id}`}
                              onClick={() => {
                                openMatterNotes(m.id);
                                onOpenChange(false);
                              }}
                              title={t('matter.manager.open-notes-action')}
                            >
                              <FileText className="h-3.5 w-3.5" />
                              <span className="sr-only">{t('matter.manager.open-notes-action')}</span>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => {
                                setExpandedRosterId(
                                  expandedRosterId === m.id ? null : m.id,
                                );
                              }}
                              data-testid={`firm-toggle-roster-${m.id}`}
                            >
                              <Users className="h-3.5 w-3.5" />
                            </Button>
                            {(m.role === 'owner' || firm.role === 'admin') && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-rose-700 hover:bg-rose-50"
                                onClick={() => { handleLeave(m.id); }}
                                data-testid={`firm-leave-${m.id}`}
                                title={t('matter.manager.firm-leave-hint')}
                              >
                                <LogOut className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Member roster (expanded) */}
                        {expandedRosterId === m.id && m.firmMatterId && (
                          <MemberRoster
                            matterId={m.id}
                            firmMatterId={parseMatterHandle(m.firmMatterId)}
                            canInvite={m.role === 'owner' || firm.role === 'admin'}
                          />
                        )}
                      </div>
                    ) : (
                      // Not yet shared
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {t('matter.manager.firm-share-section')}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs"
                          data-testid={`firm-share-${m.id}`}
                          disabled={sharingMatterId === m.id}
                          onClick={() => void handleShare(m.id, m.client || m.name)}
                        >
                          <Share2 className="h-3.5 w-3.5" />
                          {sharingMatterId === m.id
                            ? t('matter.manager.firm-sharing')
                            : t('matter.manager.firm-share-action')}
                        </Button>
                      </div>
                    )}

                    {shareError && sharingMatterId === null && m.id === matters[matters.length - 1]?.id && (
                      <p className="text-xs text-rose-700" data-testid="firm-share-error">
                        {shareError}
                      </p>
                    )}
                  </div>
                )}

                {/* Folder mapping */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    {t('matter.manager.folders-label-entity', { entity: entityLabel.one })}
                  </p>
                  {folderPaths.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t('matter.manager.no-folders-entity', { entity: entityLabel.one })}
                    </p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto rounded border divide-y">
                      {folderPaths.map((fp) => {
                        const matchingFolderPaths = m.folderPaths.filter((mapped) =>
                          folderPathsMatch(fp, mapped, rootPath),
                        );
                        const checked = matchingFolderPaths.length > 0;
                        return (
                          <button
                            key={fp}
                            type="button"
                            data-testid={`matter-folder-${m.id}-${fp}`}
                            data-checked={checked ? 'true' : 'false'}
                            onClick={() => {
                              if (checked) {
                                matchingFolderPaths.forEach((mapped) => {
                                  removeFolderPath(m.id, mapped);
                                });
                              } else {
                                addFolderPath(m.id, fp);
                              }
                            }}
                            className={cn(
                              'flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent',
                              checked && 'bg-primary/5',
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                                checked
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-muted-foreground/40',
                              )}
                            >
                              {checked && <Check className="h-3 w-3" />}
                            </span>
                            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{relLabel(fp, rootPath)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Email account mapping (account-level: every folder in the account) */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    {t('matter.manager.mail-label-entity', { entity: entityLabel.one })}
                  </p>
                  {mailAccounts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t('matter.manager.no-mail-accounts-entity', { entity: entityLabel.one })}
                    </p>
                  ) : (
                    <div className="rounded border divide-y">
                      {mailAccounts.map((acct) => {
                        const key = mailFolderKey(acct.provider, acct.account);
                        const checked = (m.mailFolderPaths ?? []).includes(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            data-testid={`matter-mail-${m.id}-${key}`}
                            data-checked={checked ? 'true' : 'false'}
                            onClick={() => {
                              if (checked) removeMailFolderPath(m.id, key);
                              else addMailFolderPath(m.id, key);
                            }}
                            className={cn(
                              'flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent',
                              checked && 'bg-primary/5',
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                                checked
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-muted-foreground/40',
                              )}
                            >
                              {checked && <Check className="h-3 w-3" />}
                            </span>
                            <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{acct.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {mailAccounts.length > 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t('matter.manager.mail-account-hint-entity', { entity: entityLabel.one })}
                    </p>
                  )}
                </div>
                </div>
                )}
              </div>
              );
            })
          )}
        </div>

        {/* ── Archived matters section ── */}
        {archivedMatters.length > 0 && (
          <div
            data-testid="archived-matters-section"
            className="rounded-md border border-border/60 overflow-hidden"
          >
            <button
              type="button"
              data-testid="archived-matters-toggle"
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent/50 transition-colors"
              onClick={() => { setArchivedExpanded((v) => !v); }}
            >
              <span className="flex items-center gap-2">
                <Archive className="h-3.5 w-3.5" aria-hidden />
                {t('matter.manager.archived-section-label')} ({archivedMatters.length})
              </span>
              {archivedExpanded
                ? <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
            </button>

            {archivedExpanded && (
              <div className="divide-y divide-border/40">
                {archivedMatters.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between px-3 py-2 text-xs"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-medium text-foreground">{m.name || m.id}</span>
                      {m.client && (
                        <span className="block truncate text-muted-foreground">{m.client}</span>
                      )}
                    </span>
                    <Button
                      data-testid={`matter-restore-${m.id}`}
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 gap-1 text-xs shrink-0"
                      onClick={() => { setMatterArchived(m.id, false); }}
                      aria-label={t('matter.manager.restore')}
                      title={t('matter.manager.restore')}
                    >
                      <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
                      {t('matter.manager.restore')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
      <ConfirmDialog {...confirmDialogProps} />
    </Dialog>
  );
}

export default MatterManagerDialog;
