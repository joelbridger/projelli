// Workspace Selector — Full-viewport branded start screen
// Replaces the old dialog-over-dark-background with a white branded page.
// This is the first thing users see — it must look like a $49 product.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { WebFSBackend, createWebFSBackend } from '@/platform/fs/WebFSBackend';
import { WorkspaceService, createWorkspaceService } from '@/platform/fs/WorkspaceService';
import { createFSBackend, isTauriEnvironment } from '@/platform/fs/BackendFactory';
import { vaultStatus } from '@/platform/firm/vault/vaultClient';
import { DEFAULT_WORKSPACE_FOLDERS } from '@/platform/fs/types';
import { openExternal } from '@/platform/utils/openExternal';
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

interface WorkspaceSelectorProps {
  open: boolean;
  onWorkspaceSelected: (service: WorkspaceService) => void;
  /**
   * If provided, a dismiss/close button is shown (e.g. user already has a workspace
   * open and is switching). Leave undefined for first-run blocking mode.
   */
  onDismiss?: (() => void) | undefined;
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

export function WorkspaceSelector({ open, onWorkspaceSelected, onDismiss }: WorkspaceSelectorProps) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTauri = isTauriEnvironment();

  // Vault-locked state: when a Tauri workspace has its vault locked (no key on
  // this machine), we show VaultLockedPrompt instead of proceeding.
  const [lockedWorkspacePath, setLockedWorkspacePath] = useState<string | null>(null);
  const [showEscapeHatch, setShowEscapeHatch] = useState(false);

  const { recentWorkspaces, addRecentWorkspace, removeRecentWorkspace, setRootPath, setFileTree, expandAllFolders } = useWorkspaceStore();

  /**
   * Shared workspace-open logic used by all three entry points (browse, recent,
   * create-then-open).  Checks vault status before proceeding: if the vault is
   * locked, stores the path in `lockedWorkspacePath` and surfaces
   * VaultLockedPrompt instead of opening normally.
   */
  const openWorkspacePath = async (workspacePath: string) => {
    // Vault check — Tauri only; browser workspaces can never be vaulted.
    if (isTauri) {
      try {
        const status = await vaultStatus(workspacePath);
        if (status.enabled && status.locked) {
          setLockedWorkspacePath(workspacePath);
          return; // Show VaultLockedPrompt — caller resumes via handleVaultUnlocked.
        }
      } catch {
        // vault_status failure is non-fatal (command may not be registered yet).
      }
    }

    const backend = await createFSBackend(workspacePath);
    const service = createWorkspaceService();
    const workspace = await service.initialize(backend, workspacePath);

    setRootPath(workspace.rootPath);
    const fileTree = await service.getFileTree();
    setFileTree(fileTree);
    expandAllFolders();

    addRecentWorkspace({
      path: workspace.rootPath,
      name: workspace.name,
      lastOpened: new Date(),
    });

    onWorkspaceSelected(service);
  };

  /** Called by VaultLockedPrompt when the vault is successfully unlocked. */
  const handleVaultUnlocked = async () => {
    if (!lockedWorkspacePath) return;
    const path = lockedWorkspacePath;
    setLockedWorkspacePath(null);
    setIsLoading(true);
    setError(null);
    try {
      await openWorkspacePath(path);
    } catch (err) {
      console.error('[WorkspaceSelector] Failed to open workspace after vault unlock:', err);
      setError(err instanceof Error ? err.message : 'Failed to open workspace');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectFolder = async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (isTauri) {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selectedPath = await open({
          directory: true,
          multiple: false,
          title: 'Select Workspace Folder',
        });

        if (!selectedPath) {
          setIsLoading(false);
          return;
        }

        console.log('[WorkspaceSelector] Selected path from dialog:', selectedPath);
        await openWorkspacePath(selectedPath as string);
      } else {
        if (!WebFSBackend.isSupported()) {
          setError(
            typeof window !== 'undefined' && window.isSecureContext === false
              ? 'Opening a folder from a browser needs a secure (https) connection. The desktop app does this natively. To use it in a browser, open Advisor Prep Hero over https or on localhost.'
              : 'This browser does not support opening folders. Please use Chrome, Edge, or Opera, or use the Advisor Prep Hero desktop app.',
          );
          setIsLoading(false);
          return;
        }
        const webBackend = createWebFSBackend();
        const handle = await webBackend.openDirectoryPicker();
        const rootPath = '/' + handle.name;

        const service = createWorkspaceService();
        const workspace = await service.initialize(webBackend, rootPath);

        setRootPath(workspace.rootPath);
        const fileTree = await service.getFileTree();
        setFileTree(fileTree);
        expandAllFolders();

        addRecentWorkspace({
          path: workspace.rootPath,
          name: workspace.name,
          lastOpened: new Date(),
        });

        onWorkspaceSelected(service);
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
    setIsLoading(true);
    setError(null);

    try {
      let backend;
      let rootPath: string;

      if (isTauri) {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selectedPath = await open({
          directory: true,
          multiple: false,
          title: 'Select Folder for New Workspace',
        });

        if (!selectedPath) {
          setIsLoading(false);
          return;
        }

        backend = await createFSBackend(selectedPath as string);
        rootPath = selectedPath as string;
      } else {
        if (!WebFSBackend.isSupported()) {
          setError(
            typeof window !== 'undefined' && window.isSecureContext === false
              ? 'Opening a folder from a browser needs a secure (https) connection. The desktop app does this natively. To use it in a browser, open Advisor Prep Hero over https or on localhost.'
              : 'This browser does not support opening folders. Please use Chrome, Edge, or Opera, or use the Advisor Prep Hero desktop app.',
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
      const workspace = await service.initialize(backend, rootPath, {
        createDefaultStructure: true,
      });

      setRootPath(workspace.rootPath);
      const fileTree = await service.getFileTree();
      setFileTree(fileTree);
      expandAllFolders();

      addRecentWorkspace({
        path: workspace.rootPath,
        name: workspace.name,
        lastOpened: new Date(),
      });

      onWorkspaceSelected(service);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('[WorkspaceSelector] Failed to create workspace:', err);
      const errorMsg = err instanceof Error ? `${err.message}\n\nDetails: ${err.stack || 'No stack trace'}` : 'Failed to create workspace';
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenRecent = async (workspacePath: string) => {
    if (!isTauri) return;
    setIsLoading(true);
    setError(null);

    try {
      await openWorkspacePath(workspacePath);
    } catch (err) {
      console.error('[WorkspaceSelector] Failed to open recent workspace:', err);
      removeRecentWorkspace(workspacePath);
      setError(err instanceof Error ? err.message : 'Failed to open workspace');
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
