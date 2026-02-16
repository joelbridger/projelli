// Tab Group Manager Component
// Modal UI for creating and managing tab groups

import { useState, useCallback, useRef, useEffect } from 'react';
import { Plus, Edit2, Trash2, FolderOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useEditorStore } from '@/stores/editorStore';

interface TabGroupManagerProps {
  open: boolean;
  onClose: () => void;
}

export function TabGroupManager({ open, onClose }: TabGroupManagerProps) {
  const {
    openTabs,
    tabGroups,
    createTabGroup,
    renameTabGroup,
    deleteTabGroup,
    moveTabToGroup,
  } = useEditorStore();

  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Confirmation dialog
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  // Auto-focus the rename input when editing starts
  useEffect(() => {
    if (editingGroupId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingGroupId]);

  const handleCreateGroup = useCallback(() => {
    if (!newGroupName.trim()) return;
    createTabGroup(newGroupName.trim());
    setNewGroupName('');
  }, [newGroupName, createTabGroup]);

  const handleStartRename = useCallback((groupId: string, currentName: string) => {
    setEditingGroupId(groupId);
    setEditingGroupName(currentName);
  }, []);

  const handleRenameSubmit = useCallback(() => {
    if (editingGroupId && editingGroupName.trim()) {
      renameTabGroup(editingGroupId, editingGroupName.trim());
      setEditingGroupId(null);
      setEditingGroupName('');
    }
  }, [editingGroupId, editingGroupName, renameTabGroup]);

  const handleDeleteGroup = useCallback(async (groupId: string) => {
    const confirmed = await confirm('Delete this tab group? Tabs will remain open.', {
      title: 'Delete Tab Group',
      variant: 'destructive',
      confirmLabel: 'Delete Group',
    });
    if (confirmed) {
      deleteTabGroup(groupId);
    }
  }, [deleteTabGroup, confirm]);

  const handleToggleTabInGroup = useCallback((tabPath: string, currentGroupId: string | null | undefined, targetGroupId: string) => {
    if (currentGroupId === targetGroupId) {
      // Remove from group
      moveTabToGroup(tabPath, null);
    } else {
      // Add to group
      moveTabToGroup(tabPath, targetGroupId);
    }
  }, [moveTabToGroup]);

  // Get tabs for each group
  const getTabsForGroup = (groupId: string) => {
    return openTabs.filter(tab => tab.groupId === groupId);
  };

  // Get ungrouped tabs
  const ungroupedTabs = openTabs.filter(tab => !tab.groupId);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Tab Groups</DialogTitle>
          <DialogDescription>
            Create and organize tab groups to better manage your open files.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Create New Group */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Create New Group</label>
            <div className="flex gap-2">
              <Input
                placeholder="Group name..."
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateGroup();
                  }
                }}
              />
              <Button onClick={handleCreateGroup} disabled={!newGroupName.trim()}>
                <Plus className="h-4 w-4 mr-2" />
                Create
              </Button>
            </div>
          </div>

          {/* Existing Groups */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Existing Groups ({tabGroups.length})</label>

            {tabGroups.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                No groups yet. Create one above to get started.
              </div>
            ) : (
              <div className="space-y-3">
                {tabGroups.map((group) => {
                  const groupTabs = getTabsForGroup(group.id);
                  return (
                    <div
                      key={group.id}
                      className="border rounded-lg p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1">
                          <FolderOpen className="h-4 w-4 text-muted-foreground" />
                          {editingGroupId === group.id ? (
                            <Input
                              ref={renameInputRef}
                              value={editingGroupName}
                              onChange={(e) => setEditingGroupName(e.target.value)}
                              onBlur={handleRenameSubmit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleRenameSubmit();
                                } else if (e.key === 'Escape') {
                                  setEditingGroupId(null);
                                }
                              }}
                              className="h-7"
                            />
                          ) : (
                            <span className="font-medium">{group.name}</span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            ({groupTabs.length} {groupTabs.length === 1 ? 'tab' : 'tabs'})
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => handleStartRename(group.id, group.name)}
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteGroup(group.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Tabs in this group */}
                      {groupTabs.length > 0 && (
                        <div className="pl-6 space-y-1">
                          {groupTabs.map((tab) => (
                            <div
                              key={tab.path}
                              className="text-sm flex items-center justify-between py-1 px-2 rounded hover:bg-muted/50"
                            >
                              <span className="truncate">{tab.name}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2"
                                onClick={() => handleToggleTabInGroup(tab.path, tab.groupId, group.id)}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Ungrouped Tabs */}
          {ungroupedTabs.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Ungrouped Tabs ({ungroupedTabs.length})
              </label>
              <div className="border rounded-lg p-3 space-y-1">
                {ungroupedTabs.map((tab) => (
                  <div
                    key={tab.path}
                    className="text-sm flex items-center justify-between py-1 px-2 rounded hover:bg-muted/50"
                  >
                    <span className="truncate">{tab.name}</span>
                    {tabGroups.length > 0 && (
                      <select
                        className="text-xs border rounded px-2 py-1"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            moveTabToGroup(tab.path, e.target.value);
                          }
                        }}
                      >
                        <option value="">Add to group...</option>
                        {tabGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>

      {/* Confirmation Dialog */}
      <ConfirmDialog {...confirmDialogProps} />
    </Dialog>
  );
}

export default TabGroupManager;
