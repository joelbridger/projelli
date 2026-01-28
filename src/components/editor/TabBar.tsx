// Tab Bar Component
// Displays open file tabs with close buttons, dirty indicators, drag-to-reorder, and tab groups

import { useCallback, useState, useRef } from 'react';
import { X, FileText, GripVertical, FileJson, FileImage, FileVideo, PenTool, Music, MoreHorizontal, MessageSquare, Settings, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useEditorStore } from '@/stores/editorStore';
import { TabGroupManager } from './TabGroupManager';

// Helper function to remove file extension from name
const removeExtension = (filename: string): string => {
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === 0) {
    return filename;
  }
  return filename.substring(0, lastDotIndex);
};

// Helper function to get file icon based on tab type and extension
const getFileIcon = (tab: { name: string; type?: 'file' | 'browser' | 'whiteboard' }) => {
  // Check tab type first
  if (tab.type === 'browser') {
    return <Globe className="h-4 w-4 text-sky-500 flex-shrink-0" />;
  }

  const ext = tab.name.split('.').pop()?.toLowerCase();

  if (ext === 'whiteboard') {
    return <PenTool className="h-4 w-4 text-orange-500 flex-shrink-0" />;
  } else if (ext === 'aichat') {
    return <MessageSquare className="h-4 w-4 text-purple-500 flex-shrink-0" />;
  } else if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
    return <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />;
  } else if (ext === 'json') {
    return <FileJson className="h-4 w-4 text-yellow-500 flex-shrink-0" />;
  } else if (ext === 'source') {
    return <FileText className="h-4 w-4 text-green-500 flex-shrink-0" />;
  } else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext || '')) {
    return <FileImage className="h-4 w-4 text-green-500 flex-shrink-0" />;
  } else if (['mp4', 'webm', 'mov', 'avi'].includes(ext || '')) {
    return <FileVideo className="h-4 w-4 text-purple-500 flex-shrink-0" />;
  } else if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext || '')) {
    return <Music className="h-4 w-4 text-pink-500 flex-shrink-0" />;
  }

  return <FileText className="h-4 w-4 flex-shrink-0" />;
};

interface TabBarProps {
  onRenameFile?: (path: string, newName: string) => Promise<void>;
}

