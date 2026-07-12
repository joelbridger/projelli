// Workspace Selector — Full-viewport branded start screen
// Replaces the old dialog-over-dark-background with a white branded page.
// This is the first thing users see — it must look like a $49 product.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { WebFSBackend, createWebFSBackend } from '@/platform/fs/WebFSBackend';
import { WorkspaceService, createWorkspaceService } from '@/platform/fs/WorkspaceService';
import { createFSBackend, isTauriEnvironment } from '@/platform/fs/BackendFactory';
import { vaultStatus } from '@/platform/firm/vault/vaultClient';
import { migrateWorkspaceDataDir } from '@/platform/utils/tauri-commands';
import { DEFAULT_WORKSPACE_FOLDERS } from '@/platform/fs/types';
import type { FSBackend } from '@/platform/fs/types';
import { openExternal } from '@/platform/utils/openExternal';
import { withTimeout } from '@/lib/withTimeout';
import { raceDialogWithWatchdog } from '@/platform/fs/dialogWatchdog';
import { describeWorkspaceOpenError, isTransientWorkspaceOpenFailure } from '@/platform/fs/workspaceOpenErrors';
import type { PromptOptions } from '@/platform/hooks/usePromptDialog';
import { AppLogo } from '@/ui/brand/AppLogo';
import { GradientGlow } from '@/ui/brand/GradientGlow';
import { VaultLockedPrompt } from '@/features/firm/vault/VaultLockedPrompt';
import { VaultEscapeHatchDialog } from '@/features/firm/vault/VaultEscapeHatchDialog';
import {
  FolderOpen,
  FolderPlus,
  Clock,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  X,
} from 'lucide-react';
import { BRAND } from '@/config/brand';

// Public Getting Started doc URL
const GETTING_STARTED_URL = BRAND.urls.gettingStarted;

// Folders shown under the "New Workspace" card as a preview
const PREVIEW_STRUCTURE_FOLDERS = DEFAULT_WORKSPACE_FOLDERS.filter(
  (folder) => !folder.startsWith('.')
);

// BUG-002: bound the non-interactive open/create work so a hung native (Tauri)
// call can never leave the first-run screen frozen with greyed buttons. The
// folder picker itself is interactive and is NEVER wrapped. withTimeout()
// formats its own message from a short label ("<label> timed out after Ns"),
// so these are labels, not full sentences.
const WORKSPACE_INIT_TIMEOUT_MS = 30_000;
const WORKSPACE_CREATE_LABEL = 'Creating the workspace';
const WORKSPACE_OPEN_LABEL = 'Opening the workspace';
// QA-33: this vault-locked precheck used to call vaultStatus() with NO bound
// at all (not even the 30s below, since it runs BEFORE that block) — a
// stopped/unreachable OS credential service (e.g. Windows' `VaultSvc`) could
// hang this check forever with the screen stuck on a spinner. Same 5s budget
// as the identical check in App.tsx's `isWorkspaceVaultLocked` and
// BackendFactory's `createFSBackend`.
const VAULT_LOCK_CHECK_TIMEOUT_MS = 5_000;

