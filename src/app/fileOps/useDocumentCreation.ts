/**
 * useDocumentCreation — owns the "create" handler group for documents and
 * folders at the workspace root (plain text, .docx, folder, letterhead).
 *
 * Extracted from App.tsx (Phase 3 decomposition). All 5 handler bodies are
 * copied VERBATIM from App.tsx; only the source of the referenced values
 * changed (they now come from the options object instead of App's local scope).
 */
import React, { useCallback } from 'react';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useEditorStore } from '@/platform/state/editorStore';
import { createBlankDocx, docxBytesToDataUrl } from '@/platform/utils/docx-io';
import { findUniqueDefaultName } from './uniqueDefaultName';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { FileNode } from '@/platform/types/workspace';
import type { PromptOptions } from '@/platform/hooks/usePromptDialog';
import type { ConfirmOptions } from '@/platform/hooks/useConfirmDialog';

type OpenFile = ReturnType<typeof useEditorStore.getState>['openFile'];

export interface UseDocumentCreationOptions {
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null>;
  rootPath: string | null;
  setFileTree: (tree: FileNode[]) => void;
  prompt: (message: string, defaultValue?: string, options?: Omit<PromptOptions, 'defaultValue'>) => Promise<string | null>;
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  handleFileOpen: (path: string, name: string) => Promise<void>;
  openFile: OpenFile;
}

