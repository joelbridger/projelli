// Tab Bar Component
// Displays open file tabs with close buttons, dirty indicators, drag-to-reorder, and tab groups

import { useCallback, useState, useRef, useEffect, useLayoutEffect } from 'react';
import { X, GripVertical, MoreHorizontal, MessageSquare, Settings, Globe, Sparkles, EyeOff, ChevronLeft, ChevronRight, Edit2 } from 'lucide-react';
import { getFileIcon } from '@/utils/fileIcons';
import { Button } from '@/components/ui/button';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useFileContextStore } from '@/stores/fileContextStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { useSettingsStore } from '@/stores/settingsStore';
import { TabGroupManager } from './TabGroupManager';

// Helper function to remove file extension from name
const removeExtension = (filename: string): string => {
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === 0) {
    return filename;
  }
  return filename.substring(0, lastDotIndex);
};

/**
 * URL-encode a tab path into a value that's safe to embed in a data-testid.
 * Colons, slashes, and spaces collapse to dashes — collisions across real
 * workspace paths are effectively impossible given the mapping is injective
 * over ASCII file-system chars, and tests reproduce this same function so
 * both sides agree on the exact string.
 */
export function pathToTestId(path: string): string {
  return path
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

// UX-37: Helper function to get file icon based on tab type and extension.
// Uses the shared getFileIcon SSOT from utils/fileIcons.ts for file tabs,
// with special-case overrides for non-file tab types (browser, AI assistant).
const getTabIcon = (tab: { name: string; type?: 'file' | 'browser' | 'whiteboard' | 'ai-assistant' | 'workflow-execution' }) => {
  if (tab.type === 'browser') {
    return <Globe className="h-4 w-4 text-sky-500 flex-shrink-0" />;
  }
  if (tab.type === 'ai-assistant') {
    return <MessageSquare className="h-4 w-4 text-purple-500 flex-shrink-0" />;
  }
  if (tab.type === 'workflow-execution') {
    return <Sparkles className="h-4 w-4 text-amber-500 flex-shrink-0" />;
  }
  const ext = tab.name.split('.').pop()?.toLowerCase();
  const { Icon, color } = getFileIcon(ext);
  return <Icon className={`h-4 w-4 ${color} flex-shrink-0`} />;
};

/**
 * Per-tab AI-context toggle. Shown only when the file has an extracted
 * context (meaning the hook picked it up and turned it into AI-visible text);
 * hidden entirely for unsupported types like PDFs or images so the UI stays
 * quiet. Clicking toggles the path in `fileContextStore.disabledPaths`.
 */
function AIContextChip({ path }: { path: string }) {
  const hasContext = useFileContextStore((s) => s.hasContext(path));
  const enabled = useFileContextStore((s) => s.isEnabled(path));
  const togglePath = useFileContextStore((s) => s.togglePath);

  if (!hasContext) {
    return null;
  }

  const title = enabled
    ? 'This file is visible to AI chat — click to hide it from AI'
    : 'This file is NOT visible to AI chat — click to enable';

  return (
    <button
      type="button"
      data-testid={`ai-context-toggle-${pathToTestId(path)}`}
      data-ai-enabled={enabled ? 'true' : 'false'}
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        togglePath(path);
      }}
      className={cn(
        'flex items-center justify-center h-4 w-4 rounded-sm transition-opacity',
        'text-muted-foreground hover:text-foreground',
        enabled ? 'opacity-60 hover:opacity-100' : 'opacity-40 hover:opacity-80'
      )}
    >
      {enabled ? (
        <Sparkles className="h-3 w-3" />
      ) : (
        <EyeOff className="h-3 w-3" />
      )}
    </button>
  );
}

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

  // Tab overflow mode: canonical source is settingsStore. Falls back to the
  // old editorStore value (which itself falls back to 'scroll') so existing
  // users see no change until they visit Settings.
  const tabOverflow = useSettingsStore(
    (s) => s.getSetting<'scroll' | 'wrap'>('tabOverflow')
  ) ?? 'scroll';

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
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [openDropdownGroupId, setOpenDropdownGroupId] = useState<string | null>(null);
  const [dragOverDropdownIndex, setDragOverDropdownIndex] = useState<number | null>(null);
  const [dropdownDropPosition, setDropdownDropPosition] = useState<'before' | 'after' | null>(null);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Deferred-open timer for tab-group chips: a single click waits 250ms
  // before opening the dropdown so a double-click can intercept and open
  // the rename dialog instead. Without this Radix's pointerdown auto-open
  // would fire before dblclick is detected.
  const groupClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Horizontal scroll state for the tab-strip overflow arrows
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Confirmation dialog
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  // Track whether the tab strip can scroll left / right so the arrow buttons
  // only render when there's something to scroll to. Runs on mount, on tab
  // count change, on window resize, and on the strip's own scroll event.
  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const maxScrollLeft = el.scrollWidth - el.clientWidth;
    // 1px tolerance for fractional pixel scrollLeft values in some browsers.
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft < maxScrollLeft - 1);
  }, []);

  const scrollTabs = useCallback((dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    // Scroll by roughly one-tab width (160 ≈ midpoint of 120–200 range)
    const delta = dir === 'left' ? -200 : 200;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  // Wire scroll/resize observers. useLayoutEffect so we read sizes after
  // layout but before paint.
  useLayoutEffect(() => {
    updateScrollButtons();
  }, [updateScrollButtons, openTabs.length, tabGroups.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => updateScrollButtons();
    el.addEventListener('scroll', onScroll, { passive: true });

    const ro = new ResizeObserver(() => updateScrollButtons());
    ro.observe(el);

    window.addEventListener('resize', onScroll);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      ro.disconnect();
    };
  }, [updateScrollButtons]);

  // When the active tab changes (e.g. user clicked the overflow list or
  // opened a new file), scroll it into view so users don't have to hunt for
  // it in the strip.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeTabPath) return;
    // Query within the scroll container so we don't match similar IDs from
    // the overflow dropdown.
    const idx = openTabs.findIndex((t) => t.path === activeTabPath);
    if (idx < 0) return;
    const children = el.children;
    const child = children.item(idx) as HTMLElement | null;
    if (!child) return;
    // scrollIntoView with inline:'nearest' avoids jumpy behavior when the
    // active tab is already visible.
    child.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [activeTabPath, openTabs]);

  const handleTabClick = useCallback((path: string) => {
    setActiveTab(path);
  }, [setActiveTab]);

  const handleTabClose = useCallback(
    async (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      const tab = openTabs.find((t) => t.path === path);

      if (tab?.isDirty) {
        const shouldClose = await confirm(
          `"${tab.name}" has unsaved changes. Do you want to close it without saving?`,
          {
            title: 'Unsaved Changes',
            variant: 'destructive',
            confirmLabel: 'Close Without Saving',
            cancelLabel: 'Keep Open',
          }
        );
        if (!shouldClose) {
          return;
        }
      }

      closeTab(path);
    },
    [openTabs, closeTab, confirm]
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

    // Per the v1.6 plan: dropping a tab onto another tab in the bar always
    // creates or joins a group. The previous left-25%/right-25% zone math
    // (which produced reorder swaps) was confusing — especially when a tab
    // dragged out of a group landed on an edge and silently lost its group.
    // Reorder still works inside a group's expanded dropdown and via drop
    // onto the empty bar area (which ungroups).
    const intent: 'group' | 'reorder' = 'group';
    const position: 'before' | 'after' | null = null;

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
        // Tab-on-tab drop ALWAYS creates or joins a group (per v1.6 spec).
        // No more reorder branch here; reorder happens inside the dropdown
        // for same-group tabs, and ungroup happens via drop on empty bar.

        // Case 1: Both tabs are ungrouped — create a new group.
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
        }
        // Case 2: Target tab has a group — add dragged tab to that group.
        else if (targetTab.groupId) {
          moveTabToGroup(draggedTab.path, targetTab.groupId);
        }
        // Case 3: Dragged tab has a group but target doesn't — add target.
        else if (draggedTab.groupId && !targetTab.groupId) {
          moveTabToGroup(targetTab.path, draggedTab.groupId);
        }
      }
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
    setDragIntent(null);
    setDropPosition(null);
  }, [openTabs, moveTabToGroup, tabGroups, createTabGroup]);


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

  const handleGroupDelete = useCallback(async (groupId: string) => {
    const confirmed = await confirm('Delete this tab group? Tabs will remain open.', {
      title: 'Delete Tab Group',
      variant: 'destructive',
      confirmLabel: 'Delete Group',
    });
    if (confirmed) {
      deleteTabGroup(groupId);
    }
  }, [deleteTabGroup, confirm]);

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
        data-testid={`tab-${pathToTestId(tab.path)}`}
        data-active={isActive ? 'true' : 'false'}
        draggable
        onDragStart={(e) => handleDragStart(e, index)}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => handleDragOver(e, index)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, index)}
        // `group` enables group-hover:* targeting on descendants (the close X).
        className={cn(
          'group flex items-center gap-1 px-3 py-1.5 border-r cursor-pointer text-sm transition-colors h-9 relative flex-shrink-0 snap-start',
          'min-w-[120px] max-w-[200px]',
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
        {getTabIcon(tab)}
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
            className="truncate flex-1 min-w-0 px-1 py-0 bg-background border rounded"
          />
        ) : (
          <span className="truncate flex-1 min-w-0">{removeExtension(tab.name)}</span>
        )}
        <AIContextChip path={tab.path} />
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
          data-testid={`tab-close-${pathToTestId(tab.path)}`}
          variant="ghost"
          size="sm"
          // UX-22: Close X shows only when the tab is active, hovered, or
          // focused (keyboard users). `opacity-0` hides by default;
          // `group-hover:opacity-100` and `focus-visible:opacity-100` bring
          // it back when the tab's container is hovered or the button
          // itself gets keyboard focus. `isActive` forces it visible so
          // active tabs always have a close affordance.
          className={cn(
            'h-5 w-5 p-0 ml-1 rounded-sm hover:bg-muted transition-opacity',
            isActive
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
          )}
          onClick={(e) => handleTabClose(e, tab.path)}
          aria-label="Close tab"
          title="Close tab (Ctrl+W)"
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
          "flex items-center gap-1 px-2 py-1.5 border-r min-w-0 transition-colors h-9 flex-shrink-0 snap-start",
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
              onPointerDown={(e) => {
                // Suppress Radix's open-on-pointerdown so we can defer the
                // open by 250ms and let a double-click intercept it.
                e.preventDefault();
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (groupClickTimerRef.current) {
                  clearTimeout(groupClickTimerRef.current);
                }
                if (isOpen) {
                  // Already open → click closes immediately.
                  setOpenDropdownGroupId(null);
                  return;
                }
                groupClickTimerRef.current = setTimeout(() => {
                  setOpenDropdownGroupId(group.id);
                  groupClickTimerRef.current = null;
                }, 250);
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (groupClickTimerRef.current) {
                  clearTimeout(groupClickTimerRef.current);
                  groupClickTimerRef.current = null;
                }
                setOpenDropdownGroupId(null);
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
            {/* Group-level actions live at the top so they're discoverable
                even without remembering the double-click shortcut. */}
            <DropdownMenuItem
              onSelect={() => {
                handleGroupDoubleClick(group.id, group.name);
              }}
            >
              <Edit2 className="h-3.5 w-3.5 mr-2" />
              Rename group...
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
                  const isEditingThis = editingTabPath === tab.path;

                  return (
                    <div
                      key={tab.path}
                      role="menuitem"
                      tabIndex={-1}
                      className={cn(
                        "relative flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none",
                        !isEditingThis && "cursor-move hover:bg-accent hover:text-accent-foreground",
                        isDraggingThis && "opacity-50",
                        isDragOverThis && dropdownDropPosition === 'before' && "border-t-2 border-primary",
                        isDragOverThis && dropdownDropPosition === 'after' && "border-b-2 border-primary",
                      )}
                      onClick={(e) => {
                        if (isEditingThis) return;
                        e.stopPropagation();
                        handleTabClick(tab.path);
                        setOpenDropdownGroupId(null);
                      }}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleTabDoubleClick(tab);
                      }}
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
                        setDragOverDropdownIndex(null);
                        setDropdownDropPosition(null);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOverDropdownIndex(idx);
                        const rect = e.currentTarget.getBoundingClientRect();
                        const isBefore = (e.clientY - rect.top) < rect.height / 2;
                        setDropdownDropPosition(isBefore ? 'before' : 'after');
                      }}
                      onDragLeave={(e) => {
                        e.stopPropagation();
                        // Only clear when leaving the row, not when crossing into a child
                        if (e.currentTarget === e.target) {
                          setDragOverDropdownIndex(null);
                          setDropdownDropPosition(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const position = dropdownDropPosition;
                        setDragOverDropdownIndex(null);
                        setDropdownDropPosition(null);

                        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
                        if (isNaN(fromIndex) || fromIndex === tabIndex) return;

                        const draggedTab = openTabs[fromIndex];
                        const targetTab = openTabs[tabIndex];
                        if (!draggedTab || !targetTab) return;
                        // Reorder within the same group only
                        if (draggedTab.groupId !== targetTab.groupId) return;

                        const actualFromIndex = openTabs.indexOf(draggedTab);
                        let actualToIndex = openTabs.indexOf(targetTab);
                        if (position === 'after') actualToIndex += 1;
                        // Reorder semantics: when moving forward, the target
                        // shifts left by one as the source is removed first.
                        if (actualFromIndex < actualToIndex) actualToIndex -= 1;
                        reorderTabs(actualFromIndex, actualToIndex);
                      }}
                      draggable={!isEditingThis}
                    >
                      <GripVertical className="h-3 w-3 flex-shrink-0 opacity-40" />
                      {getTabIcon(tab)}
                      {isEditingThis ? (
                        <input
                          type="text"
                          value={editingTabName}
                          onChange={(e) => setEditingTabName(e.target.value)}
                          onBlur={handleTabRenameSubmit}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            // Stop arrow keys from triggering Radix typeahead.
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                              handleTabRenameSubmit();
                            } else if (e.key === 'Escape') {
                              setEditingTabPath(null);
                              setEditingTabName('');
                            }
                          }}
                          autoFocus
                          className="truncate flex-1 min-w-0 px-1 py-0 bg-background border rounded text-xs"
                        />
                      ) : (
                        <span className="truncate flex-1">{removeExtension(tab.name)}</span>
                      )}
                      {tab.isDirty && (
                        <span className="text-amber-500 font-bold" title="Unsaved changes">
                          *
                        </span>
                      )}
                      {!isEditingThis && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 opacity-50 hover:opacity-100"
                          title="Close tab"
                          aria-label={`Close ${tab.name}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            closeTab(tab.path);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  );
                })}
                <DropdownMenuSeparator />
              </>
            )}
            {/* Destructive action — Rename now lives at the top of the menu. */}
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

  return (
    <div className="border-b bg-muted/30 min-w-0 w-full" data-testid="tab-bar-root">
      <div
        className={cn(
          "flex items-stretch relative transition-colors min-w-0 w-full",
          dragOverTabBar && "bg-primary/10 ring-2 ring-primary/50 ring-inset"
        )}
        onDragOver={handleTabBarDragOver}
        onDragLeave={handleTabBarDragLeave}
        onDrop={handleTabBarDrop}
      >
        {/* Left scroll arrow — only visible when scrolled right */}
        {canScrollLeft && (
          <Button
            data-testid="tab-bar-scroll-left"
            variant="ghost"
            size="sm"
            className="h-9 px-1.5 border-r flex-shrink-0"
            onClick={() => scrollTabs('left')}
            title="Scroll tabs left"
            aria-label="Scroll tabs left"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}

        {/* Horizontally scrollable tab strip. Mouse wheel → horizontal scroll
            via onWheel. scroll-snap keeps tabs aligned to their left edge.
            flex-1 min-w-0 + max-w-full together clip the strip width to the
            parent so overflow-x-auto can activate; otherwise the flex item
            would expand to accommodate its content. */}
        <div
          ref={scrollRef}
          data-testid="tab-bar-scroll"
          className={cn(
            "flex items-stretch flex-1 min-w-0 max-w-full",
            tabOverflow === 'scroll'
              ? "overflow-x-auto overflow-y-hidden [scrollbar-width:thin] [scroll-snap-type:x_proximity]"
              : "flex-wrap overflow-hidden"
          )}
          onWheel={(e) => {
            // Vertical wheel → horizontal scroll (standard on tab bars). Only
            // intercept when the scroll container actually has horizontal
            // overflow, otherwise let the event bubble so nothing breaks on
            // narrow dev viewports.
            const el = scrollRef.current;
            if (!el) return;
            if (el.scrollWidth <= el.clientWidth) return;
            // If the user is using shift+wheel or a trackpad with horizontal
            // intent, deltaX is non-zero and the browser handles it for us.
            if (e.deltaY !== 0 && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
              el.scrollLeft += e.deltaY;
            }
          }}
        >
          {renderItems.map((item) => {
            if (item.type === 'group') {
              const group = item.data as typeof tabGroups[0];
              const groupTabs = openTabs.filter((tab) => tab.groupId === group.id);
              return renderGroupHeader(group, groupTabs);
            } else {
              const tab = item.data as typeof openTabs[0];
              return renderTab(tab, openTabs.indexOf(tab));
            }
          })}
        </div>

        {/* Right scroll arrow — only visible when there's more to the right */}
        {canScrollRight && (
          <Button
            data-testid="tab-bar-scroll-right"
            variant="ghost"
            size="sm"
            className="h-9 px-1.5 border-l flex-shrink-0"
            onClick={() => scrollTabs('right')}
            title="Scroll tabs right"
            aria-label="Scroll tabs right"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}

        {/* Tab Group Manager Button (stays outside scroll, always visible) */}
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2 border-l flex-shrink-0"
          onClick={() => setShowGroupManager(true)}
          title="Manage Tab Groups"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>

        {/* All-tabs overflow menu — useful even when tabs fit, as a quick jump
            list. Rendered outside scroll so it's always reachable. */}
        {renderItems.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-testid="tab-bar-overflow"
                variant="ghost"
                size="sm"
                className="h-9 px-2 border-l flex-shrink-0"
                title="All open tabs"
                aria-label="All open tabs"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[300px] overflow-y-auto">
              {renderItems.map((item) => {
                if (item.type === 'tab') {
                  const tab = item.data as typeof openTabs[0];
                  return (
                    <DropdownMenuItem
                      key={tab.path}
                      onClick={() => handleTabClick(tab.path)}
                      className="gap-2"
                    >
                      {getTabIcon(tab)}
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
        {...(onRenameFile ? { onRenameTab: onRenameFile } : {})}
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

      {/* Confirmation Dialog */}
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}

export default TabBar;
