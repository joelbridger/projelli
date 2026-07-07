/**
 * useFileOperations — owns file CRUD, save, rename, move, download, and
 * file-tree refresh for the App shell.
 *
 * Extracted from App.tsx (Phase 3 decomposition). All 9 handler bodies are
 * copied VERBATIM from App.tsx; only the source of the referenced values
 * changed (they now come from the options object instead of App's local scope).
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useEditorStore } from '@/platform/state/editorStore';
import { writeCoordinator } from '@/platform/fs/writeCoordinator';
import { saveFile } from '@/platform/utils/saveFile';
import { isBinaryFile } from '@/platform/utils/file-utils';
import { writeTabContentToDisk } from '@/app/fileOps/flushDirtyTabs';
import { createFileTreeSnapshot } from '@/platform/fs/FileSystemWatcher';
import { findUniqueDefaultName } from './uniqueDefaultName';
import { reservedNameError } from './reservedNameError';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { FileSystemWatcher } from '@/platform/fs/FileSystemWatcher';
import type { FileNode } from '@/platform/types/workspace';
import type { PromptOptions } from '@/platform/hooks/usePromptDialog';
import type { useContentIndex } from '@/platform/hooks/useContentIndex';

type OpenTab = ReturnType<typeof useEditorStore.getState>['openTabs'][number];
type ContentIndex = ReturnType<typeof useContentIndex>;

export interface UseFileOperationsOptions {
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null>;
  fileSystemWatcherRef: React.MutableRefObject<FileSystemWatcher | null>;
  handleFileOpen: (path: string, name: string) => Promise<unknown>;
  prompt: (message: string, defaultValue?: string, options?: Omit<PromptOptions, 'defaultValue'>) => Promise<string | null>;
  setFileTree: (tree: FileNode[]) => void;
  markSaved: (path: string, savedRev?: number) => void;
  contentIndex: ContentIndex;
  openTabs: OpenTab[];
  closeTab: (path: string) => void;
  renameHistoryRef: React.MutableRefObject<Array<{ fromPath: string; toPath: string }>>;
  undoStackRef: React.MutableRefObject<Array<'rename' | 'delete'>>;
}

export function useFileOperations(options: UseFileOperationsOptions) {
  const { t } = useTranslation();
  const {
    workspaceServiceRef,
    fileSystemWatcherRef,
    handleFileOpen,
    prompt,
    setFileTree,
    markSaved,
    contentIndex,
    renameHistoryRef,
    undoStackRef,
  } = options;

  // UX-35: shared writer that routes binary file extensions (.docx, .xlsx,
  // .pptx, .rtf, etc.) through writeFileBinary using the bytes decoded
  // from the editor's data-URL content. The Save path (handleSaveFile)
  // and the autosave interval both call into this so the two can't drift.
  //
  // Why this matters: DocxEditor (and the other binary-format editors)
  // pushes tab content as a `data:...base64,...` string. The previous
  // writeFile(path, content) path stored that string literally as UTF-8
  // text on disk, which destroyed the actual .docx/.xlsx bytes —
  // re-opening the file produced JSZip's "can't find end of central
  // directory" error because the on-disk bytes were a base64 text blob
  // instead of a zip archive.
  const writeTabContent = useCallback(
    async (path: string, content: string): Promise<void> => {
      const service = workspaceServiceRef.current;
      if (!service) return;
      // Delegate to the shared binary-aware writer so the autosave/manual-save
      // path and the flush-on-exit path (flushDirtyTabs) can never drift.
      await writeTabContentToDisk(service, path, content);
    },
    [workspaceServiceRef]
  );

  // Handle file save
  const handleSaveFile = useCallback(
    async (path: string, content: string) => {
      if (!workspaceServiceRef.current) return;

      // BUG-045/045: capture the tab's content AND revision from ONE live store
      // snapshot (Codex review #6). The caller's `content` arg can be a stale
      // React prop one edit behind; pairing it with the live `rev` could write
      // old bytes and then mark the tab clean over a newer edit. Reading both
      // from the store together keeps them consistent. Route through the per-path
      // coordinator so a manual save and the 2s autosave can't land out of order;
      // mark clean only if the tab is still at this rev.
      const liveTab = useEditorStore.getState().openTabs.find((t) => t.path === path);
      const saveContent = liveTab?.content ?? content;
      const rev = liveTab?.rev ?? 0;
      try {
        await writeCoordinator.enqueue(path, rev, () => writeTabContent(path, saveContent));
        markSaved(path, rev);

        // Refresh file tree
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);

        // UX-26: keep the content index current so the next search sees
        // the just-saved text. Binary writes skip this path — the index
        // builder re-extracts via extractForAI anyway on a full rebuild.
        if (!isBinaryFile(path)) {
          const name = path.split('/').pop() ?? path;
          contentIndex.upsert({ id: path, path, name, content: saveContent });
        }
      } catch (error) {
        console.error('Failed to save file:', error);
      }
    },
    [markSaved, setFileTree, contentIndex, writeTabContent, workspaceServiceRef]
  );

  // Handle create new file
  const handleCreateFile = useCallback(
    async (parentPath: string) => {
      // BUG (2026-07-01): default value used to be '' — 'myfile.txt' was only
      // the placeholder, so OK-on-default confirmed an empty name and the
      // `!name` guard below silently no-op'd. Seed a real, collision-free
      // default (full name here — unlike the docx/text-file creators, this
      // dialog uses the returned value verbatim as the filename).
      const defaultName = await findUniqueDefaultName(
        (fullName) => workspaceServiceRef.current?.exists(`${parentPath}/${fullName}`) ?? Promise.resolve(false),
        'untitled',
        '.txt',
      );
      const name = await prompt('Enter file name:', `${defaultName}.txt`, {
        title: 'Create File',
        placeholder: 'myfile.txt',
        // UX-15: show the user which folder they're creating into. For
        // subfolder-right-click-create this is the most useful info.
        destinationPath: `${parentPath}/`,
        validate: (v) => (v.trim() ? reservedNameError(v, t) : 'Enter a file name.'),
      });
      if (!name || !workspaceServiceRef.current) return;

      const filePath = `${parentPath}/${name}`;
      try {
        await workspaceServiceRef.current.writeFile(filePath, '');
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);
        await handleFileOpen(filePath, name);
      } catch (error) {
        console.error('Failed to create file:', error);
        window.alert("I couldn't create that. Try a different name.");
      }
    },
    [setFileTree, handleFileOpen, prompt, t, workspaceServiceRef]
  );

  // Handle create new folder
  const handleCreateFolder = useCallback(
    async (parentPath: string) => {
      const targetParentPath = parentPath || useWorkspaceStore.getState().rootPath;
      if (!targetParentPath) return;
      const defaultName = await findUniqueDefaultName(
        (fullName) => workspaceServiceRef.current?.exists(`${targetParentPath}/${fullName}`) ?? Promise.resolve(false),
        'my-folder',
      );
      const name = await prompt('Enter folder name:', defaultName, {
        title: 'Create Folder',
        placeholder: 'my-folder',
        // UX-15: also show destination for folder creation.
        destinationPath: `${targetParentPath}/`,
        validate: (v) => (v.trim() ? reservedNameError(v, t) : 'Enter a folder name.'),
      });
      if (!name || !workspaceServiceRef.current) return;

      const folderPath = `${targetParentPath}/${name}`;
      try {
        await workspaceServiceRef.current.mkdir(folderPath);
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);

        // Auto-expand the newly created folder
        const { expandedPaths, setExpandedPaths } = useWorkspaceStore.getState();
        const newExpanded = new Set(expandedPaths);
        newExpanded.add(folderPath);
        setExpandedPaths(newExpanded);
      } catch (error) {
        console.error('Failed to create folder:', error);
        window.alert("I couldn't create that. Try a different name.");
      }
    },
    [setFileTree, prompt, t, workspaceServiceRef]
  );

  // Handle rename (prompts user)
  const handleRename = useCallback(
    async (path: string) => {
      const currentName = path.split('/').pop() ?? '';
      const newName = await prompt('Enter new name:', currentName, {
        title: 'Rename',
        validate: (v) => (v.trim() ? undefined : 'Enter a name.'),
      });
      if (!newName || newName === currentName || !workspaceServiceRef.current) return;

      try {
        await workspaceServiceRef.current.rename(path, newName);
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);

        // UX-16: record the rename so Ctrl+Z can revert it within the
        // session. We store the full old/new absolute paths so undo can
        // call `rename(newPath, oldName)` without re-deriving anything.
        const parent = path.substring(0, path.lastIndexOf('/'));
        const newPath = `${parent}/${newName}`;
        useEditorStore.getState().renameOpenTab(path, newPath, newName);
        renameHistoryRef.current.push({ fromPath: path, toPath: newPath });
        // UX-29: track the kind of action so Ctrl+Z can undo the most
        // recent destructive change (either rename OR delete), not just
        // the most recent rename.
        undoStackRef.current.push('rename');
      } catch (error) {
        console.error('Failed to rename:', error);
        window.alert("I couldn't rename that file. Make sure it isn't open in another app, then try again.");
      }
    },
    [setFileTree, prompt, renameHistoryRef, undoStackRef, workspaceServiceRef]
  );

  // Handle rename with provided name (for tab double-click)
  const handleRenameWithName = useCallback(
    async (path: string, newName: string) => {
      if (!workspaceServiceRef.current) return;
      const currentName = path.split('/').pop() ?? '';
      if (newName === currentName) return;

      try {
        await workspaceServiceRef.current.rename(path, newName);
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);

        // Update the tab name in the editor store
        const oldPath = path;
        const newPath = path.substring(0, path.lastIndexOf('/') + 1) + newName;
        useEditorStore.getState().renameOpenTab(oldPath, newPath, newName);

        // UX-16: track the rename for session-level Ctrl+Z undo.
        renameHistoryRef.current.push({ fromPath: oldPath, toPath: newPath });
        // UX-29: push onto the combined undo stack so Ctrl+Z knows which
        // stack to pop.
        undoStackRef.current.push('rename');
      } catch (error) {
        console.error('Failed to rename:', error);
        window.alert("I couldn't rename that file. Make sure it isn't open in another app, then try again.");
      }
    },
    [setFileTree, renameHistoryRef, undoStackRef, workspaceServiceRef]
  );


  // Handle download file
  const handleDownload = useCallback(
    async (path: string, name: string) => {
      if (!workspaceServiceRef.current) return;

      try {
        // BUG-034: a download is "give me this file exactly as it is on disk".
        // We ALWAYS copy the raw bytes — reading the file as text (the old path)
        // corrupts any binary file (PDF/DOCX/XLSX/image/etc.), and reading bytes
        // is lossless for text files too. Reading bytes is also independent of
        // the isBinaryFile() extension list, so an unusual-but-binary extension
        // can never silently fall through to the corrupting text path.
        // `saveFile` writes an ArrayBuffer as bytes in both Tauri and browser.
        const content = await workspaceServiceRef.current.readFileBinary(path);

        // Use cross-platform saveFile utility (works in both browser and Tauri)
        await saveFile(content, {
          suggestedName: name,
        });
      } catch (error) {
        // User cancelled or error occurred
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Failed to download file:', error);
        }
      }
    },
    [workspaceServiceRef]
  );


  // Handle move (drag and drop)
  // Refresh file tree (for AI file changes)
  const refreshFileTree = useCallback(async () => {
    if (!workspaceServiceRef.current) return;
    try {
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);

      // Update watcher snapshot to prevent false positives
      if (fileSystemWatcherRef.current) {
        await fileSystemWatcherRef.current.updateSnapshot(async () => {
          return createFileTreeSnapshot(fileTree);
        });
      }
    } catch (error) {
      console.error('Failed to refresh file tree:', error);
    }
  }, [setFileTree, fileSystemWatcherRef, workspaceServiceRef]);

  const handleMove = useCallback(
    async (sourcePath: string, targetPath: string) => {
      if (!workspaceServiceRef.current) return;

      try {
        const sourceName = sourcePath.split('/').pop() ?? '';
        const newPath = `${targetPath}/${sourceName}`;
        await workspaceServiceRef.current.move(sourcePath, newPath);
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);
      } catch (error) {
        console.error('Failed to move:', error);
        window.alert("I couldn't move that. Try again.");
      }
    },
    [setFileTree, workspaceServiceRef]
  );

  return {
    writeTabContent,
    handleSaveFile,
    handleCreateFile,
    handleCreateFolder,
    handleRename,
    handleRenameWithName,
    handleDownload,
    refreshFileTree,
    handleMove,
  };
}