export function useDocumentCreation(options: UseDocumentCreationOptions) {
  const {
    workspaceServiceRef,
    rootPath,
    setFileTree,
    prompt,
    confirm,
    handleFileOpen,
    openFile,
  } = options;

  // Handle create plain text file in a target folder (defaults to docs folder).
  const handleCreateTextFileAtRoot = useCallback(async (parentPath?: string) => {
    if (!workspaceServiceRef.current || !rootPath) return;
    // Defensive (2026-07-01 re-fix): only a real string may be a create target.
    // A non-string `parentPath` (e.g. a corrupted matter folder object) would
    // otherwise stringify into `destDir` as the literal "[object Object]" and
    // create a garbage folder. Coerce anything non-string back to the default.
    const safeParent = typeof parentPath === 'string' ? parentPath : undefined;
    const destDir = safeParent ?? `${rootPath}/docs`;
    console.log('[DocCreate] text destDir:', destDir);
    // BUG (2026-07-01): the default value used to be '' — 'my-notes' was only
    // the placeholder, so pressing OK on the default silently created nothing
    // (name === '' fails the `!name` check below with no error). Seed a REAL,
    // collision-free default so OK-on-default always creates a file.
    const defaultName = await findUniqueDefaultName(
      (fullName) => workspaceServiceRef.current?.exists(`${destDir}/${fullName}`) ?? Promise.resolve(false),
      'my-notes',
      '.txt',
    );
    const name = await prompt('Enter file name (without extension):', defaultName, {
      title: 'Create Text File',
      placeholder: 'my-notes',
      destinationPath: `${destDir}/`,
      previewExtension: '.txt',
      validate: (v) => (v.trim() ? undefined : 'Enter a file name.'),
    });
    if (!name) return;

    const fileName = name.endsWith('.txt') ? name : `${name}.txt`;
    const filePath = `${destDir}/${fileName}`;
    try {
      await workspaceServiceRef.current.writeFile(filePath, '');
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
      await handleFileOpen(filePath, fileName);
    } catch (error) {
      console.error('Failed to create text file:', error);
    }
  }, [rootPath, setFileTree, handleFileOpen, prompt, workspaceServiceRef]);

  // VG-4c — pick a Word file as the firm letterhead template. Stores its path
  // in the `letterheadTemplatePath` setting; new documents and workflow
  // deliverables then start from it. Confirms via the standard dialog.
  const handleSetLetterheadTemplate = useCallback(
    (path: string) => {
      useSettingsStore.getState().setSetting('letterheadTemplatePath', path);
      const name = path.split('/').pop() ?? path;
      void confirm(
        `New documents and workflow deliverables will now start from "${name}". You can change or clear this in Settings under Files & Workspace.`,
        {
          title: 'Letterhead template set',
          confirmLabel: 'Got it',
          cancelLabel: 'Close',
        },
      );
    },
    [confirm],
  );

  // Handle create blank .docx file at root (goes to docs folder)
  const handleCreateDocxAtRoot = useCallback(async (parentPath?: string) => {
    if (!workspaceServiceRef.current || !rootPath) return;
    // R6-1: create in the folder the user has open when provided; otherwise
    // fall back to the canonical `<root>/docs` folder.
    // Defensive (2026-07-01 re-fix): only a real string may be a create target —
    // a non-string `parentPath` (a corrupted matter folder object) would
    // stringify to the literal "[object Object]" and write to a garbage folder.
    const safeParent = typeof parentPath === 'string' ? parentPath : undefined;
    const destDir = safeParent ?? `${rootPath}/docs`;
    console.log('[DocCreate] docx destDir:', destDir);
    // BUG (2026-07-01): default value used to be '' — 'my-document' was only
    // the placeholder shown in the (unfilled) input and the live preview, so
    // clicking OK without typing anything confirmed an EMPTY name, which the
    // `!name` guard below silently returned on — no file, no error. Seed a
    // real, collision-free default so OK-on-default always creates a file.
    const defaultName = await findUniqueDefaultName(
      (fullName) => workspaceServiceRef.current?.exists(`${destDir}/${fullName}`) ?? Promise.resolve(false),
      'my-document',
      '.docx',
    );
    const name = await prompt('Enter file name (without extension):', defaultName, {
      title: 'Create Word Document',
      placeholder: 'my-document',
      destinationPath: `${destDir}/`,
      previewExtension: '.docx',
      validate: (v) => (v.trim() ? undefined : 'Enter a file name.'),
    });
    if (!name) return;

    const fileName = name.endsWith('.docx') ? name : `${name}.docx`;
    const filePath = `${destDir}/${fileName}`;
    try {
      // VG-4c — a new document is a straight byte copy of the letterhead
      // template when one is configured and readable (headers/footers/styles/
      // body all come along, trivially correct). On any read failure, fall
      // back to a blank document so creation never blocks.
      const templatePath = useSettingsStore
        .getState()
        .getSetting<string>('letterheadTemplatePath');
      let bytes: Uint8Array | null = null;
      if (templatePath && templatePath.trim()) {
        try {
          const templateBuf = await workspaceServiceRef.current.readFileBinary(templatePath);
          bytes = new Uint8Array(templateBuf);
        } catch (readError) {
          console.warn(
            'Could not read the letterhead template; creating a blank document instead.',
            readError,
          );
          bytes = null;
        }
      }
      if (!bytes) {
        bytes = await createBlankDocx();
      }
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      await workspaceServiceRef.current.writeFileBinary(filePath, buffer);
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
      const dataUrl = docxBytesToDataUrl(bytes);
      openFile(filePath, fileName, dataUrl);
    } catch (error) {
      console.error('Failed to create Word document:', error);
    }
  }, [rootPath, setFileTree, openFile, prompt, workspaceServiceRef]);

  // Advisor Prep Hero 3.0 (WS-A / A5): the "New Document" primary action. Word (.docx)
  // is the canonical document format, so unless the user has changed the
  // "Default New Document Type" setting, a new document is a real `.docx`
  // opened in the Word editor. Markdown / plain text / rich text remain
  // available for quick notes via the same setting and the File menu.
  const handleCreateDefaultDocument = useCallback(async (parentPath?: string) => {
    const kind = useSettingsStore
      .getState()
      .getSetting<string>('defaultNewFileType');
    switch (kind) {
      case 'plaintext':
        await handleCreateTextFileAtRoot(parentPath);
        break;
      case 'docx':
      default:
        // Canonical default.
        await handleCreateDocxAtRoot(parentPath);
        break;
    }
  }, [
    handleCreateTextFileAtRoot,
    handleCreateDocxAtRoot,
  ]);



  // Handle create folder at root
  const handleCreateFolderAtRoot = useCallback(async () => {
    if (!workspaceServiceRef.current || !rootPath) return;
    const defaultName = await findUniqueDefaultName(
      (fullName) => workspaceServiceRef.current?.exists(`${rootPath}/${fullName}`) ?? Promise.resolve(false),
      'my-folder',
    );
    const name = await prompt('Enter folder name:', defaultName, {
      title: 'Create Folder',
      placeholder: 'my-folder',
      validate: (v) => (v.trim() ? undefined : 'Enter a folder name.'),
    });
    if (!name) return;

    const folderPath = `${rootPath}/${name}`;
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
    }
  }, [rootPath, setFileTree, prompt, workspaceServiceRef]);

  return {
    handleCreateTextFileAtRoot,
    handleSetLetterheadTemplate,
    handleCreateDocxAtRoot,
    handleCreateDefaultDocument,
    handleCreateFolderAtRoot,
  };
}
