// Tab Bar Component
// Displays open file tabs with close buttons, dirty indicators, drag-to-reorder, and tab groups

import { useCallback, useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { X, GripVertical, MoreHorizontal, Settings, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/ui/button';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { cn } from '@/lib/utils';
import { useEditorStore } from '@/platform/state/editorStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { TabGroupManager } from './TabGroupManager';
import { removeExtension, pathToTestId, getTabIcon, AIContextChip } from './tabBarHelpers';

interface TabBarProps {
  onRenameFile?: (path: string, newName: string) => Promise<void>;
}

export function TabBar({ onRenameFile }: TabBarProps = {}) {
  const { t } = useTranslation();
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
    reorderTabGroups,
    mergeTabGroups,
    pendingRenamePath,
    setPendingRenamePath,
    pendingGroupRenameId,
    setPendingGroupRenameId,
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
  // R2-P3/P4: zone the user is hovering on a target group chip. 'merge' =
  // drop-on-chip-center tints the whole chip; 'before'/'after' = drop on
  // edge shows a vertical coral line. Only meaningful while a group drag
  // is in flight.
  const [dragOverGroupZone, setDragOverGroupZone] = useState<'merge' | 'before' | 'after' | null>(null);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dragOverTabBar, setDragOverTabBar] = useState(false); // Track when dragging over tab bar to ungroup
  const [dragIntent, setDragIntent] = useState<'group' | 'reorder' | null>(null); // Track drag intent
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | null>(null); // Track drop position for reorder
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  // Distinguishes a brand-new group (dialog says "Name your group") from
  // a rename of an existing group (dialog says "Rename Tab Group").
  const [isNewGroupDialog, setIsNewGroupDialog] = useState(false);
  const renameGroupInputRef = useRef<HTMLInputElement | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState('');
  const [editingTabPath, setEditingTabPath] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState('');
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [openDropdownGroupId, setOpenDropdownGroupId] = useState<string | null>(null);
  const [dragOverDropdownIndex, setDragOverDropdownIndex] = useState<number | null>(null);
  const [dropdownDropPosition, setDropdownDropPosition] = useState<'before' | 'after' | null>(null);
  // Captured bounding rect of the currently open group chip. Used to
  // position the portaled popover with position: fixed so it can escape
  // the tab strip's overflow-y-hidden clip.
  const [popoverAnchorRect, setPopoverAnchorRect] = useState<{ top: number; left: number } | null>(null);
  // Right-click context menu on a tab. Anchored at the mouse position;
  // replaces the per-tab close X that used to take visual space.
  const [tabContextMenu, setTabContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  // R2-P2: when a file-creation flow sets pendingRenamePath and the new tab
  // lands in openTabs, drop it into inline-rename mode so the user can
  // type the name right away. The flag is one-shot so it doesn't re-fire
  // when the user cancels rename and the same tab is still open.
  useEffect(() => {
    if (!pendingRenamePath) return;
    const newTab = openTabs.find((t) => t.path === pendingRenamePath);
    if (!newTab) return; // tab not yet in store; effect will re-run when it lands
    setActiveTab(pendingRenamePath);
    setEditingTabPath(pendingRenamePath);
    setEditingTabName(removeExtension(newTab.name));
    setPendingRenamePath(null);
  }, [pendingRenamePath, openTabs, setActiveTab, setPendingRenamePath]);

  // Close the custom group popover on outside click or Escape.
  useEffect(() => {
    if (!openDropdownGroupId) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      // Clicks inside a chip wrapper (the wrapper has data-group-chip) or
      // inside the popover div itself stay open. Anything else closes.
      let el: Node | null = target;
      while (el) {
        if (el instanceof HTMLElement) {
          if (el.dataset['groupChip'] !== undefined || el.getAttribute('role') === 'menu') {
            return;
          }
        }
        el = el.parentNode;
      }
      setOpenDropdownGroupId(null);
      setPopoverAnchorRect(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenDropdownGroupId(null);
        setPopoverAnchorRect(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [openDropdownGroupId]);

  // R3-P2: when a brand-new tab group is created, open the rename dialog
  // so the user can name it immediately. One-shot.
  useEffect(() => {
    if (!pendingGroupRenameId) return;
    const group = tabGroups.find((g) => g.id === pendingGroupRenameId);
    if (!group) return;
    setRenamingGroupId(group.id);
    setRenameGroupValue(group.name);
    setIsNewGroupDialog(true);
    setShowRenameDialog(true);
    setPendingGroupRenameId(null);
  }, [pendingGroupRenameId, tabGroups, setPendingGroupRenameId]);

  // Autofocus + select the group-name input whenever the dialog opens
  // (either new-group or rename). Using useLayoutEffect so the selection
  // runs before the next paint, avoiding a visible unselected flash.
  useLayoutEffect(() => {
    if (!showRenameDialog) return;
    const input = renameGroupInputRef.current;
    if (!input) return;
    // The dialog mounts the input asynchronously — wait one tick so the
    // DOM node is definitely in place and focusable.
    const id = requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return () => cancelAnimationFrame(id);
  }, [showRenameDialog]);

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

  // R3-P1 unified model: on any tab drop target the drop zone splits
  // into left 30% (reorder before), right 30% (after), middle 40%
  // (combine — create/join/merge depending on source+target type). The
  // same math runs on group chips via handleGroupDragOver.
  const computeTabZone = (e: React.DragEvent): 'before' | 'combine' | 'after' => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width * 0.30) return 'before';
    if (x > rect.width * 0.70) return 'after';
    return 'combine';
  };

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const zone = computeTabZone(e);
    const intent: 'group' | 'reorder' = zone === 'combine' ? 'group' : 'reorder';
    const position: 'before' | 'after' | null =
      zone === 'before' ? 'before' : zone === 'after' ? 'after' : null;

    if (dragOverIndex !== index || dragIntent !== intent || dropPosition !== position) {
      requestAnimationFrame(() => {
        setDragOverIndex(index);
        setDragIntent(intent);
        setDropPosition(position);
      });
    }

    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, [dragOverIndex, dragIntent, dropPosition]);

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
    setDragIntent(null);
    setDropPosition(null);
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  // Helper: next available "Group N" name.
  const nextGroupName = useCallback(() => {
    const existingGroupNumbers = tabGroups
      .map((g) => {
        const match = g.name.match(/^Group (\d+)$/);
        return match && match[1] ? parseInt(match[1], 10) : 0;
      })
      .filter((n) => n > 0);
    const nextNumber = existingGroupNumbers.length > 0 ? Math.max(...existingGroupNumbers) + 1 : 1;
    return `Group ${nextNumber}`;
  }, [tabGroups]);

  const handleDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();

    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    const zone = computeTabZone(e);
    const payload = e.dataTransfer.getData('text/plain');
    const targetTab = openTabs[toIndex];
    if (!targetTab) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      setDragIntent(null);
      setDropPosition(null);
      return;
    }

    // ──── Group payload ────────────────────────────────────────────
    if (payload.startsWith('group:')) {
      const sourceGroupId = payload.slice('group:'.length);
      if (sourceGroupId && sourceGroupId !== targetTab.groupId) {
        // Zone decides: center = absorb tab into group, edges = reorder
        // the group's block before/after the target tab.
        if (zone === 'combine') {
          moveTabToGroup(targetTab.path, sourceGroupId);
        } else {
          const position: 'before' | 'after' = zone === 'before' ? 'before' : 'after';
          useEditorStore.getState().reorderInTabBar(
            { type: 'group', id: sourceGroupId },
            { type: 'tab', id: targetTab.path },
            position,
          );
        }
      }
      setDraggedIndex(null);
      setDragOverIndex(null);
      setDragIntent(null);
      setDropPosition(null);
      return;
    }

    // ──── Tab payload ─────────────────────────────────────────────
    const fromIndex = parseInt(payload, 10);
    if (isNaN(fromIndex) || fromIndex === toIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      setDragIntent(null);
      setDropPosition(null);
      return;
    }
    const draggedTab = openTabs[fromIndex];
    if (!draggedTab) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      setDragIntent(null);
      setDropPosition(null);
      return;
    }

    if (zone === 'combine') {
      // Tab dropped on center of another tab:
      //   both ungrouped  → new group with both
      //   target grouped  → join target's group (dragged leaves its own)
      //   dragged grouped, target ungrouped → new group pairing both
      if (!draggedTab.groupId && !targetTab.groupId) {
        const newId = createTabGroup(nextGroupName(), [draggedTab.path, targetTab.path]);
        useEditorStore.getState().setPendingGroupRenameId(newId);
      } else if (targetTab.groupId) {
        moveTabToGroup(draggedTab.path, targetTab.groupId);
      } else if (draggedTab.groupId && !targetTab.groupId) {
        const newId = createTabGroup(nextGroupName(), [draggedTab.path, targetTab.path]);
        useEditorStore.getState().setPendingGroupRenameId(newId);
      }
    } else {
      // Tab dropped on edge of another tab → reorder. Ungroup the dragged
      // tab if it was in a group (same contract as drop-on-empty-area).
      useEditorStore.getState().reorderInTabBar(
        { type: 'tab', id: draggedTab.path },
        { type: 'tab', id: targetTab.path },
        zone === 'before' ? 'before' : 'after',
      );
      if (draggedTab.groupId) {
        ungroupTab(draggedTab.path);
      }
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
    setDragIntent(null);
    setDropPosition(null);
  }, [openTabs, moveTabToGroup, createTabGroup, nextGroupName, ungroupTab]);


  const handleGroupDoubleClick = useCallback((groupId: string, currentName: string) => {
    setRenamingGroupId(groupId);
    setRenameGroupValue(currentName);
    setIsNewGroupDialog(false);
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
    // Zone is only meaningful when dragging a group payload. For tab
    // payloads we just use the whole-chip tint (moves tab to group).
    if (draggedGroupId && draggedGroupId !== groupId) {
      setDragOverGroupZone(computeGroupDropZone(e));
    } else {
      setDragOverGroupZone(null);
    }
  }, [draggedGroupId]);

  const handleGroupDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setDragOverGroupId(null);
    setDragOverGroupZone(null);
  }, []);

  // Drop a group payload on another group chip. Zone decides merge vs. reorder:
  //  left 30 %  → reorder 'before'
  //  right 30 % → reorder 'after'
  //  middle 40 % → merge
  const computeGroupDropZone = (e: React.DragEvent): 'merge' | 'before' | 'after' => {
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const leftCut = rect.width * 0.30;
    const rightCut = rect.width * 0.70;
    if (x < leftCut) return 'before';
    if (x > rightCut) return 'after';
    return 'merge';
  };

  const handleGroupDrop = useCallback((e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const zone = dragOverGroupZone;
    setDragOverGroupId(null);
    setDragOverGroupZone(null);

    const payload = e.dataTransfer.getData('text/plain');
    // Group payload takes the form "group:<sourceId>"; tab payload is a
    // numeric index as a string. Branch on prefix so the two can share
    // the same drop target without confusion.
    if (payload.startsWith('group:')) {
      const sourceId = payload.slice('group:'.length);
      if (!sourceId || sourceId === groupId) return;
      if (zone === 'before' || zone === 'after') {
        reorderTabGroups(sourceId, groupId, zone);
      } else {
        mergeTabGroups(sourceId, groupId);
      }
      return;
    }
    const fromIndex = parseInt(payload, 10);
    if (!isNaN(fromIndex)) {
      const tab = openTabs[fromIndex];
      if (tab) {
        // Move tab to this group (works for ungrouped tabs AND tabs from other groups)
        moveTabToGroup(tab.path, groupId);
      }
    }
  }, [openTabs, moveTabToGroup, dragOverGroupZone, reorderTabGroups, mergeTabGroups]);

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
        try {
          await onRenameFile(editingTabPath, newName);
        } catch (err) {
          console.error('Tab rename failed:', err);
        }
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
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setTabContextMenu({ path: tab.path, x: e.clientX, y: e.clientY });
        }}
      >
        {getTabIcon(tab)}
        {editingTabPath === tab.path ? (
          <input
            type="text"
            value={editingTabName}
            onChange={(e) => setEditingTabName(e.target.value)}
            onBlur={() => void handleTabRenameSubmit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void handleTabRenameSubmit();
              } else if (e.key === 'Escape') {
                setEditingTabPath(null);
                setEditingTabName('');
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            autoFocus
            // Size the rename input to the tab's display width rather
            // than letting it flex-grow into the whole tab bar.
            size={Math.max(editingTabName.length + 1, 6)}
            className="min-w-0 max-w-[180px] px-1 py-0 bg-background border rounded"
          />
        ) : (
          <span className="truncate min-w-0 max-w-[140px]">{removeExtension(tab.name)}</span>
        )}
        <AIContextChip path={tab.path} />
        {tab.isDirty && (
          <span className="text-amber-700 font-bold" title="Unsaved changes">
            *
          </span>
        )}
        {!tab.isDirty && tab.lastSaved && Date.now() - tab.lastSaved < 3000 && (
          <span className="text-green-600 text-[10px] ml-1 opacity-70" title="Auto-saved">
            ✓
          </span>
        )}
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
        draggable
        className={cn(
          "relative flex items-center gap-1 px-2 py-1.5 border-r min-w-0 transition-colors h-9 flex-shrink-0 snap-start",
          isGroupDragOver && dragOverGroupZone === 'merge' && "bg-primary/20 border-primary",
          // Full-chip highlight when a tab (not a group) is dragged over it.
          isGroupDragOver && !draggedGroupId && "bg-primary/20 border-primary",
          !isGroupDragOver && "bg-muted/30",
          draggedGroupId === group.id && "opacity-50",
        )}
        onDragStart={(e) => {
          // Use a distinct prefix so tab and group payloads can share
          // the same MIME type without being confused downstream.
          e.dataTransfer.setData('text/plain', `group:${group.id}`);
          e.dataTransfer.effectAllowed = 'move';
          setDraggedGroupId(group.id);
          // Close the dropdown if Radix just opened it on pointerdown —
          // otherwise it'd sit over the tab bar and eat drop events.
          setOpenDropdownGroupId(null);
        }}
        onDragEnd={() => {
          setDraggedGroupId(null);
          setDragOverGroupId(null);
          setDragOverGroupZone(null);
        }}
        onDragOver={(e) => handleGroupDragOver(e, group.id)}
        onDragLeave={handleGroupDragLeave}
        onDrop={(e) => handleGroupDrop(e, group.id)}
      >
        {/* Reorder-position indicators for group-on-group drag. */}
        {isGroupDragOver && dragOverGroupZone === 'before' && (
          <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary" aria-hidden />
        )}
        {isGroupDragOver && dragOverGroupZone === 'after' && (
          <span className="absolute right-0 top-0 bottom-0 w-0.5 bg-primary" aria-hidden />
        )}
        {/* Chip button — plain <button>, not a Radix trigger. Opens the
            popover on CLICK (pointerup without movement) so the browser's
            HTML5 drag heuristic can initiate dragstart on any pointerdown
            that moves past the drag threshold. This is the same pattern
            Chrome/VSCode/Arc use for draggable tabs. */}
        <Button
          variant="ghost"
          size="sm"
          className="h-full px-2 gap-1.5 hover:bg-muted"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', `group:${group.id}`);
            e.dataTransfer.effectAllowed = 'move';
            setDraggedGroupId(group.id);
            setOpenDropdownGroupId(null);
          }}
          onDragEnd={() => {
            setDraggedGroupId(null);
            setDragOverGroupId(null);
            setDragOverGroupZone(null);
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (isOpen) {
              setOpenDropdownGroupId(null);
              setPopoverAnchorRect(null);
              return;
            }
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setOpenDropdownGroupId(group.id);
            setPopoverAnchorRect({ top: rect.bottom + 4, left: rect.left });
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpenDropdownGroupId(null);
            handleGroupDoubleClick(group.id, group.name);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          aria-expanded={isOpen}
          aria-haspopup="menu"
        >
          <span className="text-sm font-medium truncate max-w-24">{group.name}</span>
          <span className="text-xs text-muted-foreground font-medium">({tabs.length})</span>
        </Button>
        {/* Custom popover. Portaled to document.body so it escapes the
            tab strip's overflow-y-hidden clip. Position is captured at
            click time from the chip's bounding rect. */}
        {isOpen && popoverAnchorRect && createPortal(
          <div
            role="menu"
            style={{
              position: 'fixed',
              top: popoverAnchorRect.top,
              left: popoverAnchorRect.left,
              zIndex: 50,
            }}
            className="min-w-[200px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            onDragLeave={(e) => {
              const next = e.relatedTarget as Node | null;
              if (!next || !e.currentTarget.contains(next)) {
                setOpenDropdownGroupId(null);
                setDragOverDropdownIndex(null);
                setDropdownDropPosition(null);
                setPopoverAnchorRect(null);
              }
            }}
          >
            {/* List of tabs in group */}
            {tabs.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  {t('editor.tab-bar.files-in-group')}
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
                        // Keep the dropdown OPEN during drag so the user
                        // can drop onto another row to reorder within the
                        // group. Closing it here (the old behavior) killed
                        // the drop target and made reorder impossible.
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
                          onBlur={() => void handleTabRenameSubmit()}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            // Stop arrow keys from triggering Radix typeahead.
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                              void handleTabRenameSubmit();
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
                        <span className="text-amber-700 font-bold" title="Unsaved changes">
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
                <div className="-mx-1 my-1 h-px bg-muted" role="separator" />
              </>
            )}
            {/* Destructive action — Rename now lives at the top of the menu. */}
            <button
              type="button"
              role="menuitem"
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors text-destructive hover:bg-accent hover:text-destructive focus:bg-accent focus:text-destructive"
              onClick={() => {
                setOpenDropdownGroupId(null);
                void handleGroupDelete(group.id);
              }}
            >
              Delete Group
            </button>
          </div>,
          document.body,
        )}
      </div>
    );
  };

  // Walk openTabs in order. Render a group chip at the FIRST appearance of
  // each group's tabs; skip subsequent tabs of the same group (they live
  // inside the chip's dropdown). Ungrouped tabs render in their current
  // openTabs position. This interleaves groups with ungrouped tabs so the
  // bar reflects one flat ordered sequence that drag-and-drop can reorder.
  const renderItems: Array<{ type: 'tab' | 'group'; data: typeof openTabs[0] | typeof tabGroups[0] }> = [];
  const seenGroups = new Set<string>();
  openTabs.forEach((tab) => {
    if (tab.groupId) {
      if (!seenGroups.has(tab.groupId)) {
        const group = tabGroups.find((g) => g.id === tab.groupId);
        if (group) {
          renderItems.push({ type: 'group', data: group });
          seenGroups.add(tab.groupId);
        }
      }
    } else {
      renderItems.push({ type: 'tab', data: tab });
    }
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
                        <span className="text-amber-700 font-bold ml-auto" title="Unsaved changes">
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

      {/* Tab right-click context menu — portaled, closes on outside click. */}
      {tabContextMenu && createPortal(
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setTabContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setTabContextMenu(null);
            }}
          />
          <div
            role="menu"
            style={{ position: 'fixed', top: tabContextMenu.y, left: tabContextMenu.x, zIndex: 50 }}
            className="min-w-[160px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md text-sm"
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-sm px-2 py-1.5 outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                const tab = openTabs.find((t) => t.path === tabContextMenu.path);
                if (tab) handleTabDoubleClick(tab);
                setTabContextMenu(null);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-sm px-2 py-1.5 outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                closeTab(tabContextMenu.path);
                setTabContextMenu(null);
              }}
            >
              Close tab
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-sm px-2 py-1.5 outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                openTabs
                  .filter((t) => t.path !== tabContextMenu.path)
                  .forEach((t) => closeTab(t.path));
                setTabContextMenu(null);
              }}
            >
              {t('editor.tab-bar.close-other-tabs')}
            </button>
          </div>
        </>,
        document.body,
      )}

      {/* Rename / Name Group Dialog */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{isNewGroupDialog ? 'Name your group' : 'Rename Tab Group'}</DialogTitle>
            <DialogDescription>
              {isNewGroupDialog
                ? 'Give this new tab group a name.'
                : 'Enter a new name for the tab group.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="group-name" className="text-right">
                Name
              </Label>
              <Input
                ref={renameGroupInputRef}
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
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleGroupRenameCancel}>
              Cancel
            </Button>
            <Button onClick={handleGroupRenameSubmit}>
              {isNewGroupDialog ? 'Create' : 'Rename'}
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
