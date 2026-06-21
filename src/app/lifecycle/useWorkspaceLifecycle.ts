/**
 * useWorkspaceLifecycle — owns workspace selection and recent-project opening.
 *
 * Extracted from App.tsx (Phase 3 decomposition). The two handler bodies are
 * copied VERBATIM from App.tsx; only the source of the referenced values
 * changed (they now come from the options object instead of App's local scope).
 */
import { useCallback } from 'react';
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
import type { AuditEntry } from '@/platform/types/audit';
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
    setShowWorkspaceSelector, setAuditEntries, setRootPath,
    loadTrashMetadata, setTrashItems, setTrashStats,
    loadSourceCards, setSourceCards, loadChatFiles, setChatFiles,
  } = options;

  const handleWorkspaceSelected = useCallback(async (service: WorkspaceService) => {
    // BUG-046: flush any dirty tabs of the OUTGOING workspace to disk BEFORE we
    // clear them — otherwise switching workspaces within the 2s autosave window
    // silently drops the last edits. Best-effort (never blocks the switch).
    const outgoing = workspaceServiceRef.current;
    if (outgoing) {
      await flushAllDirtyTabs(outgoing);
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
      } catch (err) {
        console.warn('[App] Audit store hydrate failed:', err);
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
  }, [loadTrashMetadata, loadSourceCards, loadChatFiles]);

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

  return { handleWorkspaceSelected, handleOpenRecentProject };
}
