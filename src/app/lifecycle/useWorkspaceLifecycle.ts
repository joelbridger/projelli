/**
 * useWorkspaceLifecycle — owns workspace selection and recent-project opening.
 *
 * Extracted from App.tsx (Phase 3 decomposition). The two handler bodies are
 * copied VERBATIM from App.tsx; only the source of the referenced values
 * changed (they now come from the options object instead of App's local scope).
 */
import { useCallback, useEffect } from 'react';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useEditorStore } from '@/platform/state/editorStore';
import { flushAllDirtyTabs, setActiveWorkspaceService } from '@/app/fileOps/flushDirtyTabs';
import { useTemplatesMarketplaceStore } from '@/features/workflows/templatesMarketplaceStore';
import {
  createTemplatesMarketplaceService,
  TemplateMetadataReader,
  type MarketplaceService,
} from '@/features/workflows/marketplace/svc';
import { isLawExperience } from '@/platform/profile/professionStore';
import { createWorkspaceService, type WorkspaceService } from '@/platform/fs/WorkspaceService';
import { createFSBackend } from '@/platform/fs/BackendFactory';
import { AuditService } from '@/platform/audit/AuditService';
import { writeDenyAllMcpSessionScopeFile } from '@/platform/mcp/mcpSessionScope';
import type { AuditEntry, AuditActionType } from '@/platform/types/audit';
import type { AuditEntryRecord, AuditIntegrityVerdict } from '@/platform/utils/tauri-commands';
import { CRM_AUDIT_APPENDED_EVENT } from '@/platform/utils/wealthbox-commands';
import type { TrashedItem, TrashStats } from '@/platform/history/TrashService';
import type { SourceCard } from '@/features/ask/types/research';
import type { AIChatFile } from '@/platform/types/ai';

export interface UseWorkspaceLifecycleOptions {
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null>;
  auditServiceRef: React.MutableRefObject<AuditService>;
  templatesMarketplaceServiceRef: React.MutableRefObject<MarketplaceService | null>;
  templatesMetadataReaderRef: React.MutableRefObject<TemplateMetadataReader | null>;
  setShowWorkspaceSelector: React.Dispatch<React.SetStateAction<boolean>>;
  setAuditEntries: React.Dispatch<React.SetStateAction<AuditEntry[]>>;
  setAuditIntegrity: React.Dispatch<React.SetStateAction<AuditIntegrityVerdict | undefined>>;
  setRootPath: (path: string) => void;
  loadTrashMetadata: () => Promise<TrashedItem[]>;
  setTrashItems: React.Dispatch<React.SetStateAction<TrashedItem[]>>;
  setTrashStats: React.Dispatch<React.SetStateAction<TrashStats>>;
  loadSourceCards: () => Promise<SourceCard[]>;
  setSourceCards: React.Dispatch<React.SetStateAction<SourceCard[]>>;
  loadChatFiles: () => Promise<AIChatFile[]>;
  setChatFiles: React.Dispatch<React.SetStateAction<AIChatFile[]>>;
}

