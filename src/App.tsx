/**
 * Business OS - Founder Workspace
 *
 * A local-first, artifact-driven workspace application for solo founders
 * building businesses with AI assistance.
 *
 * Core Thesis: This is NOT a chat UI. It is an artifact-driven workspace
 * where AI proposes and the user approves all destructive actions.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { WorkspaceSelector } from '@/components/workspace/WorkspaceSelector';
import { FileTree } from '@/components/workspace/FileTree';
import { Sidebar } from '@/components/layout/Sidebar';
import { MainPanel } from '@/components/layout/MainPanel';
import { StatusBar } from '@/components/layout/StatusBar';
import { WorkflowPanel } from '@/components/workflow/WorkflowPanel';
import { InterviewForm } from '@/components/workflow/InterviewForm';
import { CommandPalette, getDefaultCommands, type PaletteCommand } from '@/components/common/CommandPalette';
import { SourceCardPanel } from '@/components/research/SourceCardPanel';
import { SearchPanel } from '@/components/search/SearchPanel';
import { AuditLog } from '@/components/common/AuditLog';
import { TrashPanel } from '@/components/common/TrashPanel';
import { AIAssistantPane } from '@/components/ai/AIAssistantPane';
import { WhiteboardManager } from '@/components/whiteboard/WhiteboardManager';
import { ProjectManager } from '@/components/workspace/ProjectManager';
import { AudioRecorderModal } from '@/components/audio/AudioRecorderModal';
import { Button } from '@/components/ui/button';
import { Command, Moon, Sun } from 'lucide-react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { saveFile } from '@/utils/saveFile';
import { useEditorStore } from '@/stores/editorStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import type { WorkspaceService } from '@/modules/workspace/WorkspaceService';
import type { WorkflowTemplate, WorkflowExecution, InterviewQuestion } from '@/types/workflow';
import type { TrashedItem } from '@/modules/history/TrashService';
import type { SourceCard } from '@/types/research';
import type { AuditEntry } from '@/types/audit';
import { createWorkflowEngine } from '@/modules/workflow/WorkflowEngine';
import { createMockProvider } from '@/modules/models/MockProvider';
import { createClaudeProvider } from '@/modules/models/ClaudeProvider';
import { createOpenAIProvider } from '@/modules/models/OpenAIProvider';
import { createGeminiProvider } from '@/modules/models/GeminiProvider';
import { FileSystemWatcher, createFileTreeSnapshot } from '@/modules/workspace/FileSystemWatcher';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { isBinaryFile, arrayBufferToDataUrl, getMimeType } from '@/utils/file-utils';
import { useTrash } from '@/hooks/useTrash';
import { useSourceCards } from '@/hooks/useSourceCards';
import { useAIChatFiles } from '@/hooks/useAIChatFiles';
import { useApiKeys } from '@/hooks/useApiKeys';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { usePromptDialog } from '@/hooks/usePromptDialog';
import { PromptDialog } from '@/components/common/PromptDialog';

function App() {
  // Test mode: bypass workspace selector for E2E tests
  const IS_TEST_MODE = typeof window !== 'undefined' &&
                       window.location.search.includes('testMode=true');

  const [showWorkspaceSelector, setShowWorkspaceSelector] = useState(!IS_TEST_MODE);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showAudioRecorder, setShowAudioRecorder] = useState(false);
  const workspaceServiceRef = useRef<WorkspaceService | null>(null);
  const fileSystemWatcherRef = useRef<FileSystemWatcher | null>(null);

  // Workflow state
  const [currentExecution, setCurrentExecution] = useState<WorkflowExecution | null>(null);
  const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestion[] | null>(null);
  const [interviewResolver, setInterviewResolver] = useState<((answers: Record<string, string>) => void) | null>(null);
  const [interviewRejecter, setInterviewRejecter] = useState<((error: Error) => void) | null>(null);
  const [showInterviewDialog, setShowInterviewDialog] = useState(false);

  // Sidebar state
  const [sidebarActiveTab, setSidebarActiveTab] = useState<'files' | 'search' | 'workflows' | 'ai-assistant' | 'research' | 'whiteboard' | 'audit' | 'trash'>('files');


  // Audit log state
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    // Load theme from localStorage on mount
    const savedTheme = localStorage.getItem('theme');
    return (savedTheme === 'dark' || savedTheme === 'light') ? savedTheme : 'light';
  });

  const { rootPath, setRootPath, setFileTree, recentWorkspaces, fileTree, expandedPaths, expandAllFolders } = useWorkspaceStore();
  const { openFile, openTab, markSaved, openTabs, activeTabPath, closeTab, closeTabsByPath, toggleOutline, toggleBacklinks, splitPane, closeSplit, isSplit } = useEditorStore();
  const { runHistory, completeRun } = useWorkflowStore();

  // API key management
  const { apiKeys, handleSaveApiKey, handleDeleteApiKey } = useApiKeys();

  // Trash management
  const {
    trashItems,
    trashStats,
    trashRetentionPeriod,
    trashCustomRetentionDays,
    saveTrashMetadata,
    loadTrashMetadata,
    handleRestoreFromTrash,
    handlePermanentDelete,
    handleEmptyTrash,
    handleTrashRetentionChange,
    setTrashItems,
    setTrashStats,
  } = useTrash({ rootPath, workspaceServiceRef });

  // Confirmation dialogs
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  // Prompt dialogs
  const { prompt, dialogProps: promptDialogProps } = usePromptDialog();

  // Auto-expand all folders when file tree is first loaded or changes
  useEffect(() => {
    if (fileTree.length > 0 && expandedPaths.size === 0 && rootPath) {
      // File tree exists but nothing is expanded - expand all folders
      setTimeout(() => {
        expandAllFolders();
        console.log('Auto-expanded all folders on file tree load');
      }, 100); // Small delay to ensure React state is updated
    }
  }, [fileTree, expandedPaths.size, expandAllFolders, rootPath]);

  // File system watcher - auto-refresh when external changes detected
  useEffect(() => {
    if (!rootPath || !workspaceServiceRef.current) {
      // No workspace loaded, stop any existing watcher
      if (fileSystemWatcherRef.current) {
        fileSystemWatcherRef.current.stop();
        fileSystemWatcherRef.current = null;
      }
      return;
    }

    // Create and start watcher
    const watcher = new FileSystemWatcher({
      pollInterval: 3000, // Check every 3 seconds
      onFileTreeChange: async () => {
        console.log('FileSystemWatcher: External file changes detected, refreshing file tree...');
        if (workspaceServiceRef.current) {
          try {
            const newFileTree = await workspaceServiceRef.current.getFileTree();
            setFileTree(newFileTree);
          } catch (error) {
            console.error('FileSystemWatcher: Failed to refresh file tree:', error);
          }
        }
      },
    });

    // Start watching
    watcher.start(async () => {
      if (!workspaceServiceRef.current) return '';
      try {
        const currentTree = await workspaceServiceRef.current.getFileTree();
        return createFileTreeSnapshot(currentTree);
      } catch (error) {
        console.error('FileSystemWatcher: Failed to get file tree snapshot:', error);
        return '';
      }
    });

    fileSystemWatcherRef.current = watcher;

    // Cleanup on unmount or workspace change
    return () => {
      if (fileSystemWatcherRef.current) {
        fileSystemWatcherRef.current.stop();
        fileSystemWatcherRef.current = null;
      }
    };
  }, [rootPath, setFileTree]);

  // Test mode: Initialize mock workspace for E2E tests
  useEffect(() => {
    if (IS_TEST_MODE && !rootPath) {
      // Set a mock workspace path
      setRootPath('/test-workspace');

      // Pre-load 2 demo tabs for testing
      const demoTab1Path = '/test-workspace/docs/test1.md';
      const demoTab1Content = '# Test Document 1\n\nThis is a test markdown document.';

      const demoTab2Path = '/test-workspace/docs/test2.txt';
      const demoTab2Content = 'This is a plain text document for testing the formatting toolbar.';

      // Open both tabs
      openFile(demoTab1Path, 'test1.md', demoTab1Content);
      openFile(demoTab2Path, 'test2.txt', demoTab2Content);

      // Note: workspaceServiceRef stays null in test mode
      // Tests will work with localStorage and component state
      console.log('Test mode enabled: Mock workspace initialized with 2 demo tabs');
    }
  }, [IS_TEST_MODE, rootPath, setRootPath, openFile]);

  // Theme: Apply theme class to HTML element and save to localStorage
  useEffect(() => {
    const htmlElement = document.documentElement;
    if (theme === 'dark') {
      htmlElement.classList.add('dark');
    } else {
      htmlElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Derive whiteboard files from file tree
  const whiteboardFiles = useMemo(() => {
    const findWhiteboards = (nodes: typeof fileTree): Array<{ path: string; name: string }> => {
      const result: Array<{ path: string; name: string }> = [];
      for (const node of nodes) {
        if (node.type === 'file' && node.name.endsWith('.whiteboard')) {
          result.push({ path: node.path, name: node.name });
        }
        if (node.children) {
          result.push(...findWhiteboards(node.children));
        }
      }
      return result;
    };
    return findWhiteboards(fileTree);
  }, [fileTree]);

  // Handle file open (must be defined before useSourceCards)
  const handleFileOpen = useCallback(
    async (path: string, name: string) => {
      if (!workspaceServiceRef.current) return;

      // Auto-expand parent folders to show file location
      const { expandedPaths, setExpandedPaths } = useWorkspaceStore.getState();
      const parts = path.split('/');
      const newExpanded = new Set(expandedPaths);

      // Add all parent folder paths to expanded set
      for (let i = 1; i < parts.length - 1; i++) {
        const folderPath = parts.slice(0, i + 1).join('/');
        newExpanded.add(folderPath);
      }

      // Update expanded paths if any new folders were added
      if (newExpanded.size > expandedPaths.size) {
        setExpandedPaths(newExpanded);
      }

      try {
        if (isBinaryFile(name)) {
          // Read binary content for binary files (images, videos, PDFs, etc.)
          const buffer = await workspaceServiceRef.current.readFileBinary(path);
          const mimeType = getMimeType(name);
          const dataUrl = arrayBufferToDataUrl(buffer, mimeType);
          openFile(path, name, dataUrl);
        } else {
          const content = await workspaceServiceRef.current.readFile(path);
          openFile(path, name, content);
        }
      } catch (error) {
        console.error('Failed to open file:', error);
      }
    },
    [openFile]
  );

  // Source card management (must be defined before handleWorkspaceSelected)
  const {
    sourceCards,
    setSourceCards,
    loadSourceCards,
    handleOpenSourceFile,
    handleCreateSourceCard,
    handleUpdateSourceCard,
    handleDeleteSourceCard,
  } = useSourceCards({ rootPath, workspaceServiceRef, handleFileOpen });

  // Handle delete (moves to trash instead of permanent delete) - must be defined before useAIChatFiles
  const handleDelete = useCallback(
    async (path: string) => {
      const fileName = path.split('/').pop() ?? 'unknown';
      const confirmed = await confirm(`Are you sure you want to delete "${fileName}"?`, {
        title: 'Delete File',
        variant: 'destructive',
        confirmLabel: 'Delete',
      });
      if (!confirmed || !workspaceServiceRef.current || !rootPath) return;

      try {
        // Get file stats for trash entry
        const stat = await workspaceServiceRef.current.stat(path);

        // Create trash folder if it doesn't exist
        const trashFolderPath = `${rootPath}/.trash`;
        const trashExists = await workspaceServiceRef.current.exists(trashFolderPath);
        if (!trashExists) {
          await workspaceServiceRef.current.mkdir(trashFolderPath);
        }

        // Move file to trash with timestamp prefix
        const timestamp = Date.now();
        const trashPath = `${trashFolderPath}/${timestamp}_${fileName}`;
        await workspaceServiceRef.current.move(path, trashPath);

        // Create trash item entry
        const trashedItem: TrashedItem = {
          id: `trash_${timestamp}_${Math.random().toString(36).slice(2, 9)}`,
          originalPath: path,
          trashPath,
          name: fileName,
          type: stat.type,
          deletedAt: new Date(),
          size: stat.size,
        };

        // Update trash state and persist
        const newItems = [trashedItem, ...trashItems];
        setTrashItems(newItems);

        // Update stats
        const totalSize = newItems.reduce((sum, item) => sum + (item.size ?? 0), 0);
        const oldestItem = newItems.length > 0
          ? newItems.reduce((oldest, item) =>
              item.deletedAt < oldest ? item.deletedAt : oldest,
              newItems[0]!.deletedAt
            )
          : undefined;
        setTrashStats({
          itemCount: newItems.length,
          totalSize,
          oldestItem,
        });

        // Persist trash metadata
        await saveTrashMetadata(newItems);

        // Refresh file tree
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);

        // Close all tabs for the deleted file (handles duplicates and split panes)
        closeTabsByPath(path);
      } catch (error) {
        console.error('Failed to delete:', error);
      }
    },
    [setFileTree, rootPath, closeTabsByPath, trashItems, saveTrashMetadata, setTrashStats, setTrashItems, confirm]
  );

  // AI Chat Files Management (must be defined after handleDelete and handleFileOpen)
  const {
    chatFiles,
    setChatFiles,
    loadChatFiles,
    handleCreateNewChat,
    handleOpenChat,
    handleDeleteChat,
  } = useAIChatFiles({ rootPath, workspaceServiceRef, handleFileOpen, handleDelete });

  // Handle workspace selection
  const handleWorkspaceSelected = useCallback(async (service: WorkspaceService) => {
    workspaceServiceRef.current = service;
    setShowWorkspaceSelector(false);

    const rootPath = service.getRootPath();
    let isNewWorkspace = false;

    // Create default folders if they don't exist
    try {
      // Create docs folder
      const docsPath = `${rootPath}/docs`;
      const docsExists = await service.exists(docsPath);
      if (!docsExists) {
        await service.mkdir(docsPath);
        console.log('Created docs folder');
        isNewWorkspace = true;
      }

      // Create whiteboards folder
      const whiteboardsPath = `${rootPath}/whiteboards`;
      const whiteboardsExists = await service.exists(whiteboardsPath);
      if (!whiteboardsExists) {
        await service.mkdir(whiteboardsPath);
        console.log('Created whiteboards folder');
        isNewWorkspace = true;
      }

      // Create AI Chats folder
      const aiChatsPath = `${rootPath}/AI Chats`;
      const aiChatsExists = await service.exists(aiChatsPath);
      if (!aiChatsExists) {
        await service.mkdir(aiChatsPath);
        console.log('Created AI Chats folder');
        isNewWorkspace = true;
      }

      // Create Research folder
      const researchPath = `${rootPath}/Research`;
      const researchExists = await service.exists(researchPath);
      if (!researchExists) {
        await service.mkdir(researchPath);
        console.log('Created Research folder');
        isNewWorkspace = true;
      }

      // Create Audio Recordings folder
      const audioPath = `${rootPath}/Audio Recordings`;
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
    if (rootPath) {
      if (isNewWorkspace) {
        // New workspace - expand all folders by default
        // File tree is now loaded, so we can expand immediately
        const { expandAllFolders } = useWorkspaceStore.getState();
        expandAllFolders();
        console.log('All folders expanded for new workspace');
      } else {
        // Existing workspace - load saved expansion state, but also expand all as default
        const { loadExpandedPaths, expandAllFolders } = useWorkspaceStore.getState();
        const loaded = loadExpandedPaths(rootPath);
        // If no saved state exists, expand all folders
        if (!loaded || useWorkspaceStore.getState().expandedPaths.size === 0) {
          expandAllFolders();
          console.log('No saved expansion state, expanding all folders');
        }
      }
    }
  }, [loadTrashMetadata, loadSourceCards, loadChatFiles]);


  // Handle revealing a folder in the Files tab
  const handleRevealInFolder = useCallback((_path: string) => {
    // Switch to Files tab
    setSidebarActiveTab('files');

    // The folder expansion and selection is already handled by SearchPanel
    // Just need to ensure the tab switch happens
  }, []);

  // Handle opening browser tab
  const handleOpenBrowserTab = useCallback(
    (url: string, title?: string) => {
      // Generate a unique path for the browser tab
      const tabPath = `__browser__${Date.now()}`;
      const tabName = title || new URL(url).hostname;

      openTab(tabPath, tabName, '', 'browser', { url });
    },
    [openTab]
  );

  // Handle file save
  const handleSaveFile = useCallback(
    async (path: string, content: string) => {
      if (!workspaceServiceRef.current) return;

      try {
        await workspaceServiceRef.current.writeFile(path, content);
        markSaved(path);

        // Refresh file tree
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);
      } catch (error) {
        console.error('Failed to save file:', error);
      }
    },
    [markSaved, setFileTree]
  );

  // Handle create new file
  const handleCreateFile = useCallback(
    async (parentPath: string) => {
      const name = await prompt('Enter file name:', '', {
        title: 'Create File',
        placeholder: 'myfile.txt',
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
      }
    },
    [setFileTree, handleFileOpen, prompt]
  );

  // Handle create new folder
  const handleCreateFolder = useCallback(
    async (parentPath: string) => {
      const name = await prompt('Enter folder name:', '', {
        title: 'Create Folder',
        placeholder: 'my-folder',
      });
      if (!name || !workspaceServiceRef.current) return;

      const folderPath = `${parentPath}/${name}`;
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
    },
    [setFileTree, prompt]
  );

  // Handle rename (prompts user)
  const handleRename = useCallback(
    async (path: string) => {
      const currentName = path.split('/').pop() ?? '';
      const newName = await prompt('Enter new name:', currentName, {
        title: 'Rename',
      });
      if (!newName || newName === currentName || !workspaceServiceRef.current) return;

      try {
        await workspaceServiceRef.current.rename(path, newName);
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);
      } catch (error) {
        console.error('Failed to rename:', error);
      }
    },
    [setFileTree, prompt]
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

        // Close old tab and open new one with same content if it was open
        const tab = openTabs.find(t => t.path === oldPath);
        if (tab) {
          closeTab(oldPath);
          await handleFileOpen(newPath, newName);
        }
      } catch (error) {
        console.error('Failed to rename:', error);
      }
    },
    [setFileTree, openTabs, closeTab, handleFileOpen]
  );


  // Handle download file
  const handleDownload = useCallback(
    async (path: string, name: string) => {
      if (!workspaceServiceRef.current) return;

      try {
        const content = await workspaceServiceRef.current.readFile(path);

        // Use cross-platform saveFile utility (works in both browser and Tauri)
        await saveFile(content, {
          suggestedName: name,
          types: [
            {
              description: 'Text Files',
              accept: {
                'text/plain': ['.txt', '.md', '.markdown', '.json'],
              },
            },
          ],
        });
      } catch (error) {
        // User cancelled or error occurred
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Failed to download file:', error);
        }
      }
    },
    []
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
  }, [setFileTree]);

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
      }
    },
    [setFileTree]
  );



  // Audit log helper - logs all AI actions to the audit log
  const addAuditEntry = useCallback((entry: Omit<AuditEntry, 'id' | 'timestamp'>) => {
    const newEntry: AuditEntry = {
      ...entry,
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
    };
    setAuditEntries((prev) => [newEntry, ...prev]);
  }, []);

  // Handle create file at root
  const handleCreateFileAtRoot = useCallback(async () => {
    if (!workspaceServiceRef.current || !rootPath) return;
    const name = await prompt('Enter file name:', '', {
      title: 'Create File',
      placeholder: 'myfile.txt',
    });
    if (!name) return;

    const filePath = `${rootPath}/${name}`;
    try {
      await workspaceServiceRef.current.writeFile(filePath, '');
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
      await handleFileOpen(filePath, name);
    } catch (error) {
      console.error('Failed to create file:', error);
    }
  }, [rootPath, setFileTree, handleFileOpen, prompt]);

  // Handle create markdown file at root (goes to docs folder)
  const handleCreateMarkdownAtRoot = useCallback(async () => {
    if (!workspaceServiceRef.current || !rootPath) return;
    const name = await prompt('Enter file name (without extension):', '', {
      title: 'Create Markdown File',
      placeholder: 'my-document',
    });
    if (!name) return;

    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    const filePath = `${rootPath}/docs/${fileName}`;
    try {
      await workspaceServiceRef.current.writeFile(filePath, '# ' + name.replace(/\.md$/, '') + '\n\n');
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
      await handleFileOpen(filePath, fileName);
    } catch (error) {
      console.error('Failed to create markdown file:', error);
    }
  }, [rootPath, setFileTree, handleFileOpen, prompt]);

  // Handle create plain text file at root (goes to docs folder)
  const handleCreateTextFileAtRoot = useCallback(async () => {
    if (!workspaceServiceRef.current || !rootPath) return;
    const name = await prompt('Enter file name (without extension):', '', {
      title: 'Create Text File',
      placeholder: 'my-notes',
    });
    if (!name) return;

    const fileName = name.endsWith('.txt') ? name : `${name}.txt`;
    const filePath = `${rootPath}/docs/${fileName}`;
    try {
      await workspaceServiceRef.current.writeFile(filePath, '');
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
      await handleFileOpen(filePath, fileName);
    } catch (error) {
      console.error('Failed to create text file:', error);
    }
  }, [rootPath, setFileTree, handleFileOpen, prompt]);

  // Handle create source file in Research folder
  const handleCreateSourceFileAtRoot = useCallback(async () => {
    if (!workspaceServiceRef.current || !rootPath) return;
    const title = await prompt('Enter source title:', '', {
      title: 'Create Source File',
      placeholder: 'Source Title',
    });
    if (!title) return;

    // Create filename from exact title + .source extension
    const filename = `${title}.source`;
    const filePath = `${rootPath}/Research/${filename}`;

    // Create initial source structure
    const newSourceCard: SourceCard = {
      id: `src_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      url: '',
      title: title,
      date_accessed: new Date().toISOString().split('T')[0]!,
      quote_or_snippet: '',
      claim_supported: '',
      reliability_notes: '',
    };

    try {
      // Ensure Research folder exists
      const researchPath = `${rootPath}/Research`;
      const researchExists = await workspaceServiceRef.current.exists(researchPath);
      if (!researchExists) {
        await workspaceServiceRef.current.mkdir(researchPath);
      }

      // Create the source file
      await workspaceServiceRef.current.writeFile(filePath, JSON.stringify(newSourceCard, null, 2));
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
      await handleFileOpen(filePath, filename);

      // Add to sources state
      setSourceCards(prev => [...prev, newSourceCard]);
    } catch (error) {
      console.error('Failed to create source file:', error);
    }
  }, [rootPath, setFileTree, handleFileOpen, prompt]);

  // Handle create folder at root
  const handleCreateFolderAtRoot = useCallback(async () => {
    if (!workspaceServiceRef.current || !rootPath) return;
    const name = await prompt('Enter folder name:', '', {
      title: 'Create Folder',
      placeholder: 'my-folder',
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
  }, [rootPath, setFileTree, prompt]);

  // Handle create whiteboard
  const handleCreateWhiteboard = useCallback(
    async (parentPath: string) => {
      const name = await prompt('Enter whiteboard name:', 'My Whiteboard', {
        title: 'Create Whiteboard',
      });
      if (!name || !workspaceServiceRef.current) return;

      // Add .whiteboard extension if not present
      const fileName = name.endsWith('.whiteboard') ? name : `${name}.whiteboard`;
      const filePath = `${parentPath}/${fileName}`;
      try {
        // Create empty whiteboard (empty JSON array for elements)
        await workspaceServiceRef.current.writeFile(filePath, '[]');
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);
        await handleFileOpen(filePath, fileName);
      } catch (error) {
        console.error('Failed to create whiteboard:', error);
      }
    },
    [setFileTree, handleFileOpen, prompt]
  );

  // Handle create whiteboard at root (goes to whiteboards folder)
  const handleCreateWhiteboardAtRoot = useCallback(async () => {
    if (!workspaceServiceRef.current || !rootPath) return;
    const name = await prompt('Enter whiteboard name:', 'My Whiteboard', {
      title: 'Create Whiteboard',
    });
    if (!name) return;

    // Add .whiteboard extension if not present
    const fileName = name.endsWith('.whiteboard') ? name : `${name}.whiteboard`;
    const filePath = `${rootPath}/whiteboards/${fileName}`;
    try {
      // Create empty whiteboard (empty JSON array for elements)
      await workspaceServiceRef.current.writeFile(filePath, '[]');
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
      await handleFileOpen(filePath, fileName);
    } catch (error) {
      console.error('Failed to create whiteboard:', error);
    }
  }, [rootPath, setFileTree, handleFileOpen, prompt]);

  // Handle open grid view
  const handleOpenGridView = useCallback(() => {
    // Open a special "Files" tab with grid view
    openFile('__grid_view__', 'Files', '');
  }, [openFile]);

  // Handle create audio file
  const handleCreateAudioAtRoot = useCallback(() => {
    setShowAudioRecorder(true);
  }, []);

  // Handle save audio recording
  const handleSaveAudioRecording = useCallback(
    async (audioBlob: Blob, filename: string) => {
      if (!workspaceServiceRef.current || !rootPath) return;

      // Ensure Audio Recordings folder exists
      const audioPath = `${rootPath}/Audio Recordings`;
      const audioExists = await workspaceServiceRef.current.exists(audioPath);
      if (!audioExists) {
        await workspaceServiceRef.current.mkdir(audioPath);
      }

      const filePath = `${audioPath}/${filename}`;
      try {
        // Convert blob to array buffer
        const arrayBuffer = await audioBlob.arrayBuffer();
        await workspaceServiceRef.current.writeFileBinary(filePath, arrayBuffer);
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);

        // Open the audio file
        await handleFileOpen(filePath, filename);
      } catch (error) {
        console.error('Failed to save audio recording:', error);
      }
    },
    [rootPath, setFileTree, handleFileOpen]
  );

  // Handle file upload
  const handleUploadFiles = useCallback(
    async (files: FileList, targetFolder?: string) => {
      if (!workspaceServiceRef.current || !rootPath) return;

      // Use targetFolder if provided, otherwise upload to root
      const uploadPath = targetFolder || rootPath;

      for (const file of Array.from(files)) {
        const filePath = `${uploadPath}/${file.name}`;
        try {
          if (isBinaryFile(file.name)) {
            // Read as array buffer and write as binary
            const buffer = await file.arrayBuffer();
            await workspaceServiceRef.current.writeFileBinary(filePath, buffer);
          } else {
            // Read as text and write as string
            const content = await file.text();
            await workspaceServiceRef.current.writeFile(filePath, content);
          }
        } catch (error) {
          console.error(`Failed to upload ${file.name}:`, error);
        }
      }

      // Refresh file tree after uploads
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
    },
    [rootPath, setFileTree]
  );

  // Handle starting a workflow
  const handleStartWorkflow = useCallback(
    async (template: WorkflowTemplate) => {
      if (!workspaceServiceRef.current || !rootPath) return;

      // Create workflow folder with timestamp
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '').replace('T', '_');
      const workflowFolderName = `${template.name} - ${timestamp}`;
      const workflowFolderPath = `${rootPath}/${workflowFolderName}`;

      try {
        // Create the workflow folder
        await workspaceServiceRef.current.mkdir(workflowFolderPath);
        console.log(`Created workflow folder: ${workflowFolderName}`);
      } catch (error) {
        console.error('Failed to create workflow folder:', error);
        return;
      }

      // Load AI Rules if available
      let aiRulesContent: string | undefined;
      try {
        const rulesPath = `${rootPath}/ai-rules.md`;
        const exists = await workspaceServiceRef.current.exists(rulesPath);
        if (exists) {
          aiRulesContent = await workspaceServiceRef.current.readFile(rulesPath);
        }
      } catch (error) {
        console.debug('No AI rules file found:', error);
      }

      // Use real AI provider if API key is available, otherwise use mock
      const anthropicKey = apiKeys.find((k) => k.provider === 'anthropic')?.key;
      const openaiKey = apiKeys.find((k) => k.provider === 'openai')?.key;
      const googleKey = apiKeys.find((k) => k.provider === 'google')?.key;

      let provider;
      if (anthropicKey) {
        // Use Claude for intelligent document generation
        provider = createClaudeProvider({
          apiKey: anthropicKey,
          dangerouslySkipPermissions: true,
          ...(aiRulesContent ? { aiRules: aiRulesContent } : {}),
        });
        console.log('Using Claude API for workflow generation');
      } else if (openaiKey) {
        // Fallback to OpenAI if available
        provider = createOpenAIProvider({
          apiKey: openaiKey,
          ...(aiRulesContent ? { aiRules: aiRulesContent } : {}),
        });
        console.log('Using OpenAI API for workflow generation');
      } else if (googleKey) {
        // Fallback to Gemini if available
        provider = createGeminiProvider({
          apiKey: googleKey,
          ...(aiRulesContent ? { aiRules: aiRulesContent } : {}),
        });
        console.log('Using Gemini API for workflow generation');
      } else {
        // Fall back to mock provider if no API keys
        provider = createMockProvider();
        console.log('No API key configured - using mock provider (documents will contain placeholder content)');
      }

      const engine = createWorkflowEngine(
        provider,
        {
          writeFile: async (path: string, content: string) => {
            // Write files inside the workflow folder
            const filename = path.split('/').pop() || path;
            const fullPath = `${workflowFolderPath}/${filename}`;
            await workspaceServiceRef.current!.writeFile(fullPath, content);
            // Refresh file tree after write
            const fileTree = await workspaceServiceRef.current!.getFileTree();
            setFileTree(fileTree);
          },
          readFile: async (path: string) => {
            // Read from workflow folder if relative path, otherwise use absolute
            const filename = path.split('/').pop() || path;
            const fullPath = path.startsWith('/') ? path : `${workflowFolderPath}/${filename}`;
            return workspaceServiceRef.current!.readFile(fullPath);
          },
        },
        // Interview handler - shows dialog and waits for user answers
        async (_stepId, questions) => {
          return new Promise<Record<string, string>>((resolve, reject) => {
            setInterviewQuestions(questions);
            setInterviewResolver(() => resolve);
            setInterviewRejecter(() => reject);
            setShowInterviewDialog(true);
          });
        },
        // Progress handler
        (stepIndex, stepName, status) => {
          console.log(`Workflow step ${stepIndex}: ${stepName} - ${status}`);
          if (engine.getExecution()) {
            setCurrentExecution({ ...engine.getExecution()! });
          }
        }
      );

      try {
        setCurrentExecution({
          runId: `temp_${Date.now()}`,
          template,
          currentStepIndex: 0,
          status: 'running',
          inputs: {},
          stepOutputs: [],
          startTime: new Date(),
        });

        const runRecord = await engine.execute(template);
        completeRun(runRecord);
        setCurrentExecution(null);

        // Refresh file tree after workflow completes
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);
      } catch (error) {
        console.error('Workflow failed:', error);
        setCurrentExecution(null);
      }
    },
    [rootPath, setFileTree, completeRun, apiKeys]
  );

  // Handle interview form submission
  const handleInterviewSubmit = useCallback(
    (answers: Record<string, string>) => {
      if (interviewResolver) {
        interviewResolver(answers);
        setInterviewResolver(null);
        setInterviewRejecter(null);
        setInterviewQuestions(null);
        setShowInterviewDialog(false);
      }
    },
    [interviewResolver]
  );

  // Handle interview form cancel
  const handleInterviewCancel = useCallback(() => {
    // Reject the promise so the workflow engine knows the interview was cancelled
    if (interviewRejecter) {
      interviewRejecter(new Error('User cancelled'));
    }
    setShowInterviewDialog(false);
    setInterviewQuestions(null);
    setInterviewResolver(null);
    setInterviewRejecter(null);
    setCurrentExecution(null);
  }, [interviewRejecter]);


  // Handle opening AI Rules file
  const handleOpenAIRules = useCallback(async () => {
    if (!rootPath || !workspaceServiceRef.current) return;

    const rulesPath = `${rootPath}/ai-rules.md`;

    try {
      // Check if file exists
      const exists = await workspaceServiceRef.current.exists(rulesPath);

      if (!exists) {
        // Create default AI rules file
        const defaultContent = `# AI Rules

This file contains rules and guidelines for AI assistants in this workspace.

## General Guidelines
- Be helpful, accurate, and concise
- Follow user instructions carefully
- Ask for clarification when needed

## Specific Rules
- Add your custom rules here
- AI will read and follow these rules in all chats
`;
        await workspaceServiceRef.current.writeFile(rulesPath, defaultContent);
        refreshFileTree();
      }

      // Open the file
      await handleFileOpen(rulesPath, 'ai-rules.md');
    } catch (error) {
      console.error('Failed to open AI rules file:', error);
    }
  }, [rootPath, handleFileOpen, refreshFileTree]);


  // Autosave dirty tabs every 2 seconds
  useEffect(() => {
    const autosaveInterval = setInterval(async () => {
      if (!workspaceServiceRef.current) return;

      for (const tab of openTabs) {
        if (tab.isDirty) {
          try {
            await workspaceServiceRef.current.writeFile(tab.path, tab.content);
            markSaved(tab.path);
          } catch (error) {
            console.error('Autosave failed for:', tab.path, error);
          }
        }
      }
    }, 2000);

    return () => clearInterval(autosaveInterval);
  }, [openTabs, markSaved]);


  // Build command palette commands
  const commands = useMemo<PaletteCommand[]>(() => {
    const baseCommands = getDefaultCommands({});
    const appCommands: PaletteCommand[] = [
      {
        id: 'file.save',
        label: 'Save File',
        shortcut: 'Ctrl+S',
        category: 'file',
        action: async () => {
          const activeTab = openTabs.find((t) => t.path === activeTabPath);
          if (activeTab && activeTab.isDirty) {
            await handleSaveFile(activeTab.path, activeTab.content);
          }
        },
      },
      {
        id: 'file.close',
        label: 'Close Tab',
        shortcut: 'Ctrl+W',
        category: 'file',
        action: () => {
          if (activeTabPath) {
            closeTab(activeTabPath);
          }
        },
      },
      {
        id: 'view.outline',
        label: 'Toggle Outline Panel',
        shortcut: 'Ctrl+Shift+O',
        category: 'view',
        action: toggleOutline,
      },
      {
        id: 'view.backlinks',
        label: 'Toggle Backlinks Panel',
        shortcut: 'Ctrl+Shift+B',
        category: 'view',
        action: toggleBacklinks,
      },
      {
        id: 'view.split',
        label: isSplit ? 'Close Split' : 'Split Editor',
        shortcut: 'Ctrl+\\',
        category: 'view',
        action: () => {
          if (isSplit) {
            closeSplit();
          } else {
            splitPane('horizontal');
          }
        },
      },
      {
        id: 'workspace.change',
        label: 'Change Workspace',
        category: 'workspace',
        action: () => setShowWorkspaceSelector(true),
      },
      {
        id: 'view.aiAssistant',
        label: 'Open AI Assistant',
        shortcut: 'Ctrl+Shift+A',
        category: 'view',
        action: () => setSidebarActiveTab('ai-assistant'),
      },
      {
        id: 'browser.open',
        label: 'Open Browser Tab',
        category: 'view',
        action: async () => {
          const url = await prompt('Enter URL:', '', {
            title: 'Open Browser Tab',
            placeholder: 'https://example.com',
          });
          if (url) {
            handleOpenBrowserTab(url);
          }
        },
      },
    ];
    return [...appCommands, ...baseCommands];
  }, [openTabs, activeTabPath, handleSaveFile, closeTab, toggleOutline, toggleBacklinks, isSplit, splitPane, closeSplit, handleOpenBrowserTab]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;

      // Command Palette: Ctrl+K or Ctrl+Shift+P
      if ((isMod && e.key === 'k') || (isMod && e.shiftKey && e.key === 'p')) {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }

      // Save: Ctrl+S
      if (isMod && e.key === 's') {
        e.preventDefault();
        const activeTab = openTabs.find((t) => t.path === activeTabPath);
        if (activeTab && activeTab.isDirty) {
          await handleSaveFile(activeTab.path, activeTab.content);
        }
        return;
      }

      // Close tab: Ctrl+W
      if (isMod && e.key === 'w') {
        e.preventDefault();
        if (activeTabPath) {
          closeTab(activeTabPath);
        }
        return;
      }

      // Toggle outline: Ctrl+Shift+O
      if (isMod && e.shiftKey && e.key === 'o') {
        e.preventDefault();
        toggleOutline();
        return;
      }

      // Toggle backlinks: Ctrl+Shift+B
      if (isMod && e.shiftKey && e.key === 'b') {
        e.preventDefault();
        toggleBacklinks();
        return;
      }

      // Split/unsplit: Ctrl+\
      if (isMod && e.key === '\\') {
        e.preventDefault();
        if (isSplit) {
          closeSplit();
        } else {
          splitPane('horizontal');
        }
        return;
      }

      // Open AI Assistant: Ctrl+Shift+A
      if (isMod && e.shiftKey && e.key === 'a') {
        e.preventDefault();
        setSidebarActiveTab('ai-assistant');
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openTabs, activeTabPath, handleSaveFile, closeTab, toggleOutline, toggleBacklinks, isSplit, splitPane, closeSplit]);

  // Show workspace selector if no workspace is open (unless in test mode)
  if (!IS_TEST_MODE && (showWorkspaceSelector || !rootPath)) {
    return (
      <div className="min-h-screen bg-background">
        <WorkspaceSelector
          open={true}
          onWorkspaceSelected={handleWorkspaceSelected}
        />
      </div>
    );
  }

  // Get current project name from root path
  const currentProjectName = rootPath?.split('/').pop() ?? 'Unnamed Project';

  return (
    <div className="h-screen flex flex-col bg-background text-foreground" data-testid="app-container">
      {/* Header bar with project switcher */}
      <header className="flex items-center justify-between h-10 px-2 border-b bg-muted/30 shrink-0" data-testid="app-header">
        <div className="flex items-center gap-2">
          <ProjectManager
            currentProjectName={currentProjectName}
            onSwitchProject={() => setShowWorkspaceSelector(true)}
            recentProjects={recentWorkspaces}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            title="Toggle Theme"
            aria-label="Toggle Theme"
          >
            {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setShowCommandPalette(true)}
            title="Command Palette (Ctrl+K)"
          >
            <Command className="h-3 w-3 mr-1" />
            Ctrl+K
          </Button>
        </div>
      </header>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar with file tree, workflows, research, and settings */}
        <Sidebar
          activeTab={sidebarActiveTab}
          onTabChange={setSidebarActiveTab}
          fileTreeContent={
            <FileTree
              onFileOpen={handleFileOpen}
              onCreateFile={handleCreateFile}
              onCreateFolder={handleCreateFolder}
              onRename={handleRename}
              onDelete={handleDelete}
              onMove={handleMove}
              onDownload={handleDownload}
              onCreateFileAtRoot={handleCreateFileAtRoot}
              onCreateMarkdownAtRoot={handleCreateMarkdownAtRoot}
              onCreateTextFileAtRoot={handleCreateTextFileAtRoot}
              onCreateSourceFileAtRoot={handleCreateSourceFileAtRoot}
              onCreateFolderAtRoot={handleCreateFolderAtRoot}
              onUploadFiles={handleUploadFiles}
              onCreateWhiteboard={handleCreateWhiteboard}
              onCreateWhiteboardAtRoot={handleCreateWhiteboardAtRoot}
              onOpenGridView={handleOpenGridView}
              onCreateAudioAtRoot={handleCreateAudioAtRoot}
            />
          }
          searchContent={
            <SearchPanel
              onFileSelect={handleFileOpen}
              onRevealInFolder={handleRevealInFolder}
            />
          }
          workflowContent={
            <WorkflowPanel
              onStartWorkflow={handleStartWorkflow}
              currentExecution={currentExecution}
              runHistory={runHistory}
            />
          }
          aiAssistantContent={
            <AIAssistantPane
              apiKeys={apiKeys}
              chatFiles={chatFiles}
              onSaveApiKey={handleSaveApiKey}
              onDeleteApiKey={handleDeleteApiKey}
              onCreateNewChat={handleCreateNewChat}
              onOpenChat={handleOpenChat}
              onDeleteChat={handleDeleteChat}
              onOpenAIRules={handleOpenAIRules}
              onClose={() => {/* No-op since it's now in sidebar */}}
            />
          }
          researchContent={
            <SourceCardPanel
              cards={sourceCards}
              onCreateCard={handleCreateSourceCard}
              onUpdateCard={handleUpdateSourceCard}
              onDeleteCard={handleDeleteSourceCard}
              onOpenFile={handleOpenSourceFile}
            />
          }
          auditContent={
            <AuditLog
              entries={auditEntries}
            />
          }
          trashContent={
            <TrashPanel
              items={trashItems}
              stats={trashStats}
              onRestore={handleRestoreFromTrash}
              onPermanentDelete={handlePermanentDelete}
              onEmptyTrash={handleEmptyTrash}
              retentionPeriod={trashRetentionPeriod}
              customRetentionDays={trashCustomRetentionDays}
              onRetentionChange={handleTrashRetentionChange}
            />
          }
          whiteboardContent={
            <WhiteboardManager
              whiteboards={whiteboardFiles}
              onCreateWhiteboard={handleCreateWhiteboardAtRoot}
              onOpenWhiteboard={handleFileOpen}
              onDeleteWhiteboard={handleDelete}
            />
          }
        />

        {/* Main editor panel */}
        <MainPanel onFileOpen={handleFileOpen} onMove={handleMove} onRename={handleRenameWithName} onDownload={handleDownload} apiKeys={apiKeys} workspaceServiceRef={workspaceServiceRef} {...(rootPath ? { rootPath } : {})} onFileTreeChange={refreshFileTree} onAuditLog={addAuditEntry} />
      </div>

      {/* Status bar */}
      <StatusBar />

      {/* Interview Dialog */}
      <Dialog open={showInterviewDialog} onOpenChange={setShowInterviewDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Workflow Questions</DialogTitle>
            <DialogDescription>
              Please answer the following questions to continue the workflow.
            </DialogDescription>
          </DialogHeader>
          {interviewQuestions && (
            <InterviewForm
              questions={interviewQuestions}
              onSubmit={handleInterviewSubmit}
              onCancel={handleInterviewCancel}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Command Palette */}
      <CommandPalette
        open={showCommandPalette}
        onOpenChange={setShowCommandPalette}
        commands={commands}
      />

      {/* Audio Recorder Modal */}
      <AudioRecorderModal
        isOpen={showAudioRecorder}
        onClose={() => setShowAudioRecorder(false)}
        onSave={handleSaveAudioRecording}
      />

      {/* Confirmation Dialog */}
      <ConfirmDialog {...confirmDialogProps} />

      {/* Prompt Dialog */}
      <PromptDialog {...promptDialogProps} />
    </div>
  );
}

export default App;