export interface WorkspaceSelectorProps {
  open: boolean;
  /**
   * Hands the prepared service to the app's workspace-switch handler
   * (`handleWorkspaceSelected`), which owns ALL root-committing state — root
   * path, file tree, recents, per-workspace store reloads. It can still ABORT
   * the switch (unsaved-changes guard), so this component must not mutate any
   * global workspace state itself, before or after the call (QA-93 round 3,
   * Codex F2). Resolves `false` when the switch was aborted.
   */
  onWorkspaceSelected: (service: WorkspaceService) => boolean | undefined | Promise<boolean | undefined>;
  /**
   * If provided, a dismiss/close button is shown (e.g. user already has a workspace
   * open and is switching). Leave undefined for first-run blocking mode.
   */
  onDismiss?: (() => void) | undefined;
  /**
   * QA-33: an honest error from a FAILED silent boot-time reopen (see
   * useAutoResumeWorkspace / useWorkspaceLifecycle's `workspaceOpenError`),
   * shown once via this component's own error banner instead of the user
   * landing here with no explanation for why they weren't just dropped back
   * into their last workspace. Absorbed into local state on change (see the
   * effect below) and then owned by this component's normal error lifecycle.
   */
  externalError?: string | null;
  /** Called once `externalError` has been absorbed, so the source resets. */
  onExternalErrorShown?: () => void;
  /**
   * QA-32: the native folder picker (`@tauri-apps/plugin-dialog`'s `open()`)
   * can silently never appear/resolve on some environments (see
   * dialogWatchdog.ts for the root-cause investigation). When that happens,
   * this is used to show a manual "type the folder path" fallback instead of
   * leaving the screen stuck forever. Reuses the app's shared prompt dialog
   * (usePromptDialog) so no new modal plumbing is needed.
   */
  promptForPath?: (
    message: string,
    defaultValue?: string,
    options?: Omit<PromptOptions, 'defaultValue'>,
  ) => Promise<string | null>;
  /** Debug first-run automation; uses the normal picker open path below. */
  autoOpenWorkspacePath?: string | null;
}

/** Max recent workspaces to show without expanding */
const RECENT_PREVIEW_COUNT = 3;

/** Collapsed-by-default recent workspaces section */
function RecentWorkspacesSection({
  workspaces,
  isLoading,
  isTauri,
  onOpen,
  formatDate,
}: {
  workspaces: Array<{ path: string; name: string; lastOpened: Date }>;
  isLoading: boolean;
  isTauri: boolean;
  onOpen: (path: string) => void;
  formatDate: (date: Date) => string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? workspaces : workspaces.slice(0, RECENT_PREVIEW_COUNT);
  const hasMore = workspaces.length > RECENT_PREVIEW_COUNT;

  return (
    <div className="w-full max-w-lg mx-auto">
      <button
        data-testid="recent-workspaces-toggle"
        type="button"
        className="flex items-center gap-2 text-sm font-medium mb-3 group"
        style={{ color: '#475569' }}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <ChevronRight
          className={cn(
            'h-4 w-4 transition-transform duration-200',
            expanded && 'rotate-90'
          )}
        />
        <Clock className="h-4 w-4" />
        <span>
          Recent ({workspaces.length})
        </span>
      </button>

      {expanded && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{
            backgroundColor: '#FFFFFF',
            borderColor: '#E2E8F0',
          }}
        >
          <ul className="divide-y" style={{ borderColor: '#E2E8F0' }}>
            {visible.map((workspace) => (
              <li key={workspace.path}>
                <button
                  data-testid="recent-workspace-row"
                  className="w-full px-4 py-3 text-left transition-colors hover:bg-slate-50"
                  disabled={isLoading || !isTauri}
                  onClick={() => onOpen(workspace.path)}
                >
                  <div className="font-medium text-sm" style={{ color: '#111F35' }}>
                    {workspace.name}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: '#475569' }}>
                    {formatDate(workspace.lastOpened)}
                    {!isTauri && ' \u00B7 Re-select folder to reopen'}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {hasMore && !expanded && (
            <button
              type="button"
              className="w-full px-4 py-2 text-xs text-left transition-colors hover:bg-slate-50"
              style={{ color: '#475569' }}
              onClick={() => setExpanded(true)}
            >
              Show all ({workspaces.length})
            </button>
          )}
        </div>
      )}

      {expanded && !isTauri && (
        <p className="text-xs mt-2" style={{ color: '#475569' }}>
          {t('workspace.selector.browser-reselect-note')}
        </p>
      )}
    </div>
  );
}

