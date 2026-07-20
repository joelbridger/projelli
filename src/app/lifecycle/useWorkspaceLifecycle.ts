/**
 * useWorkspaceLifecycle — owns workspace selection and recent-project opening.
 *
 * Extracted from App.tsx (Phase 3 decomposition). The two handler bodies are
 * copied VERBATIM from App.tsx; only the source of the referenced values
 * changed (they now come from the options object instead of App's local scope).
 */
import { useCallback, useEffect, useState } from 'react';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useEditorStore } from '@/platform/state/editorStore';
import {
  flushAllDirtyTabs,
  setActiveWorkspaceService,
} from '@/app/fileOps/flushDirtyTabs';
import { setMeetingsWorkspaceService } from '@/features/meetings/meetingStore';
import { setMeetingMaterialViewerResolver } from '@/platform/fs/meetingMaterialViewer';
import { useFirmStore } from '@/platform/firm/firmStore';
import { useTemplatesMarketplaceStore } from '@/features/workflows/templatesMarketplaceStore';
import {
  createTemplatesMarketplaceService,
  TemplateMetadataReader,
  type MarketplaceService,
} from '@/features/workflows/marketplace/svc';
import { isLawExperience } from '@/platform/profile/professionStore';
import {
  createWorkspaceService,
  type WorkspaceService,
} from '@/platform/fs/WorkspaceService';
import { createFSBackend } from '@/platform/fs/BackendFactory';
import { withTimeout } from '@/lib/withTimeout';
import { AuditService } from '@/platform/audit/AuditService';
import { writeDenyAllMcpSessionScopeFile } from '@/platform/mcp/mcpSessionScope';
import type { AuditEntry, AuditActionType } from '@/platform/types/audit';
import type {
  AuditEntryRecord,
  AuditIntegrityVerdict,
} from '@/platform/utils/tauri-commands';
import { CRM_AUDIT_APPENDED_EVENT } from '@/platform/utils/wealthbox-commands';
import { WRITEBACK_AUDIT_APPENDED_EVENT } from '@/platform/utils/external-write-commands';
import type { TrashedItem, TrashStats } from '@/platform/history/TrashService';
import type { SourceCard } from '@/features/ask/types/research';
import type { AIChatFile } from '@/platform/types/ai';
import type { ConfirmOptions } from '@/platform/hooks/useConfirmDialog';
import { describeWorkspaceOpenError } from '@/platform/fs/workspaceOpenErrors';
import { reloadWorkspaceScopedStores } from '@/platform/state/reloadWorkspaceScopedStores';
import { flushPendingMatterMigrationAudit } from '@/platform/matter/matterStore';
import { clearCitationVerificationCache } from '@/features/ask/citationVerification';
import { useAppNavigationStore } from '@/platform/state/appNavigationStore';
import { setIntakeFactsWorkspace } from '@/platform/intake/factsStore';

// Bounds only the native SETUP (backend creation + initialize) — the SAME
// budget/label WorkspaceSelector's manual "Open Existing" flow uses for the
// identical step, so a hung native call (e.g. an unreachable network share)
// can never leave the caller waiting forever. The recursive file-tree SCAN
// inside handleWorkspaceSelected is deliberately left unbounded, matching
// WorkspaceSelector: a legitimately large or slow-but-healthy workspace must
// still be allowed to open.
const WORKSPACE_OPEN_TIMEOUT_MS = 30_000;
const WORKSPACE_OPEN_LABEL = 'Opening the workspace';
// The encrypted Activity Log is important, but it is not required to mount a
// workspace. On Linux/headless systems an unavailable desktop keychain can
// leave the native keyring call blocked indefinitely. Keep the app usable and
// leave the log unavailable for this session rather than trapping the user on
// the workspace-opening screen.
const AUDIT_HYDRATE_TIMEOUT_MS = 5_000;
const AUDIT_HYDRATE_LABEL = 'Opening the encrypted Activity Log';