export function TabBar({ onRenameFile }: TabBarProps = {}) {
  const {
    openTabs,
    activeTabPath,
    tabGroups,
    setActiveTab,
    closeTab,
    reorderTabs,
    createTabGroup,
    renameTabGroup,
    deleteTabGroup,
    moveTabToGroup,
    ungroupTab,
  } = useEditorStore();

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [dragOverTabBar, setDragOverTabBar] = useState(false); // Track when dragging over tab bar to ungroup
  const [dragIntent, setDragIntent] = useState<'group' | 'reorder' | null>(null); // Track drag intent
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | null>(null); // Track drop position for reorder
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState('');
  const [editingTabPath, setEditingTabPath] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState('');
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [openDropdownGroupId, setOpenDropdownGroupId] = useState<string | null>(null);
  const [dragOverDropdownIndex, setDragOverDropdownIndex] = useState<number | null>(null);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate max tabs per row (approximate based on typical tab width of 150px)
  const MAX_TABS_PER_ROW = 10;
  const MAX_VISIBLE_ROWS = 2;
  const MAX_VISIBLE_TABS = MAX_TABS_PER_ROW * MAX_VISIBLE_ROWS;


  const handleTabClick = useCallback((path: string) => {
    setActiveTab(path);
  }, [setActiveTab]);

  const handleTabClose = useCallback(
    async (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      const tab = openTabs.find((t) => t.path === path);

      if (tab?.isDirty) {
        const shouldClose = window.confirm(
          `"${tab.name}" has unsaved changes. Do you want to close it without saving?`
        );
        if (!shouldClose) {
          return;
        }
      }

      closeTab(path);
    },
    [openTabs, closeTab]
  );

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent, path: string) => {
      if (e.button === 1) {
        handleTabClose(e, path);
      }
    },
    [handleTabClose]
  );

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());

    // Set custom drag image with reduced opacity to minimize visual flashing
    if (e.currentTarget instanceof HTMLElement) {
      const dragImage = e.currentTarget.cloneNode(true) as HTMLElement;
      dragImage.style.opacity = '0.8';
      dragImage.style.position = 'absolute';
      dragImage.style.top = '-1000px';
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, 0, 0);
      // Clean up after drag starts
      setTimeout(() => document.body.removeChild(dragImage), 0);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
    setDragOverTabBar(false);
    setDragIntent(null);
    setDropPosition(null);
    setDragOverDropdownIndex(null);
    // Clear hover timer if drag ends
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Calculate hover position relative to the tab element
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;

    // Define zones: left 25% = before, right 25% = after, middle 50% = group
    const leftThreshold = width * 0.25;
    const rightThreshold = width * 0.75;

    let intent: 'group' | 'reorder' = 'group';
    let position: 'before' | 'after' | null = null;

    if (x < leftThreshold) {
      // Hovering on left edge - reorder before
      intent = 'reorder';
      position = 'before';
    } else if (x > rightThreshold) {
      // Hovering on right edge - reorder after
      intent = 'reorder';
      position = 'after';
    } else {
      // Hovering in middle - create/join group
      intent = 'group';
      position = null;
    }

    // Use requestAnimationFrame to reduce flicker by batching DOM updates
    if (dragOverIndex !== index || dragIntent !== intent || dropPosition !== position) {
      requestAnimationFrame(() => {
        setDragOverIndex(index);
        setDragIntent(intent);
        setDropPosition(position);
      });
    }

    // Clear any existing hover timer
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, [dragOverIndex, dragIntent, dropPosition]);

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
    setDragIntent(null);
    setDropPosition(null);
    // Clear hover timer if drag leaves
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();

    // Clear hover timer
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!isNaN(fromIndex) && fromIndex !== toIndex) {
      const draggedTab = openTabs[fromIndex];
      const targetTab = openTabs[toIndex];

      if (draggedTab && targetTab) {
        // Dual behavior: check drag intent
        if (dragIntent === 'reorder') {
          // REORDER: Drop between tabs
          let finalToIndex = toIndex;

          // Adjust index based on drop position
          if (dropPosition === 'after') {
            finalToIndex = toIndex + 1;
          }
          // 'before' uses toIndex as-is

          // Adjust for the dragged item being removed from the array
          if (fromIndex < finalToIndex) {
            finalToIndex -= 1;
          }

          reorderTabs(fromIndex, finalToIndex);

          // If the dragged tab was grouped, ungroup it when reordering
          if (draggedTab.groupId) {
            ungroupTab(draggedTab.path);
          }
        } else {
          // GROUP: Drop on middle of tab - create or join a group

          // Case 1: Both tabs are ungrouped - create a new group
          if (!draggedTab.groupId && !targetTab.groupId) {
            const existingGroupNumbers = tabGroups
              .map(g => {
                const match = g.name.match(/^Group (\d+)$/);
                return match && match[1] ? parseInt(match[1], 10) : 0;
              })
              .filter(n => n > 0);

            const nextNumber = existingGroupNumbers.length > 0
              ? Math.max(...existingGroupNumbers) + 1
              : 1;

            createTabGroup(`Group ${nextNumber}`, [draggedTab.path, targetTab.path]);
            setDraggedIndex(null);
            setDragOverIndex(null);
            setDragIntent(null);
            setDropPosition(null);
            return;
          }

          // Case 2: Target tab has a group - add dragged tab to that group
          if (targetTab.groupId) {
            moveTabToGroup(draggedTab.path, targetTab.groupId);
            setDraggedIndex(null);
            setDragOverIndex(null);
            setDragIntent(null);
            setDropPosition(null);
            return;
          }

          // Case 3: Dragged tab has a group but target doesn't - add target to dragged's group
          if (draggedTab.groupId && !targetTab.groupId) {
            moveTabToGroup(targetTab.path, draggedTab.groupId);
            setDraggedIndex(null);
            setDragOverIndex(null);
            setDragIntent(null);
            setDropPosition(null);
            return;
          }
        }
      }
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
    setDragIntent(null);
    setDropPosition(null);
  }, [reorderTabs, openTabs, moveTabToGroup, tabGroups, createTabGroup, dragIntent, dropPosition]);


  const handleGroupDoubleClick = useCallback((groupId: string, currentName: string) => {
    setRenamingGroupId(groupId);
    setRenameGroupValue(currentName);
    setShowRenameDialog(true);
  }, []);

  const handleGroupRenameSubmit = useCallback(() => {
    if (renamingGroupId && renameGroupValue.trim()) {
      renameTabGroup(renamingGroupId, renameGroupValue.trim());
    }
    setShowRenameDialog(false);
    setRenamingGroupId(null);
    setRenameGroupValue('');
  }, [renamingGroupId, renameGroupValue, renameTabGroup]);

  const handleGroupRenameCancel = useCallback(() => {
    setShowRenameDialog(false);
    setRenamingGroupId(null);
    setRenameGroupValue('');
  }, []);

  const handleGroupDelete = useCallback((groupId: string) => {
    if (window.confirm('Delete this tab group? Tabs will remain open.')) {
      deleteTabGroup(groupId);
    }
  }, [deleteTabGroup]);

  const handleGroupDragOver = useCallback((e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverGroupId(groupId);
  }, []);

  const handleGroupDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setDragOverGroupId(null);
  }, []);

  const handleGroupDrop = useCallback((e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverGroupId(null);

    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!isNaN(fromIndex)) {
      const tab = openTabs[fromIndex];
      if (tab) {
        // Move tab to this group (works for ungrouped tabs AND tabs from other groups)
        moveTabToGroup(tab.path, groupId);
      }
    }
  }, [openTabs, moveTabToGroup]);

  const handleTabDoubleClick = useCallback((tab: typeof openTabs[0]) => {
    setEditingTabPath(tab.path);
    setEditingTabName(removeExtension(tab.name));
  }, []);

  const handleTabRenameSubmit = useCallback(async () => {
    if (editingTabPath && editingTabName.trim() && onRenameFile) {
      const tab = openTabs.find(t => t.path === editingTabPath);
      if (tab) {
        // Get the file extension
        const ext = tab.name.split('.').pop();
        const newName = ext ? `${editingTabName.trim()}.${ext}` : editingTabName.trim();
        await onRenameFile(editingTabPath, newName);
      }
    }
    setEditingTabPath(null);
    setEditingTabName('');
  }, [editingTabPath, editingTabName, onRenameFile, openTabs]);

  // Handle dropping on the tab bar container (to ungroup tabs)
  const handleTabBarDragOver = useCallback((e: React.DragEvent) => {
    // Only handle drags that aren't over a specific tab or group
    const target = e.target as HTMLElement;
    const isOverTab = target.closest('[draggable="true"]');
    const isOverGroup = target.closest('[data-group-chip]');

    if (!isOverTab && !isOverGroup) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverTabBar(true);
    }
  }, []);

  const handleTabBarDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if we're leaving the tab bar entirely
    const relatedTarget = e.relatedTarget as HTMLElement;
    const tabBar = e.currentTarget as HTMLElement;
    if (!tabBar.contains(relatedTarget)) {
      setDragOverTabBar(false);
    }
  }, []);

  const handleTabBarDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOverTabBar(false);

    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!isNaN(fromIndex)) {
      const draggedTab = openTabs[fromIndex];

      // If tab is in a group, remove it from the group
      if (draggedTab?.groupId) {
        ungroupTab(draggedTab.path);
      }
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
  }, [openTabs, ungroupTab]);

  if (openTabs.length === 0) {
    return null;
  }

  const renderTab = (tab: typeof openTabs[0], index: number) => {
    const isActive = tab.path === activeTabPath;
    const isDragging = draggedIndex === index;
    const isDragOver = dragOverIndex === index && draggedIndex !== index;
    const showGroupIndicator = isDragOver && dragIntent === 'group';
    const showReorderIndicator = isDragOver && dragIntent === 'reorder';
    const showBefore = showReorderIndicator && dropPosition === 'before';
    const showAfter = showReorderIndicator && dropPosition === 'after';

    return (
      <div
        key={tab.path}
        draggable
        onDragStart={(e) => handleDragStart(e, index)}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => handleDragOver(e, index)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, index)}
        className={cn(
          'flex items-center gap-1 px-3 py-1.5 border-r cursor-pointer text-sm transition-colors min-w-0 h-9 relative',
          isActive
            ? 'bg-background text-foreground'
            : 'text-muted-foreground hover:bg-muted/50',
          isDragging && 'opacity-50',
          showGroupIndicator && 'bg-primary/20 border-primary',
          showBefore && 'border-l-2 border-l-primary',
          showAfter && 'border-r-2 border-r-primary'
        )}
        onClick={() => handleTabClick(tab.path)}
        onMouseDown={(e) => handleMiddleClick(e, tab.path)}
        onDoubleClick={() => handleTabDoubleClick(tab)}
      >
        <GripVertical className="h-3 w-3 flex-shrink-0 opacity-40 cursor-grab" />
        {getFileIcon(tab)}
        {editingTabPath === tab.path ? (
          <input
            type="text"
            value={editingTabName}
            onChange={(e) => setEditingTabName(e.target.value)}
            onBlur={handleTabRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleTabRenameSubmit();
              } else if (e.key === 'Escape') {
                setEditingTabPath(null);
                setEditingTabName('');
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            autoFocus
            className="truncate max-w-[120px] px-1 py-0 bg-background border rounded"
          />
        ) : (
          <span className="truncate max-w-[120px]">{removeExtension(tab.name)}</span>
        )}
        {tab.isDirty && (
          <span className="text-amber-500 font-bold" title="Unsaved changes">
            *
          </span>
        )}
        {!tab.isDirty && tab.lastSaved && Date.now() - tab.lastSaved < 3000 && (
          <span className="text-green-600 text-[10px] ml-1 opacity-70" title="Auto-saved">
            ✓
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 ml-1 rounded-sm hover:bg-muted"
          onClick={(e) => handleTabClose(e, tab.path)}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  };

  const renderGroupHeader = (group: typeof tabGroups[0], tabs: typeof openTabs) => {
    const isGroupDragOver = dragOverGroupId === group.id;
    const isOpen = openDropdownGroupId === group.id;

    return (
      <div
        key={`group-${group.id}`}
        data-group-chip
        className={cn(
          "flex items-center gap-1 px-2 py-1.5 border-r min-w-0 transition-colors h-9",
          isGroupDragOver ? "bg-primary/20 border-primary" : "bg-muted/30"
        )}
        onDragOver={(e) => handleGroupDragOver(e, group.id)}
        onDragLeave={handleGroupDragLeave}
        onDrop={(e) => handleGroupDrop(e, group.id)}
      >
        <DropdownMenu
          open={isOpen}
          onOpenChange={(open) => {
            setOpenDropdownGroupId(open ? group.id : null);
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-full px-2 gap-1.5 hover:bg-muted"
              onDoubleClick={(e) => {
                e.stopPropagation();
                handleGroupDoubleClick(group.id, group.name);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <span className="text-sm font-medium truncate max-w-24">{group.name}</span>
              <span className="text-xs text-muted-foreground font-medium">({tabs.length})</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[200px]">
            {/* List of tabs in group */}
            {tabs.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  Files in group
                </div>
                {tabs.map((tab, idx) => {
                  const tabIndex = openTabs.indexOf(tab);
                  const isDraggingThis = draggedIndex === tabIndex;
                  const isDragOverThis = dragOverDropdownIndex === idx && !isDraggingThis;

                  return (
                    <DropdownMenuItem
                      key={tab.path}
                      onClick={() => handleTabClick(tab.path)}
                      className={cn(
                        "gap-2 cursor-move",
                        isDraggingThis && "opacity-50",
                        isDragOverThis && "bg-primary/20"
                      )}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        handleDragStart(e as any, tabIndex);
                        // Delay dropdown close to allow drag ghost to be created
                        requestAnimationFrame(() => {
                          setOpenDropdownGroupId(null);
                        });
                      }}
                      onDragEnd={(e) => {
                        e.stopPropagation();
                        handleDragEnd();
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOverDropdownIndex(idx);
                      }}
                      onDragLeave={(e) => {
                        e.stopPropagation();
                        setDragOverDropdownIndex(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOverDropdownIndex(null);

                        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
                        if (!isNaN(fromIndex) && fromIndex !== tabIndex) {
                          const draggedTab = openTabs[fromIndex];
                          const targetTab = openTabs[tabIndex];

                          // Reorder within the same group
                          if (draggedTab && targetTab && draggedTab.groupId === targetTab.groupId) {
                            // Find positions within the group's tab array
                            const groupTabs = tabs;
                            const fromGroupIndex = groupTabs.findIndex(t => t.path === draggedTab.path);
                            const toGroupIndex = groupTabs.findIndex(t => t.path === targetTab.path);

                            if (fromGroupIndex !== -1 && toGroupIndex !== -1) {
                              // Calculate actual indices in openTabs array
                              const fromTab = groupTabs[fromGroupIndex];
                              const toTab = groupTabs[toGroupIndex];
                              if (fromTab && toTab) {
                                const actualFromIndex = openTabs.indexOf(fromTab);
                                const actualToIndex = openTabs.indexOf(toTab);
                                reorderTabs(actualFromIndex, actualToIndex);
                              }
                            }
                          }
                        }
                      }}
                      draggable
                    >
                      <GripVertical className="h-3 w-3 flex-shrink-0 opacity-40" />
                      {getFileIcon(tab)}
                      <span className="truncate flex-1">{removeExtension(tab.name)}</span>
                      {tab.isDirty && (
                        <span className="text-amber-500 font-bold" title="Unsaved changes">
                          *
                        </span>
                      )}
                    </DropdownMenuItem>
                  );
                })}
                <div className="h-px bg-border my-1" />
              </>
            )}
            {/* Group actions */}
            <DropdownMenuItem onClick={() => handleGroupDoubleClick(group.id, group.name)}>
              Rename Group
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleGroupDelete(group.id)} className="text-destructive">
              Delete Group
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  // Build a flat list of items to render inline: groups and ungrouped tabs only
  // Grouped tabs are ONLY shown inside the group dropdown menu, not in the main tab bar
  const renderItems: Array<{ type: 'tab' | 'group'; data: typeof openTabs[0] | typeof tabGroups[0] }> = [];

  // Add groups first as chips
  tabGroups.forEach((group) => {
    renderItems.push({ type: 'group', data: group });
  });

  // Add ungrouped tabs only - grouped tabs stay hidden in their group dropdown
  const ungroupedTabs = openTabs.filter((tab) => !tab.groupId);
  ungroupedTabs.forEach((tab) => {
    renderItems.push({ type: 'tab', data: tab });
  });

  const visibleItems = renderItems.slice(0, MAX_VISIBLE_TABS);
  const overflowItems = renderItems.slice(MAX_VISIBLE_TABS);

  return (
    <div className="border-b bg-muted/30">
      <div
        className={cn(
          "flex flex-wrap items-start relative transition-colors",
          dragOverTabBar && "bg-primary/10 ring-2 ring-primary/50 ring-inset"
        )}
        onDragOver={handleTabBarDragOver}
        onDragLeave={handleTabBarDragLeave}
        onDrop={handleTabBarDrop}
      >
        {visibleItems.map((item) => {
          if (item.type === 'group') {
            const group = item.data as typeof tabGroups[0];
            const groupTabs = openTabs.filter((tab) => tab.groupId === group.id);
            return renderGroupHeader(group, groupTabs);
          } else {
            const tab = item.data as typeof openTabs[0];
            return renderTab(tab, openTabs.indexOf(tab));
          }
        })}

        {/* Tab Group Manager Button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2 border-r"
          onClick={() => setShowGroupManager(true)}
          title="Manage Tab Groups"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>

        {/* Overflow Menu */}
        {overflowItems.length > 0 && (
          <DropdownMenu open={showOverflowMenu} onOpenChange={setShowOverflowMenu}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2 border-r text-xs gap-1"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
                +{overflowItems.length} more
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[300px] overflow-y-auto">
              {overflowItems.map((item) => {
                if (item.type === 'tab') {
                  const tab = item.data as typeof openTabs[0];
                  return (
                    <DropdownMenuItem
                      key={tab.path}
                      onClick={() => handleTabClick(tab.path)}
                      className="gap-2"
                    >
                      {getFileIcon(tab)}
                      <span className="truncate max-w-[200px]">{removeExtension(tab.name)}</span>
                      {tab.isDirty && (
                        <span className="text-amber-500 font-bold ml-auto" title="Unsaved changes">
                          *
                        </span>
                      )}
                      {!tab.isDirty && tab.lastSaved && Date.now() - tab.lastSaved < 3000 && (
                        <span className="text-green-600 text-xs ml-auto opacity-70" title="Auto-saved">
                          ✓
                        </span>
                      )}
                    </DropdownMenuItem>
                  );
                } else {
                  const group = item.data as typeof tabGroups[0];
                  const groupTabs = openTabs.filter(t => t.groupId === group.id);
                  return (
                    <DropdownMenuItem
                      key={group.id}
                      onClick={() => {
                        // Activate first tab in group
                        if (groupTabs[0]) {
                          handleTabClick(groupTabs[0].path);
                        }
                      }}
                      className="gap-2 font-medium"
                    >
                      <span className="truncate">{group.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">({groupTabs.length})</span>
                    </DropdownMenuItem>
                  );
                }
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Tab Group Manager Modal */}
      <TabGroupManager
        open={showGroupManager}
        onClose={() => setShowGroupManager(false)}
      />

      {/* Rename Group Dialog */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Rename Tab Group</DialogTitle>
            <DialogDescription>
              Enter a new name for the tab group.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="group-name" className="text-right">
                Name
              </Label>
              <Input
                id="group-name"
                value={renameGroupValue}
                onChange={(e) => setRenameGroupValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleGroupRenameSubmit();
                  } else if (e.key === 'Escape') {
                    handleGroupRenameCancel();
                  }
                }}
                className="col-span-3"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleGroupRenameCancel}>
              Cancel
            </Button>
            <Button onClick={handleGroupRenameSubmit}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TabBar;