export function WorkspaceSelector({
  open,
  onWorkspaceSelected,
  onDismiss,
  externalError,
  onExternalErrorShown,
  promptForPath,
  autoOpenWorkspacePath,
}: WorkspaceSelectorProps) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTauri = isTauriEnvironment();
  // QA-52 (cross-workspace isolation): opening a workspace is async. If the user
  // opens A then quickly opens B, a slower A finishing LAST must NOT still call
  // onWorkspaceSelected — that would land the app on the WRONG workspace. Each
  // open/create stamps a monotonic token at its start; a hand-off is dropped
  // unless its token is still the latest.
  const openTokenRef = useRef(0);
  const autoOpenStartedRef = useRef(false);
  const openWorkspacePathRef = useRef<
    ((workspacePath: string, token?: number) => Promise<void>) | null
  >(null);

  // Absorb a failed silent auto-resume into this component's own error
  // banner, then tell the source to reset so it doesn't re-fire the same
  // message on every re-render. From here on, `error` follows this
  // component's normal lifecycle (cleared by the next open/create attempt).
  useEffect(() => {
    if (!externalError) return;
    setError(externalError);
    onExternalErrorShown?.();
  }, [externalError, onExternalErrorShown]);

  // Vault-locked state: when a Tauri workspace has its vault locked (no key on
  // this machine), we show VaultLockedPrompt instead of proceeding.
  const [lockedWorkspacePath, setLockedWorkspacePath] = useState<string | null>(null);
  const [showEscapeHatch, setShowEscapeHatch] = useState(false);

  // QA-32: opens the native folder picker, racing it against the watchdog
  // (dialogWatchdog.ts) so an environment where the picker silently never
  // appears (confirmed on a fresh Windows bench VM) can never leave this
  // screen stuck forever. Falls back to a manual "type the path" prompt.
  const pickFolderPath = async (
    dialogTitle: string,
    unresponsiveMessage: string,
  ): Promise<string | null> => {
    const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
    const raced = await raceDialogWithWatchdog(
      openDialog({ directory: true, multiple: false, title: dialogTitle }),
    );
    if (!raced.timedOut) return raced.value ?? null;
    console.warn(
      '[WorkspaceSelector] Native folder picker did not respond within the watchdog window — falling back to manual path entry.',
    );
    if (!promptForPath) return null;
    return promptForPath(unresponsiveMessage, '', {
      title: t('workspace.selector.manual-path-title'),
      placeholder: t('workspace.selector.manual-path-placeholder'),
    });
  };

  const { recentWorkspaces, removeRecentWorkspace } = useWorkspaceStore();

  /**
   * Shared workspace-open logic used by all three entry points (browse, recent,
   * create-then-open).  Checks vault status before proceeding: if the vault is
   * locked, stores the path in `lockedWorkspacePath` and surfaces
   * VaultLockedPrompt instead of opening normally.
   */
  const openWorkspacePath = async (workspacePath: string, token: number = ++openTokenRef.current) => {
    // Data-folder setup must run BEFORE the vault check below so every store
    // resolves the same `.lantern` folder. Dev-data reset is approved for the
    // Lantern rename, so old folders are not migrated. Browser/dev no-op.
    //
    // Deliberately NOT time-bounded (coordinator review, 2026-07-04): always
    // wait for setup to finish (or genuinely fail) before proceeding.
    if (isTauri) {
      try {
        await migrateWorkspaceDataDir(workspacePath);
      } catch {
        // Best-effort: never block opening on the migration.
      }
    }
    // Vault check — Tauri only; browser workspaces can never be vaulted.
    if (isTauri) {
      try {
        const status = await withTimeout(
          vaultStatus(workspacePath),
          VAULT_LOCK_CHECK_TIMEOUT_MS,
          'Checking vault status',
        );
        if (status.enabled && status.locked) {
          // QA-52: a slow/locked A must not raise its vault prompt over a
          // newer B — drop if this open has been superseded.
          if (token !== openTokenRef.current) return;
          setLockedWorkspacePath(workspacePath);
          return; // Show VaultLockedPrompt — caller resumes via handleVaultUnlocked.
        }
      } catch {
        // Swallowed here ONLY because this is a non-authoritative precheck
        // (its whole job is deciding whether to show VaultLockedPrompt
        // instead of proceeding normally) — createFSBackend() below re-checks
        // vault status itself and now fails closed (throws) on this exact
        // failure (codex-review, 2026-07-04), so a real vault-enabled
        // workspace still can't silently open unencrypted from here.
      }
    }

    // Open-existing stays strict (no createIfMissing) — a missing/mistyped path
    // surfaces an error rather than being silently created. Only the native
    // SETUP (backend creation + initialize, which does the existence/permission
    // checks and any native handshakes) is time-bounded — those should settle
    // quickly, and a hung one must never freeze the screen.
    //
    // The recursive file-tree SCAN is deliberately NOT time-bounded: a
    // legitimately large advisor archive, or a slow OneDrive / network folder,
    // can take well over 30s to walk, and rejecting it would both block a valid
    // workspace AND prune it from recents. A slow-but-valid workspace must open.
    //
    // IMPORTANT: call onWorkspaceSelected only AFTER everything succeeds —
    // otherwise a timeout/throw mid-load would hand the app a broken service.
    // Global-store mutations happen inside the handler, never here.
    const { service } = await withTimeout(
      (async () => {
        const backend = await createFSBackend(workspacePath);
        const svc = createWorkspaceService();
        const ws = await svc.initialize(backend, workspacePath);
        return { service: svc, workspace: ws };
      })(),
      WORKSPACE_INIT_TIMEOUT_MS,
      WORKSPACE_OPEN_LABEL,
    );
    // Validation-only scan: prove the workspace's tree is readable BEFORE
    // handing it to the app, so a broken/unreadable folder surfaces as an
    // error banner here instead of a half-opened workspace. The handler loads
    // (and commits) the tree itself.
    await service.getFileTree();

    // QA-52: a newer open/create started while this one's async load ran — drop
    // this stale result rather than landing the app on the wrong workspace.
    if (token !== openTokenRef.current) return;
    // QA-93 round 3 (Codex F2): commit NOTHING here. The lifecycle handler can
    // still abort the switch (unsaved-changes guard); committing the root first
    // used to strand the app with the OLD workspace's UI but the NEW
    // workspace's client stores. handleWorkspaceSelected is the single place
    // the root (and recents, file tree, store reloads) is committed, after the
    // switch is irrevocable.
    await onWorkspaceSelected(service);
  };
  openWorkspacePathRef.current = openWorkspacePath;

  // Automation enters through the same picker route, preserving migration,
  // vault locking, validation, and the single root-commit boundary.
  useEffect(() => {
    if (!autoOpenWorkspacePath || !isTauri || autoOpenStartedRef.current) return;
    autoOpenStartedRef.current = true;
    const token = ++openTokenRef.current;
    setIsLoading(true);
    setError(null);
    const openWorkspace = openWorkspacePathRef.current;
    if (!openWorkspace) return;
    void openWorkspace(autoOpenWorkspacePath, token)
      .catch((err: unknown) => {
        console.error('[WorkspaceSelector] Failed to open debug launch workspace:', err);
        setError(err instanceof Error ? err.message : 'Failed to open workspace');
      })
      .finally(() => setIsLoading(false));
  }, [autoOpenWorkspacePath, isTauri]);

  /** Called by VaultLockedPrompt when the vault is successfully unlocked. */
  const handleVaultUnlocked = async () => {
    if (!lockedWorkspacePath) return;
    const path = lockedWorkspacePath;
    const token = ++openTokenRef.current;
    setLockedWorkspacePath(null);
    setIsLoading(true);
    setError(null);
    try {
      await openWorkspacePath(path, token);
    } catch (err) {
      console.error('[WorkspaceSelector] Failed to open workspace after vault unlock:', err);
      setError(err instanceof Error ? err.message : 'Failed to open workspace');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectFolder = async () => {
    const token = ++openTokenRef.current;
    setIsLoading(true);
    setError(null);

    try {
      if (isTauri) {
        const selectedPath = await pickFolderPath(
          'Select Workspace Folder',
          t('workspace.selector.picker-unresponsive-open'),
        );

        if (!selectedPath) {
          setIsLoading(false);
          return;
        }

        console.log('[WorkspaceSelector] Selected path from dialog:', selectedPath);
        await openWorkspacePath(selectedPath as string, token);
      } else {
        if (!WebFSBackend.isSupported()) {
          setError(
            typeof window !== 'undefined' && window.isSecureContext === false
              ? `Opening a folder from a browser needs a secure (https) connection. The desktop app does this natively. To use it in a browser, open ${BRAND.name} over https or on localhost.`
              : `This browser does not support opening folders. Please use Chrome, Edge, or Opera, or use the ${BRAND.name} desktop app.`,
          );
          setIsLoading(false);
          return;
        }
        const webBackend = createWebFSBackend();
        const handle = await webBackend.openDirectoryPicker();
        const rootPath = '/' + handle.name;

        const service = createWorkspaceService();
        await service.initialize(webBackend, rootPath);
        // Validation-only scan (see openWorkspacePath).
        await service.getFileTree();

        // QA-52: drop a superseded open (see openWorkspacePath).
        if (token !== openTokenRef.current) return;
        // QA-93 round 3 (Codex F2): commit nothing here — the handler owns all
        // root-committing state and can still abort (see openWorkspacePath).
        await onWorkspaceSelected(service);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('[WorkspaceSelector] Failed to open workspace:', err);
      const errorMsg = err instanceof Error ? `${err.message}\n\nDetails: ${err.stack || 'No stack trace'}` : 'Failed to open workspace';
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateWorkspace = async () => {
    const token = ++openTokenRef.current;
    setIsLoading(true);
    setError(null);

    try {
      let backend: FSBackend;
      let rootPath: string;

      if (isTauri) {
        // Interactive folder picker — deliberately not time-bounded for a
        // real, working dialog (the user may take a while); only falls back
        // to manual entry if the dialog itself never responds at all (QA-32).
        // Everything after this point is non-interactive.
        const selectedPath = await pickFolderPath(
          'Select Folder for New Workspace',
          t('workspace.selector.picker-unresponsive-create'),
        );

        if (!selectedPath) {
          setIsLoading(false);
          return;
        }

        rootPath = selectedPath as string;
        // createIfMissing: this is the create-new flow, so the chosen folder is
        // created here instead of throwing if it isn't already there. This is
        // the fix for BUG-002's chicken-and-egg (existence required before the
        // step that creates it).
        backend = await withTimeout(
          createFSBackend(rootPath, { createIfMissing: true }),
          WORKSPACE_INIT_TIMEOUT_MS,
          WORKSPACE_CREATE_LABEL,
        );
      } else {
        if (!WebFSBackend.isSupported()) {
          setError(
            typeof window !== 'undefined' && window.isSecureContext === false
              ? `Opening a folder from a browser needs a secure (https) connection. The desktop app does this natively. To use it in a browser, open ${BRAND.name} over https or on localhost.`
              : `This browser does not support opening folders. Please use Chrome, Edge, or Opera, or use the ${BRAND.name} desktop app.`,
          );
          setIsLoading(false);
          return;
        }
        const webBackend = createWebFSBackend();
        const handle = await webBackend.openDirectoryPicker();
        backend = webBackend;
        rootPath = '/' + handle.name;
      }

      const service = createWorkspaceService();
      // Bound only the native SETUP (initialize creates the folder structure and
      // does the native existence/permission checks) so a hung native call can't
      // freeze the screen. The recursive file-tree SCAN runs AFTER, untimed — a
      // newly-created workspace is small, but if the chosen folder is on a slow
      // OneDrive/network location the walk must not be rejected for being slow.
      // Only mutate global-store state after everything succeeds — a timeout/throw
      // mid-create must not leave the store half-set (a non-empty rootPath with no
      // active WorkspaceService, which App would treat as a broken first run).
      await withTimeout(
        service.initialize(backend, rootPath, {
          createIfMissing: true,
          createDefaultStructure: true,
        }),
        WORKSPACE_INIT_TIMEOUT_MS,
        WORKSPACE_CREATE_LABEL,
      );
      // Validation-only scan (see openWorkspacePath).
      await service.getFileTree();

      // QA-52: drop a superseded create/open (see openWorkspacePath).
      if (token !== openTokenRef.current) return;
      // QA-93 round 3 (Codex F2): commit nothing here — the handler owns all
      // root-committing state and can still abort (see openWorkspacePath).
      await onWorkspaceSelected(service);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('[WorkspaceSelector] Failed to create workspace:', err);
      // Plain-language banner for the user; the full error/stack goes to the
      // console above for debugging. Never leave the screen frozen.
      const errorMsg =
        err instanceof Error && err.message
          ? err.message
          : 'Could not create the workspace. Please try again, or pick a different folder.';
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenRecent = async (workspacePath: string) => {
    if (!isTauri) return;
    const token = ++openTokenRef.current;
    setIsLoading(true);
    setError(null);

    try {
      await openWorkspacePath(workspacePath, token);
    } catch (err) {
      console.error('[WorkspaceSelector] Failed to open recent workspace:', err);
      // codex-review (2026-07-04, round 2): a transient failure (credential-
      // service outage, or the check simply timing out) is not evidence this
      // workspace is bad — pruning it here would delete a perfectly good
      // Recents entry over a temporary hiccup. Only prune for failures that
      // actually indicate the workspace itself is the problem.
      if (!isTransientWorkspaceOpenFailure(err)) {
        removeRecentWorkspace(workspacePath);
      }
      setError(describeWorkspaceOpenError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const isDismissible = Boolean(onDismiss);

  if (!open) return null;

  return (
    <div
      data-testid="workspace-selector-dialog"
      className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-white dark:bg-white dark:text-slate-900"
      // Trap Escape for first-run blocking mode
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          if (isDismissible && onDismiss) {
            onDismiss();
          } else {
            e.preventDefault();
          }
        }
      }}
      // tabIndex needed so keydown fires on this element
      tabIndex={-1}
    >
      {/* Dismiss button (only when returning from an open workspace) */}
      {isDismissible && (
        <button
          type="button"
          aria-label="Close"
          className="absolute top-4 right-4 p-2 rounded-md transition-colors hover:bg-slate-100"
          style={{ color: '#475569' }}
          onClick={onDismiss}
        >
          <span className="sr-only">Close</span>
          <X className="h-5 w-5" />
        </button>
      )}

      {/* Main content — centered vertically with some top padding */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 w-full max-w-2xl">

        {/* Vault-locked prompt — replaces the normal workspace picker when a
            selected workspace has its vault locked (no key on this machine). */}
        {lockedWorkspacePath && (
          <>
            <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm mb-4">
              <VaultLockedPrompt
                workspace={lockedWorkspacePath}
                onUnlocked={handleVaultUnlocked}
                onEscapeHatch={() => setShowEscapeHatch(true)}
              />
              <button
                type="button"
                className="mt-4 text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2"
                onClick={() => setLockedWorkspacePath(null)}
              >
                Back to workspace selection
              </button>
            </div>
            <VaultEscapeHatchDialog
              open={showEscapeHatch}
              onOpenChange={setShowEscapeHatch}
              workspace={lockedWorkspacePath}
              onComplete={() => {
                setShowEscapeHatch(false);
                setLockedWorkspacePath(null);
              }}
            />
          </>
        )}

        {/* Normal workspace picker content (hidden while vault-locked prompt shows) */}
        {!lockedWorkspacePath && (
          <>

        {/* Logo area with gradient glow */}
        <div className="relative flex flex-col items-center mb-8">
          <GradientGlow className="-translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2" />
          <AppLogo iconSize={64} wordmarkHeight={28} />
        </div>

        {/* Tagline */}
        <p
          data-testid="welcome-dialog-pitch"
          className="text-base text-center mb-8 max-w-md leading-relaxed"
          style={{ color: '#475569' }}
        >
          {t('workspace.selector.tagline')}
        </p>

        {/* Error banner */}
        {error && (
          <div
            className="flex items-start gap-2 p-3 text-sm rounded-xl mb-6 w-full max-w-lg"
            style={{
              color: '#DC2626',
              backgroundColor: 'rgba(220, 38, 38, 0.06)',
              border: '1px solid rgba(220, 38, 38, 0.15)',
            }}
          >
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Action cards */}
        <div className="grid grid-cols-2 gap-4 w-full max-w-lg mb-8">
          {/* Open Existing */}
          <button
            data-testid="open-existing-workspace"
            type="button"
            disabled={isLoading}
            onClick={handleSelectFolder}
            className={cn(
              'group relative rounded-xl p-6 text-left transition-all duration-200',
              'border shadow-sm hover:shadow-md',
              isLoading && 'opacity-50 cursor-not-allowed'
            )}
            style={{
              backgroundColor: '#FFFFFF',
              borderColor: '#E2E8F0',
            }}
            onMouseEnter={(e) => {
              if (!isLoading) {
                e.currentTarget.style.borderColor = '#93C5FD';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.08)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#E2E8F0';
              e.currentTarget.style.boxShadow = '';
            }}
          >
            <div
              className="h-10 w-10 rounded-lg flex items-center justify-center mb-4"
              style={{ backgroundColor: '#F8FAFC' }}
            >
              <FolderOpen className="h-5 w-5" style={{ color: '#3B82F6' }} />
            </div>
            <div className="font-semibold text-sm mb-1" style={{ color: '#111F35' }}>
              Open Existing
            </div>
            <div className="text-xs" style={{ color: '#475569' }}>
              {t('workspace.selector.open-existing-hint')}
            </div>
          </button>

          {/* New Workspace */}
          <button
            data-testid="new-workspace"
            type="button"
            disabled={isLoading}
            onClick={handleCreateWorkspace}
            className={cn(
              'group relative rounded-xl p-6 text-left transition-all duration-200',
              'border shadow-sm hover:shadow-md',
              isLoading && 'opacity-50 cursor-not-allowed'
            )}
            style={{
              backgroundColor: '#FFFFFF',
              borderColor: '#E2E8F0',
            }}
            onMouseEnter={(e) => {
              if (!isLoading) {
                e.currentTarget.style.borderColor = '#93C5FD';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.08)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#E2E8F0';
              e.currentTarget.style.boxShadow = '';
            }}
          >
            <div
              className="h-10 w-10 rounded-lg flex items-center justify-center mb-4"
              style={{ backgroundColor: '#F8FAFC' }}
            >
              <FolderPlus className="h-5 w-5" style={{ color: '#8B5CF6' }} />
            </div>
            <div className="font-semibold text-sm mb-1" style={{ color: '#111F35' }}>
              New Workspace
            </div>
            <div
              data-testid="new-workspace-structure-preview"
              className="text-xs"
              style={{ color: '#475569' }}
            >
              {PREVIEW_STRUCTURE_FOLDERS.join(', ')}
            </div>
          </button>
        </div>

        {/* Recent workspaces (collapsed by default) */}
        {recentWorkspaces.length > 0 && (
          <RecentWorkspacesSection
            workspaces={recentWorkspaces}
            isLoading={isLoading}
            isTauri={isTauri}
            onOpen={handleOpenRecent}
            formatDate={formatDate}
          />
        )}
          </> // close {!lockedWorkspacePath && (<>
        )} {/* end !lockedWorkspacePath */}
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-center gap-3 pb-6 text-xs" style={{ color: '#475569' }}>
        <button
          data-testid="welcome-dialog-learn-more"
          type="button"
          className="inline-flex items-center gap-1 transition-colors hover:underline underline-offset-2"
          style={{ color: '#475569' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#475569'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#475569'; }}
          onClick={() => {
            openExternal(GETTING_STARTED_URL).catch((err) => {
              console.error('[WorkspaceSelector] Failed to open docs:', err);
            });
          }}
        >
          Learn more
          <ExternalLink className="h-3 w-3" />
        </button>
        <span aria-hidden="true">{'\u00B7'}</span>
        <button
          type="button"
          className="transition-colors hover:underline underline-offset-2"
          style={{ color: '#475569' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#475569'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#475569'; }}
          onClick={() => {
            openExternal(BRAND.urls.privacy).catch(() => {});
          }}
        >
          Privacy
        </button>
        <span aria-hidden="true">{'\u00B7'}</span>
        <button
          type="button"
          className="transition-colors hover:underline underline-offset-2"
          style={{ color: '#475569' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#475569'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#475569'; }}
          onClick={() => {
            openExternal(BRAND.urls.terms).catch(() => {});
          }}
        >
          Terms
        </button>
      </footer>
    </div>
  );
}