function parseAuditEntryRecord(rec: AuditEntryRecord): AuditEntry {
  // payloadJson is a full AuditEntry (the same shape the encrypted store
  // persists). Parse it and trust the record's summary columns for the indexed
  // fields — mirrors AuditService.recordToEntry. Always end with a metadata
  // OBJECT so the Activity Log's `metadata['scope']` read can never hit undefined.
  try {
    const parsed = JSON.parse(rec.payloadJson) as Partial<AuditEntry>;
    return {
      ...(parsed as AuditEntry),
      id: rec.id,
      timestamp: rec.timestamp,
      action: rec.action as AuditActionType,
      description: rec.description,
      metadata:
        parsed.metadata && typeof parsed.metadata === 'object'
          ? parsed.metadata
          : {},
    };
  } catch {
    return {
      id: rec.id,
      timestamp: rec.timestamp,
      action: rec.action as AuditActionType,
      description: rec.description,
      model: undefined,
      inputs: {},
      outputs: {},
      userDecision: undefined,
      metadata: {},
    };
  }
}

export interface UseWorkspaceLifecycleOptions {
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null>;
  /**
   * In-app confirm dialog. Native window.confirm is dead in the Tauri WebView2
   * Windows build (renders nothing AND returns a truthy object), so the
   * "lose unsaved changes?" guard below MUST use the in-DOM dialog or it would
   * silently proceed and drop the user's work.
   */
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  auditServiceRef: React.MutableRefObject<AuditService>;
  templatesMarketplaceServiceRef: React.MutableRefObject<MarketplaceService | null>;
  templatesMetadataReaderRef: React.MutableRefObject<TemplateMetadataReader | null>;
  setShowWorkspaceSelector: React.Dispatch<React.SetStateAction<boolean>>;
  setAuditEntries: React.Dispatch<React.SetStateAction<AuditEntry[]>>;
  setAuditIntegrity: React.Dispatch<
    React.SetStateAction<AuditIntegrityVerdict | undefined>
  >;
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
    workspaceServiceRef,
    auditServiceRef,
    templatesMarketplaceServiceRef,
    templatesMetadataReaderRef,
    setShowWorkspaceSelector,
    setAuditEntries,
    setAuditIntegrity,
    setRootPath,
    loadTrashMetadata,
    setTrashItems,
    setTrashStats,
    loadSourceCards,
    setSourceCards,
    loadChatFiles,
    setChatFiles,
    confirm,
  } = options;

  // QA-33: "reopen a recent workspace" (the toolbar's Recent Projects menu,
  // AND the silent boot-time auto-resume) used to swallow every failure into
  // a bare `console.error` — a stopped OS credential service could leave the
  // whole attempt hanging for 30s and then fail with literally nothing shown
  // to the user. This is the one piece of UI state both call sites share so
  // a caller (App.tsx) can render an honest, dismissible message whenever
  // that happens, instead of a silent no-op.
  const [workspaceOpenError, setWorkspaceOpenError] = useState<string | null>(
    null
  );
  const dismissWorkspaceOpenError = useCallback(() => {
    setWorkspaceOpenError(null);
  }, []);

  // QA-93: swap the per-workspace matter + client-map stores whenever the active
  // workspace root changes. Driving this off the store (rather than calling it
  // from each open handler) makes the swap ATOMIC with the `rootPath` change for
  // EVERY entry path — Open Existing, Recent Projects, and boot auto-resume all
  // funnel through the same `useWorkspaceStore` `setRootPath` — so a new
  // workspace is never briefly visible with the previous workspace's clients.
  useEffect(() => {
    let prevRoot = useWorkspaceStore.getState().rootPath;
    // Load the current root once at mount too (covers a remount with a workspace
    // already open, e.g. a hot reload), so the stores are never left showing the
    // legacy global data while a workspace is open.
    if (prevRoot) reloadWorkspaceScopedStores(prevRoot);
    return useWorkspaceStore.subscribe((state) => {
      const nextRoot = state.rootPath;
      if (nextRoot === prevRoot) return;
      prevRoot = nextRoot;
      clearCitationVerificationCache();
      reloadWorkspaceScopedStores(nextRoot);
    });
  }, []);

  // Returns whether the switch COMMITTED (round 3, Codex F2): the unsaved-
  // changes guard below can still abort after a caller has fully prepared the
  // new workspace's service, so no caller may mutate any global state (root,
  // file tree, recents, scoped stores) on its own — the root is committed in
  // exactly one place, inside this handler, after the switch is irrevocable.
  // Callers that need to know (the Workspace Selector, onboarding) await this
  // and treat `false` as "the user stayed on the current workspace".
  const handleWorkspaceSelected = useCallback(
    async (service: WorkspaceService): Promise<boolean> => {
      // BUG-046: flush any dirty tabs of the OUTGOING workspace to disk BEFORE we
      // clear them — otherwise switching workspaces within the 2s autosave window
      // silently drops the last edits.
      const outgoing = workspaceServiceRef.current;
      if (outgoing) {
        // QA-34: flushAllDirtyTabs returns the .docx paths whose final save just
        // FAILED — the authoritative signal (more reliable than re-querying the
        // registry, whose state can lag a just-failed save that hasn't re-rendered).
        const failedDocxPaths = await flushAllDirtyTabs(outgoing);
        // Codex review #2: a flush can FAIL (disk/permission) and leave tabs dirty.
        // Clearing them anyway would silently lose that work, so confirm first
        // instead of dropping it without warning.
        const unsaved = useEditorStore
          .getState()
          .openTabs.filter((t) => t.isDirty)
          .map((t) => t.name);
        // A .docx whose save failed never appears as a dirty store tab, so add its
        // file name here or the switch would silently discard it.
        for (const p of failedDocxPaths) {
          const name = p.split(/[\\/]/).pop() ?? p;
          if (!unsaved.includes(name)) unsaved.push(name);
        }
        if (unsaved.length > 0) {
          const proceed = await confirm(
            `Some open files could not be saved (${unsaved.join(', ')}). ` +
              `Switching workspaces will lose those unsaved changes. Switch anyway?`,
            {
              title: 'Unsaved changes',
              confirmLabel: 'Switch anyway',
              cancelLabel: 'Keep editing',
              variant: 'destructive',
            }
          );
          if (!proceed) return false; // abort the switch; keep the current workspace + tabs
        }
        const outgoingRoot = outgoing.getRootPath();
        if (outgoingRoot) {
          try {
            await writeDenyAllMcpSessionScopeFile({
              service: outgoing,
              workspaceRoot: outgoingRoot,
            });
          } catch (err) {
            console.warn(
              '[MCP] Failed to close outgoing workspace scope:',
              err
            );
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
      setMeetingsWorkspaceService(service); // Wave 3c: keep the meetings feature's accessor in sync
      // CONTAINMENT (WB-085): the file-backed meeting gate needs to know who is
      // looking. Until this is wired the viewer is unresolved, which refuses
      // every stamped meeting file — fail-closed, never fail-open.
      setMeetingMaterialViewerResolver(
        () => useFirmStore.getState().session?.userId ?? null
      );
      setShowWorkspaceSelector(false);

      const newRootPath = service.getRootPath();
      if (newRootPath) {
        useAppNavigationStore.getState().clear();
        setRootPath(newRootPath);
        // NOTE: the `.lantern` data-folder setup runs earlier, in createFSBackend
        // (the single desktop backend factory), so it happens BEFORE vault_status
        // wraps the backend and before any store opens here.
        // Register EVERY workspace open in Recents at this shared lifecycle
        // boundary. This is the ONE point that reliably runs for BOTH the normal
        // Workspace Selector open AND the onboarding sample/own path (which
        // bypasses the Selector's own addRecentWorkspace call). Without a recent
        // workspace, the first-run gate
        // (`!hasCompletedOnboarding() && recentWorkspaces.length === 0`) stays
        // true and the sample path loops back to the intro.
        //
        // A prior fix put this call in App.tsx's onboarding handler
        // (handleOnboardingChooseStart), but on the real Windows flow that call
        // never fired — its own `[RecentWorkspaces] Saved` log never appeared,
        // even though code textually after it ran. This boundary, by contrast,
        // demonstrably runs on the sample path (all of its neighbours' logs fire
        // in QA), so it is the correct, canonical home for the call.
        // addRecentWorkspace dedupes by path, so the normal path (where the
        // Selector already added it) does not create a duplicate.
        console.log('[Recents] registering', newRootPath);
        useWorkspaceStore.getState().addRecentWorkspace({
          path: newRootPath,
          name:
            newRootPath
              .split(/[/\\]+/)
              .filter(Boolean)
              .pop() ?? newRootPath,
          lastOpened: new Date(),
        });
      }

      // Lantern 3.0 — point the encrypted audit store at this workspace and load
      // any persisted "defense file" entries. On desktop this opens the SQLCipher
      // store under `<workspace>/.lantern/audit-enc.db`; in the browser it is a
      // no-op (localStorage already loaded). Seed the live view newest-first to
      // match the AuditLog's prepend ordering. Best-effort: never block workspace
      // selection on the audit store.
      if (newRootPath) {
        let auditWorkspaceReady = false;
        try {
          auditWorkspaceReady = await withTimeout(
            auditServiceRef.current.hydrate(newRootPath),
            AUDIT_HYDRATE_TIMEOUT_MS,
            AUDIT_HYDRATE_LABEL
          );
          if (auditWorkspaceReady) {
            const loaded = auditServiceRef.current.getAll().slice().reverse(); // store is oldest-first; UI shows newest-first
            setAuditEntries(loaded);
            // This opens the same encrypted database a second time, so it
            // needs the same bound. An unavailable keychain must not turn a
            // successful workspace open back into an endless spinner.
            setAuditIntegrity(
              await withTimeout(
                auditServiceRef.current.verifyIntegrity(),
                AUDIT_HYDRATE_TIMEOUT_MS,
                AUDIT_HYDRATE_LABEL
              )
            );
          } else {
            setAuditIntegrity(undefined);
          }
        } catch (err) {
          console.warn(
            '[App] Encrypted Activity Log unavailable; opening workspace without its history for this session:',
            err
          );
          setAuditIntegrity(undefined);
        }
        // Wave 4 Track D — enforce this workspace's retention policy at most once
        // a day. Best-effort and dynamically imported so a slow/failed sweep never
        // blocks workspace selection or grows the lifecycle hook's static graph.
        void import('@/platform/privacy/retentionRunner')
          .then(({ runRetentionSweep }) => runRetentionSweep(newRootPath))
          .catch((err: unknown) => {
            console.warn('[App] Retention sweep failed:', err);
          });
        // QA-93 round 3 (Codex F1): the per-workspace migration (which ran inside
        // the store reload when setRootPath fired above) may have queued
        // plain-language entries about folder mappings it could not carry over.
        // Deliver them NOW — after the audit store points at THIS workspace — so
        // they land in the right workspace's Activity Log, never the previous one's.
        if (auditWorkspaceReady) flushPendingMatterMigrationAudit(newRootPath);
        try {
          await setIntakeFactsWorkspace(newRootPath);
        } catch (err) {
          console.warn('[App] Intake facts store setup failed:', err);
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
          const tplService = createTemplatesMarketplaceService(
            backend,
            newRootPath
          );
          const reader = new TemplateMetadataReader({ fs: backend });
          templatesMarketplaceServiceRef.current = tplService;
          templatesMetadataReaderRef.current = reader;
          // Seed the store so MarketplaceTab + offline banner can read the
          // service via useTemplatesMarketplace() instead of prop drilling.
          tplStore.setMarketplace(tplService, reader);
        } catch (err) {
          console.warn(
            '[App] Failed to construct TemplatesMarketplaceService:',
            err
          );
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
      const oldestItem =
        items.length > 0
          ? items.reduce(
              (oldest, item) =>
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
          const { loadExpandedPaths, expandAllFolders } =
            useWorkspaceStore.getState();
          const loaded = loadExpandedPaths(newRootPath);
          // If no saved state exists, expand all folders
          if (
            !loaded ||
            useWorkspaceStore.getState().expandedPaths.size === 0
          ) {
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
      return true;
    },
    [
      auditServiceRef,
      confirm,
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
    ]
  );

  // Handle opening a recent project directly by path (Tauri only). Used by
  // both the toolbar's "Recent Projects" menu (an explicit user click, while
  // some other workspace may already be open) and useAutoResumeWorkspace's
  // silent boot-time reopen — neither call site ever has anything destructive
  // riding on this succeeding (the CURRENT workspace, if any, is untouched
  // until `handleWorkspaceSelected` actually runs), so on failure it's always
  // safe to just surface why and let the caller fall back to its own normal
  // state (the picker, or the still-open previous workspace) rather than
  // blocking anything.
  const handleOpenRecentProject = useCallback(
    async (workspacePath: string) => {
      try {
        const service = await withTimeout(
          (async () => {
            const backend = await createFSBackend(workspacePath);
            const svc = createWorkspaceService();
            await svc.initialize(backend, workspacePath);
            return svc;
          })(),
          WORKSPACE_OPEN_TIMEOUT_MS,
          WORKSPACE_OPEN_LABEL
        );
        setWorkspaceOpenError(null);
        await handleWorkspaceSelected(service);
      } catch (err) {
        console.error('[App] Failed to open recent project:', err);
        setWorkspaceOpenError(describeWorkspaceOpenError(err));
      }
    },
    [handleWorkspaceSelected]
  );

  // Listen for audit entries written by the CRM Rust backend and push them
  // into the live `auditEntries` React state so they appear in the Activity
  // Log immediately — without waiting for the next workspace re-open.
  //
  // Root cause addressed: `append_crm_audit_best_effort` writes correctly to
  // the SQLCipher DB, but the Activity Log reads from in-memory React state
  // that is only populated at workspace hydration. The writeback backend has
  // the same shape: its audit row is durable, but the current-session Activity
  // Log needs the live event to see it. These listeners bridge that gap.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('__TAURI_INTERNALS__' in window) && !('__TAURI__' in window)) return;

    let unlistenCrm: (() => void) | null = null;
    let unlistenWriteback: (() => void) | null = null;
    // Guards the race where this effect tears down before `listen()` resolves: if
    // we've already cleaned up, immediately call the unlisten we get back so the
    // listener never leaks past the effect's lifetime.
    let cancelled = false;
    const handleAuditAppended = (event: { payload: AuditEntryRecord }) => {
      const entry = parseAuditEntryRecord(event.payload);
      // Prepend newest-first, but DEDUPE by id: the same entry can arrive both via
      // this event and via the once-on-open DB read (or a StrictMode double-invoke),
      // and it must never appear twice in the Activity Log.
      setAuditEntries((prev) =>
        prev.some((e) => e.id === entry.id) ? prev : [entry, ...prev]
      );
    };

    import('@tauri-apps/api/event')
      .then(({ listen }) => {
        const listenForAuditEvent = (
          eventName: string,
          setUnlisten: (fn: () => void) => void
        ) => {
          listen<AuditEntryRecord>(eventName, handleAuditAppended)
            .then((fn) => {
              if (cancelled) fn();
              else setUnlisten(fn);
            })
            .catch(() => {
              /* best-effort — non-fatal if listener setup fails */
            });
        };

        listenForAuditEvent(CRM_AUDIT_APPENDED_EVENT, (fn) => {
          unlistenCrm = fn;
        });
        listenForAuditEvent(WRITEBACK_AUDIT_APPENDED_EVENT, (fn) => {
          unlistenWriteback = fn;
        });
      })
      .catch(() => {
        /* best-effort */
      });

    return () => {
      cancelled = true;
      unlistenCrm?.();
      unlistenWriteback?.();
    };
  }, [setAuditEntries]);

  return {
    handleWorkspaceSelected,
    handleOpenRecentProject,
    workspaceOpenError,
    dismissWorkspaceOpenError,
  };
}