export function useWorkspaceLifecycle(options: UseWorkspaceLifecycleOptions) {
  const {
    workspaceServiceRef, auditServiceRef, templatesMarketplaceServiceRef, templatesMetadataReaderRef,
    setShowWorkspaceSelector, setAuditEntries, setAuditIntegrity, setRootPath,
    loadTrashMetadata, setTrashItems, setTrashStats,
    loadSourceCards, setSourceCards, loadChatFiles, setChatFiles,
  } = options;

  const handleWorkspaceSelected = useCallback(async (service: WorkspaceService) => {
    // BUG-046: flush any dirty tabs of the OUTGOING workspace to disk BEFORE we
    // clear them — otherwise switching workspaces within the 2s autosave window
    // silently drops the last edits.
    const outgoing = workspaceServiceRef.current;
    if (outgoing) {
      await flushAllDirtyTabs(outgoing);
      // Codex review #2: a flush can FAIL (disk/permission) and leave tabs dirty.
      // Clearing them anyway would silently lose that work, so confirm first
      // instead of dropping it without warning.
      const unsaved = useEditorStore
        .getState()
        .openTabs.filter((t) => t.isDirty)
        .map((t) => t.name);
      if (unsaved.length > 0) {
        const proceed = window.confirm(
          `Some open files could not be saved (${unsaved.join(', ')}). ` +
            `Switching workspaces will lose those unsaved changes. Switch anyway?`,
        );
        if (!proceed) return; // abort the switch; keep the current workspace + tabs
      }
      const outgoingRoot = outgoing.getRootPath();
      if (outgoingRoot) {
        try {
          await writeDenyAllMcpSessionScopeFile({
            service: outgoing,
            workspaceRoot: outgoingRoot,
          });
        } catch (err) {
          console.warn('[MCP] Failed to close outgoing workspace scope:', err);
        }
      }
    }

    // Save previous workspace's tab state before switching
    const prevRootPath = useWorkspaceStore.getState().rootPath;
    if (prevRootPath) {
      useEditorStore.getState().saveWorkspaceState(prevRootPath);
    }

    // Clear current tab state
    useEditorStore.getState().clearTabState();

    workspaceServiceRef.current = service;
    setActiveWorkspaceService(service); // BUG-046: keep the flush accessor in sync
    setShowWorkspaceSelector(false);

    const newRootPath = service.getRootPath();
    if (newRootPath) {
      setRootPath(newRootPath);
    }

    // Keepance 3.0 — point the encrypted audit store at this workspace and load
    // any persisted "defense file" entries. On desktop this opens the SQLCipher
    // store under `<workspace>/.keepance/audit-enc.db`; in the browser it is a
    // no-op (localStorage already loaded). Seed the live view newest-first to
    // match the AuditLog's prepend ordering. Best-effort: never block workspace
    // selection on the audit store.
    if (newRootPath) {
      try {
        await auditServiceRef.current.hydrate(newRootPath);
        const loaded = auditServiceRef.current
          .getAll()
          .slice()
          .reverse(); // store is oldest-first; UI shows newest-first
        setAuditEntries(loaded);
        setAuditIntegrity(await auditServiceRef.current.verifyIntegrity());
      } catch (err) {
        console.warn('[App] Audit store hydrate failed:', err);
        setAuditIntegrity(undefined);
      }
    }

    // Stream C1 — Construct the templates marketplace service for this
    // workspace. Each workspace gets its own install root so installed
    // templates don't leak across projects. Skipped when no backend (e.g.
    // test mode shims that bypass createFSBackend).
    const backend = service.getBackend();
    const tplStore = useTemplatesMarketplaceStore.getState();
    if (backend && newRootPath) {
      try {
        const tplService = createTemplatesMarketplaceService(backend, newRootPath);
        const reader = new TemplateMetadataReader({ fs: backend });
        templatesMarketplaceServiceRef.current = tplService;
        templatesMetadataReaderRef.current = reader;
        // Seed the store so MarketplaceTab + offline banner can read the
        // service via useTemplatesMarketplace() instead of prop drilling.
        tplStore.setMarketplace(tplService, reader);
      } catch (err) {
        console.warn('[App] Failed to construct TemplatesMarketplaceService:', err);
        templatesMarketplaceServiceRef.current = null;
        templatesMetadataReaderRef.current = null;
        tplStore.clearMarketplace();
      }
    } else {
      templatesMarketplaceServiceRef.current = null;
      templatesMetadataReaderRef.current = null;
      tplStore.clearMarketplace();
    }

    let isNewWorkspace = false;

    // Create default folders if they don't exist
    try {
      // Create docs folder
      const docsPath = `${newRootPath}/docs`;
      const docsExists = await service.exists(docsPath);
      if (!docsExists) {
        await service.mkdir(docsPath);
        console.log('Created docs folder');
        isNewWorkspace = true;
      }

      // Create AI Chats folder
      const aiChatsPath = `${newRootPath}/AI Chats`;
      const aiChatsExists = await service.exists(aiChatsPath);
      if (!aiChatsExists) {
        await service.mkdir(aiChatsPath);
        console.log('Created AI Chats folder');
        isNewWorkspace = true;
      }

      // Create Research folder (skipped in the law-first experience)
      if (!isLawExperience()) {
        const researchPath = `${newRootPath}/Research`;
        const researchExists = await service.exists(researchPath);
        if (!researchExists) {
          await service.mkdir(researchPath);
          console.log('Created Research folder');
          isNewWorkspace = true;
        }
      }

      // Create Audio Recordings folder
      const audioPath = `${newRootPath}/Audio Recordings`;
      const audioExists = await service.exists(audioPath);
      if (!audioExists) {
        await service.mkdir(audioPath);
        console.log('Created Audio Recordings folder');
        isNewWorkspace = true;
      }
    } catch (error) {
      console.error('Failed to create default folders:', error);
    }

    // CRITICAL FIX: Immediately load file tree after creating folders
    // This ensures all folders are visible right away
    try {
      const fileTree = await service.getFileTree();
      const { setFileTree } = useWorkspaceStore.getState();
      setFileTree(fileTree);
      console.log('File tree loaded, folders now visible');
    } catch (error) {
      console.error('Failed to load file tree:', error);
    }

    // Load trash metadata after workspace is selected
    const items = await loadTrashMetadata();
    setTrashItems(items);

    // Update stats
    const totalSize = items.reduce((sum, item) => sum + (item.size ?? 0), 0);
    const oldestItem = items.length > 0
      ? items.reduce((oldest, item) =>
          item.deletedAt < oldest ? item.deletedAt : oldest,
          items[0]!.deletedAt
        )
      : undefined;
    setTrashStats({
      itemCount: items.length,
      totalSize,
      oldestItem,
    });

    // Load sources
    const cards = await loadSourceCards();
    setSourceCards(cards);

    // Load chat files
    const chats = await loadChatFiles();
    setChatFiles(chats);

    // Handle folder expansion: new workspaces expand all, existing load saved state
    if (newRootPath) {
      if (isNewWorkspace) {
        // New workspace - expand all folders by default
        // File tree is now loaded, so we can expand immediately
        const { expandAllFolders } = useWorkspaceStore.getState();
        expandAllFolders();
        console.log('All folders expanded for new workspace');
      } else {
        // Existing workspace - load saved expansion state, but also expand all as default
        const { loadExpandedPaths, expandAllFolders } = useWorkspaceStore.getState();
        const loaded = loadExpandedPaths(newRootPath);
        // If no saved state exists, expand all folders
        if (!loaded || useWorkspaceStore.getState().expandedPaths.size === 0) {
          expandAllFolders();
          console.log('No saved expansion state, expanding all folders');
        }
      }

      // Restore saved tab state for this workspace
      try {
        await useEditorStore.getState().restoreWorkspaceState(
          newRootPath,
          (path: string) => service.readFile(path),
          (path: string) => service.readFileBinary(path)
        );
        console.log('Restored workspace tab state');
      } catch (error) {
        console.error('Failed to restore workspace tab state:', error);
      }
    }
  }, [
    auditServiceRef,
    loadChatFiles,
    loadSourceCards,
    loadTrashMetadata,
    setAuditEntries,
    setAuditIntegrity,
    setChatFiles,
    setRootPath,
    setShowWorkspaceSelector,
    setSourceCards,
    setTrashItems,
    setTrashStats,
    templatesMarketplaceServiceRef,
    templatesMetadataReaderRef,
    workspaceServiceRef,
  ]);

  // Handle opening a recent project directly by path (Tauri only)
  const handleOpenRecentProject = useCallback(async (workspacePath: string) => {
    try {
      const backend = await createFSBackend(workspacePath);
      const service = createWorkspaceService();
      await service.initialize(backend, workspacePath);
      await handleWorkspaceSelected(service);
    } catch (err) {
      console.error('[App] Failed to open recent project:', err);
    }
  }, [handleWorkspaceSelected]);

  // Listen for audit entries written by the CRM Rust backend and push them
  // into the live `auditEntries` React state so they appear in the Activity
  // Log immediately — without waiting for the next workspace re-open.
  //
  // Root cause addressed: `append_crm_audit_best_effort` writes correctly to
  // the SQLCipher DB, but the Activity Log reads from in-memory React state
  // that is only populated at workspace hydration.  This listener bridges the
  // gap for the current session.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('__TAURI_INTERNALS__' in window) && !('__TAURI__' in window)) return;

    let unlisten: (() => void) | null = null;
    // Guards the race where this effect tears down before `listen()` resolves: if
    // we've already cleaned up, immediately call the unlisten we get back so the
    // listener never leaks past the effect's lifetime.
    let cancelled = false;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<AuditEntryRecord>(CRM_AUDIT_APPENDED_EVENT, (event) => {
        const rec = event.payload;
        let metadata: Record<string, unknown> = {};
        try {
          metadata = JSON.parse(rec.payloadJson) as Record<string, unknown>;
        } catch {
          // payload is not critical — leave metadata empty
        }
        const entry: AuditEntry = {
          id: rec.id,
          timestamp: rec.timestamp,
          action: rec.action as AuditActionType,
          description: rec.description,
          model: undefined,
          inputs: {},
          outputs: {},
          userDecision: undefined,
          metadata,
        };
        // Prepend newest-first, but DEDUPE by id: the same entry can arrive both via
        // this event and via the once-on-open DB read (or a StrictMode double-invoke),
        // and it must never appear twice in the Activity Log.
        setAuditEntries((prev) =>
          prev.some((e) => e.id === entry.id) ? prev : [entry, ...prev],
        );
      })
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => { /* best-effort — non-fatal if listener setup fails */ });
    }).catch(() => { /* best-effort */ });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [setAuditEntries]);

  return { handleWorkspaceSelected, handleOpenRecentProject };
}
