/**
 * useFileImport — owns handleGlobalFileDrop and handleImportFiles.
 *
 * Extracted from App.tsx (Wave 5b decomposition). The handler bodies are
 * copied VERBATIM from App.tsx; only the source of referenced values changed
 * (they now come from the options object instead of App's local scope).
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '@/platform/state/editorStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { writeDroppedFiles, importPickedFiles } from '@/platform/utils/fileDrop';
import { MemoryService } from '@/platform/rag/MemoryService';
import { raceDialogWithWatchdog } from '@/platform/fs/dialogWatchdog';
import type { PromptOptions } from '@/platform/hooks/usePromptDialog';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { FileNode } from '@/platform/types/workspace';
import type { UndoToastController } from '@/app/shell/common/UndoToast';
import { readTauriFile } from '@/platform/fs/tauriFsPlugin';

export interface UseFileImportOptions {
  rootPath: string | null;
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null>;
  setFileTree: (tree: FileNode[]) => void;
  handleFileOpen: (path: string, name: string) => Promise<unknown>;
  undoToast: UndoToastController;
  /**
   * QA-32: the native file picker can silently never respond on some
   * environments (see dialogWatchdog.ts). When that happens, this shows a
   * manual "type one file path" fallback instead of leaving "Add files"
   * stuck forever. Reuses the app's shared prompt dialog (usePromptDialog).
   */
  promptForPath?: (
    message: string,
    defaultValue?: string,
    options?: Omit<PromptOptions, 'defaultValue'>,
  ) => Promise<string | null>;
}

export function useFileImport({
  rootPath,
  workspaceServiceRef,
  setFileTree,
  handleFileOpen,
  undoToast,
  promptForPath,
}: UseFileImportOptions) {
  const { t } = useTranslation();
  // UX-19: Global drag-and-drop upload. Handles files dropped anywhere on
  // the window. Target folder resolves to the nearest `data-folder-path`
  // ancestor of the drop target, or workspace root if no folder was under
  // the cursor. Newly-written files are opened in tabs after the write.
  const handleGlobalFileDrop = useCallback(
    async (files: File[], folderPath: string | null) => {
      const service = workspaceServiceRef.current;
      if (!service || !rootPath) return;
      const targetFolder = folderPath ?? rootPath;
      try {
        const results = await writeDroppedFiles({
          service,
          targetFolder,
          files,
        });
        // Refresh tree
        const tree = await service.getFileTree();
        setFileTree(tree);
        // Open each written file in a tab. Opening sequentially keeps the
        // tab order consistent with the drop order.
        for (const r of results) {
          await handleFileOpen(r.path, r.name);
        }
        // UX-33: activate the last-dropped file so the user lands on
        // something they just dropped rather than the previously-active tab.
        if (results.length > 0) {
          const last = results.at(-1);
          if (last) useEditorStore.getState().setActiveTab(last.path);
        }
      } catch (err) {
        console.error('[App] Drag-drop upload failed:', err);
      }
    },
    [rootPath, setFileTree, handleFileOpen]
  );

  // BUG-014 — "Add files" import. Opens the native file picker, copies the
  // chosen files into the workspace, and EXPLICITLY indexes each (so search
  // works without relying on the file-watcher). Surfaces per-file failures.
  const handleImportFiles = useCallback(
    async (folderPath?: string | null) => {
      const service = workspaceServiceRef.current;
      if (!service || !rootPath) return;
      let selected: string | string[] | null = null;
      try {
        const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
        const raced = await raceDialogWithWatchdog(
          openDialog({
            multiple: true,
            directory: false,
            title: 'Add files to your workspace',
          }),
        );
        if (!raced.timedOut) {
          selected = raced.value;
        } else {
          // QA-32: the native file picker silently never responded — fall
          // back to a manual single-path entry instead of leaving "Add
          // files" stuck forever.
          console.warn(
            '[App] Add files: native picker did not respond within the watchdog window — falling back to manual path entry.',
          );
          selected = promptForPath
            ? await promptForPath(t('file-import.picker-unresponsive'), '', {
                title: t('file-import.manual-path-title'),
                placeholder: t('file-import.manual-path-placeholder'),
              })
            : null;
        }
      } catch (err) {
        console.error('[App] Add files: native picker unavailable', err);
        return;
      }
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;

      const readBinary = (p: string) =>
        service.readFileBinary
          ? service.readFileBinary(p)
          : Promise.reject(new Error('binary read unsupported'));
      const binaryWs = { readBinary };

      const results = await importPickedFiles({
        service,
        targetFolder: folderPath ?? rootPath,
        paths,
        readBytes: async (p) => {
          const u8 = await readTauriFile(p);
          const buf = new ArrayBuffer(u8.byteLength);
          new Uint8Array(buf).set(u8);
          return buf;
        },
        indexFile: (p) => MemoryService.indexFile(p),
        indexPdf: async (p) => {
          const r = await MemoryService.indexPdfFile(p, binaryWs, rootPath);
          return { indexed: r.indexed, ...(r.reason ? { reason: r.reason } : {}) };
        },
      });

      const tree = await service.getFileTree();
      setFileTree(tree);
      for (const r of results) {
        if (!r.error) {
          await handleFileOpen(r.path, r.name);
        }
      }
      if (results.length > 0) {
        const last = results.at(-1);
        if (last && !last.error) useEditorStore.getState().setActiveTab(last.path);
      }
      const failed = results.filter((r) => r.error);
      if (failed.length > 0) {
        console.error('[App] Add files: some files could not be imported', failed);
      }
      // BUG-015 — a PDF was imported but won't be searchable because PDF
      // indexing is off (the default). Don't fail silently: tell the user and
      // offer a one-tap enable (flipping the setting auto-triggers indexing).
      const pdfUnindexed = results.some((r) => r.reason === 'pdf-indexing-disabled');
      if (pdfUnindexed) {
        undoToast.show({
          message: 'Added — but PDF search is off, so this PDF will not be searchable yet.',
          actionLabel: 'Turn on PDF search',
          ttlMs: 15_000,
          onUndo: () => {
            useSettingsStore.getState().setSetting('includePdfsInWorkspaceIndex', true);
          },
        });
      }
    },
    [rootPath, setFileTree, handleFileOpen, undoToast, promptForPath, t]
  );

  return { handleGlobalFileDrop, handleImportFiles };
}
