// Tab Group Manager Component
// Modal UI for creating and managing tab groups

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Edit2, Trash2, FolderOpen, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { cn } from '@/lib/utils';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/ui/dialog';
import { useEditorStore } from '@/stores/editorStore';

interface TabGroupManagerProps {
  open: boolean;
  onClose: () => void;
  /**
   * Renames the underlying file for a tab. When provided, each tab row
   * shows an inline edit pencil that opens a rename input. Omitting the
   * prop hides the rename affordance entirely (read-only mode).
   */
  onRenameTab?: (path: string, newName: string) => Promise<void>;
}

export function TabGroupManager({ open, onClose, onRenameTab }: TabGroupManagerProps) {
  const { t } = useTranslation();
  const {
    openTabs,
    tabGroups,
    createTabGroup,
    renameTabGroup,
    deleteTabGroup,
    moveTabToGroup,
    ungroupTab,
    reorderInTabBar,
  } = useEditorStore();

  // R3-P3: HTML5 drag state for reordering tabs inside the modal.
  // draggedTabPath identifies what the user picked up. dragOverTarget
  // tracks the row being hovered so we can render a coral indicator.
  const [draggedTabPath, setDraggedTabPath] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<
    | { kind: 'tab'; path: string; position: 'before' | 'after' }
    | { kind: 'group-empty'; groupId: string }
    | { kind: 'ungrouped-zone' }
    | null
  >(null);

  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Per-tab rename state. Keyed by the tab's current path so opening a
  // second rename closes any prior one without leaving stale UI.
  const [editingTabPath, setEditingTabPath] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState('');
  const tabRenameInputRef = useRef<HTMLInputElement>(null);

  // Confirmation dialog
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  // Auto-focus the rename input when editing starts
  useEffect(() => {
    if (editingGroupId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingGroupId]);

  // Auto-focus per-tab rename input. DEPS DISCIPLINE: only [editingTabPath].
  // Including editingTabName here makes the effect fire on every keystroke,
  // which re-runs select() and overwrites the user's just-typed character.
  useEffect(() => {
    if (editingTabPath && tabRenameInputRef.current) {
      tabRenameInputRef.current.focus();
      tabRenameInputRef.current.select();
    }
  }, [editingTabPath]);

  // Strip the extension at start so typing replaces the base name only;
  // submit reattaches the original extension. Mirrors TabBar's working
  // inline-rename pattern.
  const handleStartRenameTab = useCallback((path: string, currentName: string) => {
    const dot = currentName.lastIndexOf('.');
    const baseName = dot > 0 ? currentName.slice(0, dot) : currentName;
    setEditingTabPath(path);
    setEditingTabName(baseName);
  }, []);

  // R3-P3: drag-and-drop helpers for reordering tabs inside the modal.
  const handleTabDragStart = useCallback(
    (e: React.DragEvent, path: string) => {
      e.dataTransfer.setData('text/plain', `tabgm:${path}`);
      e.dataTransfer.effectAllowed = 'move';
      setDraggedTabPath(path);
    },
    [],
  );

  const handleTabDragEnd = useCallback(() => {
    setDraggedTabPath(null);
    setDragOverTarget(null);
  }, []);

  const handleRowDragOver = useCallback(
    (e: React.DragEvent, path: string) => {
      if (!draggedTabPath || draggedTabPath === path) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      const rect = e.currentTarget.getBoundingClientRect();
      const isBefore = e.clientY - rect.top < rect.height / 2;
      setDragOverTarget({ kind: 'tab', path, position: isBefore ? 'before' : 'after' });
    },
    [draggedTabPath],
  );

  const handleEmptyGroupDragOver = useCallback(
    (e: React.DragEvent, groupId: string) => {
      if (!draggedTabPath) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDragOverTarget({ kind: 'group-empty', groupId });
    },
    [draggedTabPath],
  );

  const handleUngroupedZoneDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!draggedTabPath) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDragOverTarget({ kind: 'ungrouped-zone' });
    },
    [draggedTabPath],
  );

  const handleTabDrop = useCallback(
    (e: React.DragEvent) => {
      if (!draggedTabPath || !dragOverTarget) {
        setDraggedTabPath(null);
        setDragOverTarget(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const draggedTab = openTabs.find((t) => t.path === draggedTabPath);
      if (!draggedTab) {
        setDraggedTabPath(null);
        setDragOverTarget(null);
        return;
      }

      if (dragOverTarget.kind === 'tab') {
        const targetTab = openTabs.find((t) => t.path === dragOverTarget.path);
        if (targetTab) {
          // Align group membership first (so target-group tabs order as
          // expected after the reorder).
          if (draggedTab.groupId !== targetTab.groupId) {
            // null → ungrouped; otherwise switch into the target group.
            moveTabToGroup(draggedTab.path, targetTab.groupId ?? null);
          }
          reorderInTabBar(
            { type: 'tab', id: draggedTab.path },
            { type: 'tab', id: targetTab.path },
            dragOverTarget.position,
          );
        }
      } else if (dragOverTarget.kind === 'group-empty') {
        moveTabToGroup(draggedTab.path, dragOverTarget.groupId);
      } else if (dragOverTarget.kind === 'ungrouped-zone') {
        if (draggedTab.groupId) {
          ungroupTab(draggedTab.path);
        }
      }

      setDraggedTabPath(null);
      setDragOverTarget(null);
    },
    [draggedTabPath, dragOverTarget, openTabs, moveTabToGroup, reorderInTabBar, ungroupTab],
  );

  const handleRenameTabSubmit = useCallback(async () => {
    if (!editingTabPath || !onRenameTab) {
      setEditingTabPath(null);
      setEditingTabName('');
      return;
    }
    const trimmed = editingTabName.trim();
    if (!trimmed) {
      setEditingTabPath(null);
      setEditingTabName('');
      return;
    }
    const currentName = editingTabPath.split('/').pop() ?? '';
    const dot = currentName.lastIndexOf('.');
    const ext = dot > 0 ? currentName.slice(dot) : '';
    const newName = trimmed.includes('.') ? trimmed : `${trimmed}${ext}`;
    if (newName === currentName) {
      setEditingTabPath(null);
      setEditingTabName('');
      return;
    }
    try {
      await onRenameTab(editingTabPath, newName);
    } catch (error) {
      console.error('Tab rename failed:', error);
    } finally {
      setEditingTabPath(null);
      setEditingTabName('');
    }
  }, [editingTabPath, editingTabName, onRenameTab]);

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
          <DialogTitle>{t('editor.tab-group-manager.title')}</DialogTitle>
          <DialogDescription>
            {t('editor.tab-group-manager.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Create New Group */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('editor.tab-group-manager.create-new')}</label>
            <div className="flex gap-2">
              <Input
                placeholder={t('editor.tab-group-manager.group-name-placeholder')}
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
                {t('common.actions.create')}
              </Button>
            </div>
          </div>

          {/* Existing Groups */}
          <div className="space-y-3">
            <label className="text-sm font-medium">{t('editor.tab-group-manager.existing-groups', { count: tabGroups.length })}</label>

            {tabGroups.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                {t('editor.tab-group-manager.no-groups')}
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
                      {groupTabs.length > 0 ? (
                        <div className="pl-6 space-y-1">
                          {groupTabs.map((tab) => {
                            const isDragOver =
                              dragOverTarget?.kind === 'tab' && dragOverTarget.path === tab.path;
                            const isBeingDragged = draggedTabPath === tab.path;
                            return (
                            <div
                              key={tab.path}
                              draggable={editingTabPath !== tab.path}
                              onDragStart={(e) => handleTabDragStart(e, tab.path)}
                              onDragEnd={handleTabDragEnd}
                              onDragOver={(e) => handleRowDragOver(e, tab.path)}
                              onDragLeave={(e) => {
                                if (e.currentTarget === e.target) setDragOverTarget(null);
                              }}
                              onDrop={handleTabDrop}
                              className={cn(
                                "text-sm flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-muted/50",
                                editingTabPath !== tab.path && "cursor-move",
                                isBeingDragged && "opacity-50",
                                isDragOver && dragOverTarget?.position === 'before' && "border-t-2 border-primary",
                                isDragOver && dragOverTarget?.position === 'after' && "border-b-2 border-primary",
                              )}
                            >
                              {editingTabPath === tab.path ? (
                                <Input
                                  ref={tabRenameInputRef}
                                  value={editingTabName}
                                  onChange={(e) => setEditingTabName(e.target.value)}
                                  onBlur={() => void handleRenameTabSubmit()}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      void handleRenameTabSubmit();
                                    } else if (e.key === 'Escape') {
                                      setEditingTabPath(null);
                                    }
                                  }}
                                  className="h-6 text-xs flex-1 min-w-0"
                                />
                              ) : (
                                <span className="truncate flex-1 min-w-0">{tab.name}</span>
                              )}
                              <div className="flex items-center gap-0.5 shrink-0">
                                {onRenameTab && editingTabPath !== tab.path && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2"
                                    title="Rename file"
                                    aria-label={`Rename ${tab.name}`}
                                    onClick={() => handleStartRenameTab(tab.path, tab.name)}
                                  >
                                    <Edit2 className="h-3 w-3" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2"
                                  title="Remove from group"
                                  onClick={() => handleToggleTabInGroup(tab.path, tab.groupId, group.id)}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                            );
                          })}
                        </div>
                      ) : (
                        // R3-P3: an empty group still accepts drops so users
                        // can move a tab into a previously emptied group.
                        <div
                          className={cn(
                            "pl-6 py-3 text-xs text-muted-foreground text-center rounded border border-dashed",
                            dragOverTarget?.kind === 'group-empty' && dragOverTarget.groupId === group.id
                              ? "border-primary bg-primary/10"
                              : "border-border/50",
                          )}
                          onDragOver={(e) => handleEmptyGroupDragOver(e, group.id)}
                          onDragLeave={(e) => {
                            if (e.currentTarget === e.target) setDragOverTarget(null);
                          }}
                          onDrop={handleTabDrop}
                        >
                          {t('editor.tab-group-manager.drop-to-add')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Ungrouped Tabs — always rendered so users can drag a tab OUT of a
              group by dropping it in this section even when it's currently empty. */}
          <div
            className="space-y-2"
            onDragOver={handleUngroupedZoneDragOver}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setDragOverTarget(null);
            }}
            onDrop={handleTabDrop}
          >
            <label className="text-sm font-medium">
              {t('editor.tab-group-manager.ungrouped-label', { count: ungroupedTabs.length })}
            </label>
            <div
              className={cn(
                "border rounded-lg p-3 space-y-1",
                dragOverTarget?.kind === 'ungrouped-zone' && "border-primary bg-primary/10",
                ungroupedTabs.length === 0 && "min-h-[48px] text-xs text-muted-foreground flex items-center justify-center",
              )}
            >
              {ungroupedTabs.length === 0 && dragOverTarget?.kind !== 'ungrouped-zone' && (
                <span>{t('editor.tab-group-manager.drag-to-ungroup')}</span>
              )}
              {ungroupedTabs.map((tab) => {
                const isDragOver =
                  dragOverTarget?.kind === 'tab' && dragOverTarget.path === tab.path;
                const isBeingDragged = draggedTabPath === tab.path;
                return (
                  <div
                    key={tab.path}
                    draggable={editingTabPath !== tab.path}
                    onDragStart={(e) => handleTabDragStart(e, tab.path)}
                    onDragEnd={handleTabDragEnd}
                    onDragOver={(e) => handleRowDragOver(e, tab.path)}
                    onDragLeave={(e) => {
                      if (e.currentTarget === e.target) setDragOverTarget(null);
                    }}
                    onDrop={handleTabDrop}
                    className={cn(
                      "text-sm flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-muted/50",
                      editingTabPath !== tab.path && "cursor-move",
                      isBeingDragged && "opacity-50",
                      isDragOver && dragOverTarget?.position === 'before' && "border-t-2 border-primary",
                      isDragOver && dragOverTarget?.position === 'after' && "border-b-2 border-primary",
                    )}
                  >
                    {editingTabPath === tab.path ? (
                      <Input
                        ref={tabRenameInputRef}
                        value={editingTabName}
                        onChange={(e) => setEditingTabName(e.target.value)}
                        onBlur={() => void handleRenameTabSubmit()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            void handleRenameTabSubmit();
                          } else if (e.key === 'Escape') {
                            setEditingTabPath(null);
                          }
                        }}
                        className="h-6 text-xs flex-1 min-w-0"
                      />
                    ) : (
                      <span className="truncate flex-1 min-w-0">{tab.name}</span>
                    )}
                    <div className="flex items-center gap-1 shrink-0">
                      {onRenameTab && editingTabPath !== tab.path && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2"
                          title="Rename file"
                          aria-label={`Rename ${tab.name}`}
                          onClick={() => handleStartRenameTab(tab.path, tab.name)}
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                      )}
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
                          <option value="">{t('editor.tab-group-manager.add-to-group')}</option>
                          {tabGroups.map((group) => (
                            <option key={group.id} value={group.id}>
                              {group.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
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
