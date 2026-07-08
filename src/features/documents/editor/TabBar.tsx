// Tab Bar Component
// Displays open file tabs with close buttons, dirty indicators, drag-to-reorder, and tab groups

import { Fragment, useCallback, useState, useRef, useEffect, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { X, GripVertical, MoreVertical, Settings, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/ui/button';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { isDocxUnsaved, subscribeDocxSaveRegistry, getDocxSaveVersion, closeDocxTabSafely } from '@/platform/fs/docxSaveRegistry';
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
import { FileAsMeetingDialog } from '@/features/meetings/FileAsMeetingDialog';

const VOICE_NOTE_PATH_RE = /^Inbox\/note-.*\.md$/;

type EditorTab = ReturnType<typeof useEditorStore.getState>['openTabs'][number];

const TAB_STRIP_HEIGHT = 'var(--kp-tab-strip-height)';

interface LeadingTabConfig {
  id: string;
  label: string;
  icon?: ReactNode;
  actions?: ReactNode;
  isActive: boolean;
  testId?: string;
  aliasTestIds?: string[];
  onActivate: () => void;
}

interface TabBarProps {
  orientation?: 'horizontal' | 'vertical';
  onRenameFile?: (path: string, newName: string) => Promise<void>;
  leadingTab?: LeadingTabConfig;
  leadingTabs?: LeadingTabConfig[];
  tabFilter?: (tab: EditorTab) => boolean;
  selectedTabPath?: string | null;
  onActivateTab?: (path: string) => void;
  rootTestId?: string;
  ariaLabel?: string;
  getTabTestId?: (path: string) => string;
  showBorder?: boolean;
  showGroupManagerButton?: boolean;
}

// Drop a group payload on another group chip. Zone decides merge vs. reorder:
//  leading 35 %  -> reorder 'before'
//  trailing 35 % -> reorder 'after'
//  middle 30 % -> merge
function computeGroupDropZone(
  e: React.DragEvent,
  orientation: 'horizontal' | 'vertical',
): 'merge' | 'before' | 'after' {
  const target = e.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const size = orientation === 'vertical' ? rect.height : rect.width;
  if (size <= 0) return 'merge';
  const offset = orientation === 'vertical' ? e.clientY - rect.top : e.clientX - rect.left;
  const leadingCut = size * 0.35;
  const trailingCut = size * 0.65;
  if (offset < leadingCut) return 'before';
  if (offset > trailingCut) return 'after';
  return 'merge';
}

function computeTabDropZone(
  e: React.DragEvent,
  orientation: 'horizontal' | 'vertical',
): 'before' | 'combine' | 'after' {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const size = orientation === 'vertical' ? rect.height : rect.width;
  if (size <= 0) return 'combine';
  const offset = orientation === 'vertical' ? e.clientY - rect.top : e.clientX - rect.left;
  if (offset < size * 0.35) return 'before';
  if (offset > size * 0.65) return 'after';
  return 'combine';
}

export function TabBar({
  orientation = 'horizontal',
  onRenameFile,
  leadingTab,
  leadingTabs,
  tabFilter,
  selectedTabPath,
  onActivateTab,
  rootTestId = 'tab-bar-root',
  ariaLabel = 'Open document tabs',
  getTabTestId,
  showBorder = true,
  showGroupManagerButton = true,
}: TabBarProps = {}) {
  const { t } = useTranslation();
  const isVertical = orientation === 'vertical';
  // QA-34: re-render the tab strip when any .docx's save state changes, so a
  // tab's unsaved dot reflects a .docx whose save is pending/failing (its store
  // tab is never marked dirty). `useSyncExternalStore` keeps this in step with
  // the registry without a store round-trip.
  useSyncExternalStore(subscribeDocxSaveRegistry, getDocxSaveVersion, getDocxSaveVersion);
  // A tab shows the unsaved dot if the store says it's dirty OR (for a .docx) the
  // save registry says there is unsaved/failing work.
  const tabHasUnsavedWork = useCallback(
    (tab: { path: string; isDirty: boolean }) => tab.isDirty || isDocxUnsaved(tab.path),
    [],
  );
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
    toggleGroupCollapsed,
    moveTabToGroup,
    ungroupTab,
    mergeTabGroups,
    reorderInTabBar,
    pendingRenamePath,
    setPendingRenamePath,
    pendingGroupRenameId,
    setPendingGroupRenameId,
  } = useEditorStore(useShallow((s) => ({
    openTabs: s.openTabs,
    activeTabPath: s.activeTabPath,
    tabGroups: s.tabGroups,
    setActiveTab: s.setActiveTab,
    closeTab: s.closeTab,
    reorderTabs: s.reorderTabs,
    createTabGroup: s.createTabGroup,
    renameTabGroup: s.renameTabGroup,
    deleteTabGroup: s.deleteTabGroup,
    toggleGroupCollapsed: s.toggleGroupCollapsed,
    moveTabToGroup: s.moveTabToGroup,
    ungroupTab: s.ungroupTab,
    mergeTabGroups: s.mergeTabGroups,
    reorderInTabBar: s.reorderInTabBar,
    pendingRenamePath: s.pendingRenamePath,
    setPendingRenamePath: s.setPendingRenamePath,
    pendingGroupRenameId: s.pendingGroupRenameId,
    setPendingGroupRenameId: s.setPendingGroupRenameId,
  })));

  const displayedTabs = useMemo(
    () => (tabFilter ? openTabs.filter(tabFilter) : openTabs),
    [openTabs, tabFilter],
  );
  const leadingTabItems = useMemo(
    () => leadingTabs ?? (leadingTab ? [leadingTab] : []),
    [leadingTab, leadingTabs],
  );
  const effectiveActiveTabPath =
    selectedTabPath === undefined ? activeTabPath : selectedTabPath;
  const activateTab = useCallback(
    (path: string) => {
      if (onActivateTab) {
        onActivateTab(path);
        return;
      }
      setActiveTab(path);
    },
    [onActivateTab, setActiveTab],
  );

  // Tab overflow mode: canonical source is settingsStore, whose schema default
  // keeps existing users on horizontal scroll until they change it.
  const tabOverflow = useSettingsStore((s) =>
    s.getSetting<'scroll' | 'wrap'>('tabOverflow')
  );

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
  // Task 10b: a dictation voice note ("Inbox/note-<timestamp>.md") can be
  // filed as a meeting note via a client picker.
  const [fileAsMeetingPath, setFileAsMeetingPath] = useState<string | null>(null);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot store flag opens inline rename after the new tab exists.
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot store flag opens the rename dialog for the newly created group.
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
  const [now, setNow] = useState(0);

  // Confirmation dialog
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const reportAsyncError = useCallback((context: string, error: unknown) => {
    console.error(`[TabBar] ${context} failed:`, error);
  }, []);
  const clearDragState = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
    setDragOverGroupId(null);
    setDragOverGroupZone(null);
    setDraggedGroupId(null);
    setDragOverTabBar(false);
    setDragIntent(null);
    setDropPosition(null);
    setDragOverDropdownIndex(null);
    setDropdownDropPosition(null);
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  // Track whether the tab strip can scroll left / right so the arrow buttons
  // only render when there's something to scroll to. Runs on mount, on tab
  // count change, on window resize, and on the strip's own scroll event.
  const updateScrollButtons = useCallback(() => {
    if (isVertical) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
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
  }, [isVertical]);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- scroll arrow visibility must be measured before paint to avoid flicker.
    updateScrollButtons();
  }, [updateScrollButtons, displayedTabs.length, tabGroups.length, leadingTabItems]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => updateScrollButtons();
    el.addEventListener('scroll', onScroll, { passive: true });

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => updateScrollButtons())
        : null;
    ro?.observe(el);

    window.addEventListener('resize', onScroll);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      ro?.disconnect();
    };
  }, [updateScrollButtons]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const displayedTabLayoutKey = useMemo(
    () => displayedTabs.map((tab) => `${tab.path}:${tab.groupId ?? ''}`).join('|'),
    [displayedTabs],
  );
  const activeTabGroupId = useMemo(
    () => displayedTabs.find((tab) => tab.path === effectiveActiveTabPath)?.groupId ?? null,
    [displayedTabs, effectiveActiveTabPath],
  );

  // When the active tab changes (e.g. user clicked the overflow list or
  // opened a new file), scroll it into view so users don't have to hunt for
  // it in the strip.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !effectiveActiveTabPath) return;
    let child = Array.from(el.querySelectorAll<HTMLElement>('[data-tab-path]')).find(
      (node) => node.dataset['tabPath'] === effectiveActiveTabPath,
    ) ?? null;
    if (!child && activeTabGroupId) {
      child = el.querySelector<HTMLElement>(`[data-group-id="${activeTabGroupId}"]`);
    }
    if (!child) return;
    // scrollIntoView with inline:'nearest' avoids jumpy behavior when the
    // active tab is already visible.
    child.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    const id = requestAnimationFrame(updateScrollButtons);
    return () => {
      cancelAnimationFrame(id);
    };
  }, [effectiveActiveTabPath, activeTabGroupId, displayedTabLayoutKey, updateScrollButtons]);

  const handleTabClick = useCallback((path: string) => {
    activateTab(path);
  }, [activateTab]);

  const closeTabSafely = useCallback(
    async (path: string) => {
      const tab = openTabs.find((t) => t.path === path);

      // QA-34: a .docx saves directly (never a store-dirty tab) and its edits live
      // only in its still-mounted editor. Route it through the airtight close: save
      // first, and only ask to discard if the save actually fails — so a locked
      // file can never silently lose the in-memory doc on close.
      if (
        await closeDocxTabSafely(path, {
          closeTab,
          confirmDiscardOnFailure: () =>
            confirm(
              tab
                ? `I couldn't save "${tab.name}" — another program may be blocking the file. Close anyway and lose your latest changes?`
                : `I couldn't save this document — another program may be blocking the file. Close anyway and lose your latest changes?`,
              {
                title: 'Unsaved Changes',
                variant: 'destructive',
                confirmLabel: 'Close and lose changes',
                cancelLabel: 'Keep Open',
              },
            ),
        })
      ) {
        return;
      }

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
        // The user explicitly chose "Close Without Saving" → discard: don't let
        // the before-close flush write the rejected edits back (BUG-046 Codex fix).
        closeTab(path, { discard: true });
        return;
      }

      closeTab(path);
    },
    [openTabs, closeTab, confirm]
  );

  const runCloseTabSafely = useCallback(
    (path: string) => {
      closeTabSafely(path).catch((error: unknown) => {
        reportAsyncError('close tab', error);
      });
    },
    [closeTabSafely, reportAsyncError],
  );

  const handleTabClose = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      runCloseTabSafely(path);
    },
    [runCloseTabSafely],
  );

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent, path: string) => {
      if (e.button === 1) {
        handleTabClose(e, path);
      }
    },
    [handleTabClose]
  );

  const closeTabsSequentially = useCallback(
    async (tabs: Array<{ path: string }>) => {
      for (const tab of tabs) {
        await closeTabSafely(tab.path);
      }
    },
    [closeTabSafely],
  );

  const runCloseTabsSequentially = useCallback(
    (tabs: Array<{ path: string }>) => {
      closeTabsSequentially(tabs).catch((error: unknown) => {
        reportAsyncError('close tabs', error);
      });
    },
    [closeTabsSequentially, reportAsyncError],
  );

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());

    // Set custom drag image with reduced opacity to minimize visual flashing
    if (e.currentTarget instanceof HTMLElement) {
      const dragImage = e.currentTarget.cloneNode(true) as HTMLElement;
      dragImage.removeAttribute('data-testid');
      dragImage.removeAttribute('role');
      dragImage.setAttribute('aria-hidden', 'true');
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
    clearDragState();
  }, [clearDragState]);

  // R3-P1 unified model: on any tab drop target the drop zone splits
  // into left 30% (reorder before), right 30% (after), middle 40%
  // (combine — create/join/merge depending on source+target type). The
  // same math runs on group chips via handleGroupDragOver.
  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const zone = computeTabDropZone(e, orientation);
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
  }, [dragOverIndex, dragIntent, dropPosition, orientation]);

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

    const zone = computeTabDropZone(e, orientation);
    const payload = e.dataTransfer.getData('text/plain');
    const targetTab = openTabs[toIndex];
    if (!targetTab) {
      clearDragState();
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
          reorderInTabBar(
            { type: 'group', id: sourceGroupId },
            { type: 'tab', id: targetTab.path },
            position,
          );
        }
      }
      clearDragState();
      return;
    }

    // ──── Tab payload ─────────────────────────────────────────────
    const fromIndex = parseInt(payload, 10);
    if (isNaN(fromIndex) || fromIndex === toIndex) {
      clearDragState();
      return;
    }
    const draggedTab = openTabs[fromIndex];
    if (!draggedTab) {
      clearDragState();
      return;
    }

    if (zone === 'combine') {
      // Tab dropped on center of another tab:
      //   both ungrouped  → new group with both
      //   target grouped  → join target's group (dragged leaves its own)
      //   dragged grouped, target ungrouped → new group pairing both
      if (!draggedTab.groupId && !targetTab.groupId) {
        const newId = createTabGroup(nextGroupName(), [draggedTab.path, targetTab.path]);
        setPendingGroupRenameId(newId);
      } else if (targetTab.groupId) {
        moveTabToGroup(draggedTab.path, targetTab.groupId);
      } else if (draggedTab.groupId && !targetTab.groupId) {
        const newId = createTabGroup(nextGroupName(), [draggedTab.path, targetTab.path]);
        setPendingGroupRenameId(newId);
      }
    } else {
      // Tab dropped on edge of another tab → reorder. If the target is inside
      // a group, adopt that group so this supports moving between groups.
      // If the target is ungrouped, the dragged tab comes out of its group.
      if (targetTab.groupId && draggedTab.groupId !== targetTab.groupId) {
        moveTabToGroup(draggedTab.path, targetTab.groupId);
      } else if (!targetTab.groupId && draggedTab.groupId) {
        ungroupTab(draggedTab.path);
      }
      reorderInTabBar(
        { type: 'tab', id: draggedTab.path },
        { type: 'tab', id: targetTab.path },
        zone === 'before' ? 'before' : 'after',
      );
    }

    clearDragState();
  }, [
    openTabs,
    moveTabToGroup,
    createTabGroup,
    nextGroupName,
    ungroupTab,
    orientation,
    reorderInTabBar,
    setPendingGroupRenameId,
    clearDragState,
  ]);


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

  const runGroupDelete = useCallback(
    (groupId: string) => {
      handleGroupDelete(groupId).catch((error: unknown) => {
        reportAsyncError('delete group', error);
      });
    },
    [handleGroupDelete, reportAsyncError],
  );

  const handleGroupDragOver = useCallback((e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverGroupId(groupId);
    // Zone is only meaningful when dragging a group payload. For tab
    // payloads we just use the whole-chip tint (moves tab to group).
    if (draggedGroupId && draggedGroupId !== groupId) {
      setDragOverGroupZone(computeGroupDropZone(e, orientation));
    } else {
      setDragOverGroupZone(null);
    }
  }, [draggedGroupId, orientation]);

  const handleGroupDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setDragOverGroupId(null);
    setDragOverGroupZone(null);
  }, []);

  const handleGroupDrop = useCallback((e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const payload = e.dataTransfer.getData('text/plain');
    // Group payload takes the form "group:<sourceId>"; tab payload is a
    // numeric index as a string. Branch on prefix so the two can share
    // the same drop target without confusion.
    if (payload.startsWith('group:')) {
      const sourceId = payload.slice('group:'.length);
      if (!sourceId || sourceId === groupId) {
        clearDragState();
        return;
      }
      const zone = computeGroupDropZone(e, orientation);
      if (zone === 'before' || zone === 'after') {
        reorderInTabBar(
          { type: 'group', id: sourceId },
          { type: 'group', id: groupId },
          zone,
        );
      } else {
        mergeTabGroups(sourceId, groupId);
      }
      clearDragState();
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
    clearDragState();
  }, [
    openTabs,
    moveTabToGroup,
    orientation,
    reorderInTabBar,
    mergeTabGroups,
    clearDragState,
  ]);

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

  const runTabRenameSubmit = useCallback(() => {
    handleTabRenameSubmit().catch((error: unknown) => {
      reportAsyncError('rename tab', error);
    });
  }, [handleTabRenameSubmit, reportAsyncError]);

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

    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!isNaN(fromIndex)) {
      const draggedTab = openTabs[fromIndex];

      // If tab is in a group, remove it from the group
      if (draggedTab?.groupId) {
        ungroupTab(draggedTab.path);
      }
    }

    clearDragState();
  }, [openTabs, ungroupTab, clearDragState]);

  if (displayedTabs.length === 0 && leadingTabItems.length === 0) {
    return null;
  }

  const renderTab = (
    tab: typeof openTabs[0],
    index: number,
    opts: { insideGroup?: boolean } = {},
  ) => {
    const isActive = tab.path === effectiveActiveTabPath;
    const isDragging = draggedIndex === index;
    const isDragOver = dragOverIndex === index && draggedIndex !== index;
    const showGroupIndicator = isDragOver && dragIntent === 'group';
    const showReorderIndicator = isDragOver && dragIntent === 'reorder';
    const showBefore = showReorderIndicator && dropPosition === 'before';
    const showAfter = showReorderIndicator && dropPosition === 'after';

    return (
      <div
        key={tab.path}
        role="presentation"
        // `group` enables group-hover:* targeting on descendants.
        className={cn(
          'group flex items-center transition-colors relative flex-shrink-0 snap-start',
          isVertical
            ? 'w-full min-w-0 gap-2 rounded-md border border-transparent px-3 py-2 text-left text-[var(--kp-rail-row-title-font-size)]'
            : 'gap-1 px-3 py-1.5 border-r min-w-[120px] max-w-[200px] text-sm',
          isVertical && opts.insideGroup && 'ml-5 w-[calc(100%-1.25rem)]',
          isActive
            ? isVertical
              ? 'bg-[var(--kp-accent-soft)] text-[var(--kp-navy)] border-[rgba(var(--kp-navy-rgb),0.10)]'
              : 'bg-background text-foreground'
            : isVertical
              ? 'text-muted-foreground hover:bg-[var(--kp-accent-softer)]'
              : 'text-muted-foreground hover:bg-muted/50',
          isDragging && 'opacity-50',
          showGroupIndicator && 'bg-primary/20 border-primary',
          showBefore && (isVertical ? 'border-t-2 border-t-primary' : 'border-l-2 border-l-primary'),
          showAfter && (isVertical ? 'border-b-2 border-b-primary' : 'border-r-2 border-r-primary')
        )}
        style={isVertical ? { minHeight: 38 } : { height: TAB_STRIP_HEIGHT }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setTabContextMenu({ path: tab.path, x: e.clientX, y: e.clientY });
        }}
      >
        <button
          type="button"
          data-testid={getTabTestId ? getTabTestId(tab.path) : `tab-${pathToTestId(tab.path)}`}
          data-tab-path={tab.path}
          data-active={isActive ? 'true' : 'false'}
          role="tab"
          tabIndex={0}
          aria-selected={isActive}
          draggable
          onDragStart={(e) => {
            handleDragStart(e, index);
          }}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => {
            handleDragOver(e, index);
          }}
          onDragLeave={handleDragLeave}
          onDrop={(e) => {
            handleDrop(e, index);
          }}
          className={cn(
            'flex h-full min-w-0 flex-1 cursor-pointer items-center bg-transparent p-0 text-left text-inherit outline-none [font:inherit]',
            isVertical ? 'gap-2' : 'gap-1',
          )}
          onClick={() => handleTabClick(tab.path)}
          onMouseDown={(e) => handleMiddleClick(e, tab.path)}
          onFocus={(e) => {
            e.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest' });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleTabClick(tab.path);
            }
          }}
          onDoubleClick={() => handleTabDoubleClick(tab)}
        >
          {getTabIcon(tab)}
          {editingTabPath === tab.path ? (
            <input
              type="text"
              value={editingTabName}
              onChange={(e) => setEditingTabName(e.target.value)}
              onBlur={runTabRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  runTabRenameSubmit();
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
            <span className={cn('truncate min-w-0', isVertical ? 'flex-1' : 'max-w-[140px]')}>
              {removeExtension(tab.name)}
            </span>
          )}
          {tabHasUnsavedWork(tab) && (
            <span className="text-amber-700 font-bold" title="Unsaved changes">
              *
            </span>
          )}
          {!tab.isDirty && tab.lastSaved && now > 0 && now - tab.lastSaved < 3000 && (
            <span className="text-green-600 text-[10px] ml-1 opacity-70" title="Auto-saved">
              ✓
            </span>
          )}
        </button>
        <AIContextChip path={tab.path} />
      </div>
    );
  };

  const renderGroupHeader = (group: typeof tabGroups[0], tabs: typeof openTabs) => {
    const isGroupDragOver = dragOverGroupId === group.id;
    const isOpen = openDropdownGroupId === group.id;
    const isActiveGroup = tabs.some((tab) => tab.path === effectiveActiveTabPath);

    if (isVertical) {
      return (
        <div
          key={`group-${group.id}`}
          data-group-chip
          data-group-id={group.id}
          draggable
          className={cn(
            'relative flex w-full items-center gap-1 rounded-md border border-transparent px-2 py-1.5 text-sm transition-colors',
            isActiveGroup ? 'bg-[var(--kp-accent-softer)] text-[var(--kp-navy)]' : 'text-muted-foreground hover:bg-[var(--kp-accent-softer)]',
            isGroupDragOver && dragOverGroupZone === 'merge' && 'bg-primary/20 border-primary',
            isGroupDragOver && !draggedGroupId && 'bg-primary/20 border-primary',
            draggedGroupId === group.id && 'opacity-50',
          )}
          style={{ minHeight: 36 }}
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
          onDragOver={(e) => {
            handleGroupDragOver(e, group.id);
          }}
          onDragLeave={handleGroupDragLeave}
          onDrop={(e) => {
            handleGroupDrop(e, group.id);
          }}
        >
          {isGroupDragOver && dragOverGroupZone === 'before' && (
            <span className="absolute left-0 right-0 top-0 h-0.5 bg-primary" aria-hidden />
          )}
          {isGroupDragOver && dragOverGroupZone === 'after' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" aria-hidden />
          )}
          <button
            type="button"
            className="inline-flex h-6 w-6 flex-none items-center justify-center rounded hover:bg-background/70"
            aria-label={group.collapsed ? 'Expand group' : 'Collapse group'}
            onClick={(e) => {
              e.stopPropagation();
              toggleGroupCollapsed(group.id);
            }}
          >
            {group.collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left font-semibold"
            onClick={(e) => {
              e.stopPropagation();
              if (tabs[0]) handleTabClick(tabs[0].path);
            }}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleGroupDoubleClick(group.id, group.name);
            }}
          >
            {group.name}
          </button>
          <span className="flex-none text-xs font-medium text-muted-foreground">
            {tabs.length}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 flex-none p-0"
                title="Group actions"
                aria-label="Group actions"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              <DropdownMenuItem
                onClick={() => handleGroupDoubleClick(group.id, group.name)}
              >
                {t('editor.tab-bar.rename-group')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => deleteTabGroup(group.id)}
              >
                {t('editor.tab-bar.ungroup')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  runCloseTabsSequentially(tabs);
                }}
                className="text-destructive focus:text-destructive"
              >
                {t('editor.tab-bar.close-group')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    }

    return (
      <div
        key={`group-${group.id}`}
        data-group-chip
        data-group-id={group.id}
        draggable
        className={cn(
          "relative flex items-center gap-1 px-2 py-1.5 border-r min-w-0 transition-colors flex-shrink-0 snap-start",
          isGroupDragOver && dragOverGroupZone === 'merge' && "bg-primary/20 border-primary",
          // Full-chip highlight when a tab (not a group) is dragged over it.
          isGroupDragOver && !draggedGroupId && "bg-primary/20 border-primary",
          !isGroupDragOver && "bg-muted/30",
          draggedGroupId === group.id && "opacity-50",
        )}
        style={{ height: TAB_STRIP_HEIGHT }}
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
        onDragOver={(e) => {
          handleGroupDragOver(e, group.id);
        }}
        onDragLeave={handleGroupDragLeave}
        onDrop={(e) => {
          handleGroupDrop(e, group.id);
        }}
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
                          onBlur={runTabRenameSubmit}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            // Stop arrow keys from triggering Radix typeahead.
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                              runTabRenameSubmit();
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
                      {tabHasUnsavedWork(tab) && (
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
                            runCloseTabSafely(tab.path);
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
                runGroupDelete(group.id);
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

  const renderLeadingTab = (item: LeadingTabConfig) => {
    return (
      <div
        role="tab"
        tabIndex={0}
        data-testid={item.testId}
        data-leading-tab-id={item.id}
        aria-selected={item.isActive}
        className={cn(
          'relative flex items-center gap-1.5 font-medium transition-colors flex-shrink-0',
          isVertical
            ? 'w-full rounded-md border border-transparent px-3 py-2 text-left text-[var(--kp-rail-row-title-font-size)]'
            : 'px-3 border-r text-sm',
          item.isActive
            ? isVertical
              ? 'bg-[var(--kp-accent-soft)] text-[var(--kp-navy)] border-[rgba(var(--kp-navy-rgb),0.10)]'
              : 'bg-background text-foreground'
            : isVertical
              ? 'text-muted-foreground hover:bg-[var(--kp-accent-softer)]'
              : 'text-muted-foreground hover:bg-muted/50',
        )}
        style={isVertical ? { minHeight: 38 } : { height: TAB_STRIP_HEIGHT }}
        onClick={item.onActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            item.onActivate();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'none';
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {item.aliasTestIds?.map((alias) => (
          <span
            key={alias}
            data-testid={alias}
            aria-hidden="true"
            className="absolute inset-0"
          />
        ))}
        {item.icon}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.actions ? (
          <span
            className="ml-auto flex flex-none items-center"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {item.actions}
          </span>
        ) : null}
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
  displayedTabs.forEach((tab) => {
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
    <div
      className={cn(
        isVertical
          ? 'bg-background min-w-0 h-full'
          : 'bg-muted/30 min-w-0 w-full',
        showBorder && isVertical && 'border-r',
        showBorder && !isVertical && 'border-b',
      )}
      data-testid={rootTestId}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      style={isVertical ? { width: '100%', minHeight: 0 } : { minHeight: TAB_STRIP_HEIGHT }}
    >
      <div
        className={cn(
          isVertical
            ? "flex h-full min-h-0 w-full flex-col gap-1 p-3"
            : "flex items-stretch relative transition-colors min-w-0 w-full",
          dragOverTabBar && "bg-primary/10 ring-2 ring-primary/50 ring-inset"
        )}
        onDragOver={handleTabBarDragOver}
        onDragLeave={handleTabBarDragLeave}
        onDrop={handleTabBarDrop}
      >
        {leadingTabItems.map((item) => (
          <Fragment key={item.id}>{renderLeadingTab(item)}</Fragment>
        ))}

        {/* Left scroll arrow — only visible when scrolled right */}
        {!isVertical && canScrollLeft && (
          <Button
            data-testid="tab-bar-scroll-left"
            variant="ghost"
            size="sm"
            className="px-1.5 border-r flex-shrink-0"
            style={{ height: TAB_STRIP_HEIGHT }}
            onClick={() => {
              scrollTabs('left');
            }}
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
            isVertical
              ? "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]"
              : "flex items-stretch flex-1 min-w-0 max-w-full",
            !isVertical && (
              tabOverflow === 'scroll'
                ? "overflow-x-auto overflow-y-hidden [scrollbar-width:thin] [scroll-snap-type:x_proximity]"
                : "flex-wrap overflow-hidden"
            )
          )}
          onWheel={(e) => {
            if (isVertical) return;
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
              e.preventDefault();
              el.scrollLeft += e.deltaY;
              updateScrollButtons();
            }
          }}
        >
          {renderItems.map((item) => {
            if (item.type === 'group') {
              const group = item.data as typeof tabGroups[0];
              const groupTabs = displayedTabs.filter((tab) => tab.groupId === group.id);
              if (isVertical) {
                return (
                  <div key={group.id} className="flex flex-col gap-1">
                    {renderGroupHeader(group, groupTabs)}
                    {!group.collapsed && groupTabs.map((tab) => renderTab(tab, openTabs.indexOf(tab), { insideGroup: true }))}
                  </div>
                );
              }
              return renderGroupHeader(group, groupTabs);
            } else {
              const tab = item.data as typeof openTabs[0];
              return renderTab(tab, openTabs.indexOf(tab));
            }
          })}
        </div>

        {/* Right scroll arrow — only visible when there's more to the right */}
        {!isVertical && canScrollRight && (
          <Button
            data-testid="tab-bar-scroll-right"
            variant="ghost"
            size="sm"
            className="px-1.5 border-l flex-shrink-0"
            style={{ height: TAB_STRIP_HEIGHT }}
            onClick={() => {
              scrollTabs('right');
            }}
            title="Scroll tabs right"
            aria-label="Scroll tabs right"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}

        {/* Tab Group Manager Button (stays outside scroll, always visible when document tabs exist) */}
        {renderItems.length > 0 && showGroupManagerButton && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              isVertical
                ? 'mt-2 h-8 w-full justify-center border-t px-2 pt-2'
                : 'px-2 border-l flex-shrink-0',
            )}
            style={isVertical ? undefined : { height: TAB_STRIP_HEIGHT }}
            onClick={() => {
              setShowGroupManager(true);
            }}
            title={t('editor.tab-group-manager.title')}
            aria-label={t('editor.tab-group-manager.title')}
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        )}

        {/* All-tabs overflow menu — useful even when tabs fit, as a quick jump
            list. Rendered outside scroll so it's always reachable. */}
        {!isVertical && renderItems.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-testid="tab-bar-overflow"
                variant="ghost"
                size="sm"
                className="px-2 border-l flex-shrink-0"
                style={{ height: TAB_STRIP_HEIGHT }}
                title="All open tabs"
                aria-label="All open tabs"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[300px] overflow-y-auto">
              {renderItems.map((item) => {
                if (item.type === 'tab') {
                  const tab = item.data as typeof openTabs[0];
                  return (
                    <DropdownMenuItem
                      key={tab.path}
                      onClick={() => {
                        handleTabClick(tab.path);
                      }}
                      className="gap-2"
                    >
                      {getTabIcon(tab)}
                      <span className="truncate max-w-[200px]">{removeExtension(tab.name)}</span>
                      {tab.isDirty && (
                        <span className="text-amber-700 font-bold ml-auto" title="Unsaved changes">
                          *
                        </span>
                      )}
                      {!tab.isDirty && tab.lastSaved && now > 0 && now - tab.lastSaved < 3000 && (
                        <span className="text-green-600 text-xs ml-auto opacity-70" title="Auto-saved">
                          ✓
                        </span>
                      )}
                    </DropdownMenuItem>
                  );
                } else {
                  const group = item.data as typeof tabGroups[0];
                  const groupTabs = displayedTabs.filter(t => t.groupId === group.id);
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
        onClose={() => {
          setShowGroupManager(false);
        }}
        {...(onRenameFile ? { onRenameTab: onRenameFile } : {})}
      />

      {/* Tab right-click context menu — portaled, closes on outside click. */}
      {tabContextMenu && createPortal(
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setTabContextMenu(null);
            }}
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
                runCloseTabSafely(tabContextMenu.path);
                setTabContextMenu(null);
              }}
            >
              Close tab
            </button>
            {VOICE_NOTE_PATH_RE.test(tabContextMenu.path) && (
              <button
                type="button"
                role="menuitem"
                data-testid="tab-menu-file-as-meeting"
                className="flex w-full items-center rounded-sm px-2 py-1.5 outline-none hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  setFileAsMeetingPath(tabContextMenu.path);
                  setTabContextMenu(null);
                }}
              >
                {t('meetings.dictation.file-as-meeting-note')}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-sm px-2 py-1.5 outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                runCloseTabsSequentially(displayedTabs.filter((t) => t.path !== tabContextMenu.path));
                setTabContextMenu(null);
              }}
            >
              {t('editor.tab-bar.close-other-tabs')}
            </button>
          </div>
        </>,
        document.body,
      )}

      {fileAsMeetingPath && (
        <FileAsMeetingDialog
          open
          onOpenChange={(open) => { if (!open) setFileAsMeetingPath(null); }}
          noteContent={openTabs.find((tb) => tb.path === fileAsMeetingPath)?.content ?? ''}
          onFiled={() => { setFileAsMeetingPath(null); }}
        />
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
