// Workspace Selector Dialog
// Prompts users to select or create a workspace folder
// Supports both browser (File System Access API) and Tauri (native filesystem)

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { WebFSBackend, createWebFSBackend } from '@/modules/workspace/WebFSBackend';
import { WorkspaceService, createWorkspaceService } from '@/modules/workspace/WorkspaceService';
import { createFSBackend, isTauriEnvironment } from '@/modules/workspace/BackendFactory';
import { FolderOpen, FolderPlus, Clock, AlertCircle } from 'lucide-react';

interface WorkspaceSelectorProps {
  open: boolean;
  onWorkspaceSelected: (service: WorkspaceService) => void;
}

export function WorkspaceSelector({ open, onWorkspaceSelected }: WorkspaceSelectorProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTauri = isTauriEnvironment();

  const { recentWorkspaces, addRecentWorkspace, setRootPath, setFileTree, expandAllFolders } = useWorkspaceStore();

  const handleSelectFolder = async () => {
    setIsLoading(true);
    setError(null);

    try {
      let backend;
      let rootPath: string;

      if (isTauri) {
        // Tauri mode: Use native folder picker
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selectedPath = await open({
          directory: true,
          multiple: false,
          title: 'Select Workspace Folder',
        });

        if (!selectedPath) {
          // User cancelled
          setIsLoading(false);
          return;
        }

        console.log('[WorkspaceSelector] Selected path from dialog:', selectedPath);
        backend = await createFSBackend(selectedPath as string);
        rootPath = selectedPath as string;
      } else {
        // Browser mode: Use directory picker
        if (!WebFSBackend.isSupported()) {
          setError('File System Access API is not supported in this browser. Please use Chrome, Edge, or Opera.');
          setIsLoading(false);
          return;
        }
        const webBackend = createWebFSBackend();
        const handle = await webBackend.openDirectoryPicker();
        backend = webBackend;
        rootPath = '/' + handle.name;
      }

      const service = createWorkspaceService();
      const workspace = await service.initialize(backend, rootPath);

      // Update store
      setRootPath(workspace.rootPath);
      const fileTree = await service.getFileTree();
      setFileTree(fileTree);

      // Expand all folders by default
      expandAllFolders();

      // Add to recent workspaces
      addRecentWorkspace({
        path: workspace.rootPath,
        name: workspace.name,
        lastOpened: new Date(),
      });

      onWorkspaceSelected(service);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled the picker
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
        // Tauri mode: Use native folder picker
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selectedPath = await open({
          directory: true,
          multiple: false,
          title: 'Select Folder for New Workspace',
        });

        if (!selectedPath) {
          // User cancelled
          setIsLoading(false);
          return;
        }

        backend = await createFSBackend(selectedPath as string);
        rootPath = selectedPath as string;
      } else {
        // Browser mode: Use directory picker
        if (!WebFSBackend.isSupported()) {
          setError('File System Access API is not supported in this browser. Please use Chrome, Edge, or Opera.');
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

      // Update store
      setRootPath(workspace.rootPath);
      const fileTree = await service.getFileTree();
      setFileTree(fileTree);

      // Expand all folders by default
      expandAllFolders();

      // Add to recent workspaces
      addRecentWorkspace({
        path: workspace.rootPath,
        name: workspace.name,
        lastOpened: new Date(),
      });

      onWorkspaceSelected(service);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled the picker
        return;
      }
      console.error('[WorkspaceSelector] Failed to create workspace:', err);
      const errorMsg = err instanceof Error ? `${err.message}\n\nDetails: ${err.stack || 'No stack trace'}` : 'Failed to create workspace';
      setError(errorMsg);
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

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-xl">Welcome to Projelli</DialogTitle>
          <DialogDescription>
            Select an existing workspace folder or create a new one to get started.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          {error && (
            <div className="flex items-center gap-2 p-3 text-sm text-destructive bg-destructive/10 rounded-md">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Button
              data-testid="open-existing-workspace"
              variant="outline"
              className="h-auto py-4 flex flex-col items-center gap-2"
              onClick={handleSelectFolder}
              disabled={isLoading}
            >
              <FolderOpen className="h-8 w-8" />
              <div className="text-center">
                <div className="font-medium">Open Existing</div>
                <div className="text-xs text-muted-foreground">
                  Select a workspace folder
                </div>
              </div>
            </Button>

            <Button
              data-testid="new-workspace"
              variant="outline"
              className="h-auto py-4 flex flex-col items-center gap-2"
              onClick={handleCreateWorkspace}
              disabled={isLoading}
            >
              <FolderPlus className="h-8 w-8" />
              <div className="text-center">
                <div className="font-medium">New Workspace</div>
                <div className="text-xs text-muted-foreground">
                  With default structure
                </div>
              </div>
            </Button>
          </div>

          {recentWorkspaces.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Clock className="h-4 w-4" />
                Recent Workspaces
              </div>
              <Card>
                <CardContent className="p-0">
                  <ul className="divide-y">
                    {recentWorkspaces.map((workspace) => (
                      <li key={workspace.path}>
                        <button
                          className="w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                          disabled={isLoading}
                        >
                          <div className="font-medium text-sm">{workspace.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDate(workspace.lastOpened)}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              <p className="text-xs text-muted-foreground">
                Note: Recent workspaces require re-selecting the folder due to browser security.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
