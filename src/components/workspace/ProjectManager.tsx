// Project Manager Component
// Allows switching between projects, renaming, and managing workspaces

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FolderOpen,
  ChevronDown,
  Plus,
  Pencil,
  Clock,
} from 'lucide-react';
import { isTauriEnvironment } from '@/modules/workspace/BackendFactory';

interface RecentWorkspace {
  path: string;
  name: string;
  lastOpened: Date;
}

interface ProjectManagerProps {
  currentProjectName: string;
  onSwitchProject: () => void;
  onOpenRecentProject?: (path: string) => void;
  onRenameProject?: (newName: string) => Promise<void>;
  recentProjects?: RecentWorkspace[];
}

export function ProjectManager({
  currentProjectName,
  onSwitchProject,
  onOpenRecentProject,
  onRenameProject,
  recentProjects = [],
}: ProjectManagerProps) {
  const isTauri = isTauriEnvironment();
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [newName, setNewName] = useState(currentProjectName);
  const [isRenaming, setIsRenaming] = useState(false);

  const handleRename = useCallback(async () => {
    if (!newName.trim() || newName === currentProjectName || !onRenameProject) return;

    setIsRenaming(true);
    try {
      await onRenameProject(newName.trim());
      setShowRenameDialog(false);
    } catch (error) {
      console.error('Failed to rename project:', error);
    } finally {
      setIsRenaming(false);
    }
  }, [newName, currentProjectName, onRenameProject]);

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 px-2 gap-1 text-sm font-medium">
            <FolderOpen className="h-4 w-4" />
            <span className="max-w-[150px] truncate">{currentProjectName}</span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem onClick={onSwitchProject}>
            <Plus className="h-4 w-4 mr-2" />
            New Project
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onSwitchProject}>
            <FolderOpen className="h-4 w-4 mr-2" />
            Open Project
          </DropdownMenuItem>
          {onRenameProject && (
            <DropdownMenuItem onClick={() => {
              setNewName(currentProjectName);
              setShowRenameDialog(true);
            }}>
              <Pencil className="h-4 w-4 mr-2" />
              Rename Project
            </DropdownMenuItem>
          )}

          {recentProjects.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Recent Projects
              </div>
              {recentProjects.slice(0, 5).map((project) => (
                <DropdownMenuItem
                  key={project.path}
                  className="flex items-center justify-between"
                  disabled={!isTauri}
                  onClick={() => isTauri && onOpenRecentProject?.(project.path)}
                >
                  <span className="truncate">{project.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {formatDate(project.lastOpened)}
                  </span>
                </DropdownMenuItem>
              ))}
              {!isTauri && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  Re-select folder to reopen
                </p>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Rename Dialog */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Project</DialogTitle>
            <DialogDescription>
              Enter a new name for your project. This will rename the workspace folder.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRename();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRenameDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              disabled={!newName.trim() || newName === currentProjectName || isRenaming}
            >
              {isRenaming ? 'Renaming...' : 'Rename'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ProjectManager;
