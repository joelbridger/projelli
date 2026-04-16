// Sidebar Component
// Contains file tree, workflow panel, research, whiteboard, and other tools
// Settings have been moved to the AI Assistant pane on the right

import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatShortcutHint, getShortcut } from '@/utils/shortcuts';
import {
  FolderTree,
  Workflow,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  History,
  Trash2,
  PenTool,
  Search,
  Bot,
  LayoutGrid,
} from 'lucide-react';

interface SidebarProps {
  fileTreeContent?: React.ReactNode;
  searchContent?: React.ReactNode;
  workflowContent?: React.ReactNode;
  aiAssistantContent?: React.ReactNode;
  researchContent?: React.ReactNode;
  auditContent?: React.ReactNode;
  trashContent?: React.ReactNode;
  whiteboardContent?: React.ReactNode;
  activeTab?: SidebarTab; // Controlled active tab
  onTabChange?: (tab: SidebarTab) => void; // Tab change callback
  /** Opens the Grid View tab in the main panel. Shown as an icon button in
   *  the Files section header. */
  onOpenGridView?: () => void;
  className?: string;
}

type SidebarTab = 'files' | 'search' | 'workflows' | 'ai-assistant' | 'research' | 'whiteboard' | 'audit' | 'trash';

export function Sidebar({
  fileTreeContent,
  searchContent,
  workflowContent,
  aiAssistantContent,
  researchContent,
  auditContent,
  trashContent,
  whiteboardContent,
  activeTab: controlledActiveTab,
  onTabChange,
  onOpenGridView,
  className,
}: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [internalActiveTab, setInternalActiveTab] = useState<SidebarTab>('files');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Use controlled tab if provided, otherwise use internal state
  const activeTab = controlledActiveTab !== undefined ? controlledActiveTab : internalActiveTab;
  const setActiveTab = onTabChange || setInternalActiveTab;

  // UX-11: Icons are defined as Lucide components, not JSX, so we can apply
  // the monochrome inactive / accent active pattern uniformly. Previously the
  // icons were pre-baked as JSX, which meant any stray `className` on one of
  // them would stick (e.g. a `text-orange-*` leftover from a copy-paste).
  // Now every tab icon inherits the same `currentColor` stroke from the
  // Button's `text-muted-foreground` (inactive) or `text-foreground` (active)
  // class, so no tab can look permanently tinted relative to the others.
  // UX-23: `shortcutId` maps a tab to an entry in the SHORTCUTS SSOT so the
  // collapsed-sidebar tooltip can surface the keyboard shortcut. Tabs without
  // a canonical shortcut show just the label.
  const tabs: {
    id: SidebarTab;
    Icon: typeof FolderTree;
    label: string;
    shortcutId?: string;
  }[] = [
    { id: 'files', Icon: FolderTree, label: 'Files' },
    { id: 'search', Icon: Search, label: 'Search' },
    { id: 'workflows', Icon: Workflow, label: 'Workflows' },
    { id: 'ai-assistant', Icon: Bot, label: 'AI Assistant', shortcutId: 'ai-assistant' },
    { id: 'research', Icon: BookOpen, label: 'Research' },
    { id: 'whiteboard', Icon: PenTool, label: 'Whiteboard' },
    { id: 'audit', Icon: History, label: 'AI Audit' },
    { id: 'trash', Icon: Trash2, label: 'Trash' },
  ];

  const focusTabByIndex = (index: number) => {
    const wrapped = (index + tabs.length) % tabs.length;
    const tab = tabs[wrapped];
    if (!tab) return;
    const button = tabRefs.current[tab.id];
    button?.focus();
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        focusTabByIndex(currentIndex + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        focusTabByIndex(currentIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusTabByIndex(0);
        break;
      case 'End':
        event.preventDefault();
        focusTabByIndex(tabs.length - 1);
        break;
    }
  };

  const panelId = (id: SidebarTab) => `sidebar-panel-${id}`;
  const tabId = (id: SidebarTab) => `sidebar-tab-${id}`;

  return (
    <div
      data-testid="sidebar"
      className={cn(
        'flex flex-col border-r bg-card transition-all duration-200',
        isCollapsed ? 'w-12' : 'w-64',
        className
      )}
    >
      {/* Tab header with collapse button */}
      <div className="flex items-center justify-between border-b px-2 py-1">
        {!isCollapsed && (
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Workspace
          </span>
        )}
        <Button
          data-testid="sidebar-collapse-button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 ml-auto"
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Tab navigation — ARIA tablist with arrow-key navigation */}
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label="Sidebar sections"
        className={cn(
          'flex flex-col border-b',
          isCollapsed ? 'items-center py-1' : 'py-1'
        )}
      >
        {tabs.map((tab, index) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.Icon;
          // UX-23: derive tooltip text from the label + optional shortcut.
          // Shown only when collapsed so the label isn't redundant with the
          // inline text. Keyboard users still see it via focus.
          const shortcut = tab.shortcutId ? getShortcut(tab.shortcutId) : undefined;
          const tooltipLabel = shortcut
            ? `${tab.label} (${formatShortcutHint(shortcut.keys)})`
            : tab.label;

          const button = (
            <Button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              id={tabId(tab.id)}
              data-testid={`sidebar-tab-${tab.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={panelId(tab.id)}
              tabIndex={isActive ? 0 : -1}
              variant={isActive ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                'justify-start h-8 rounded-none',
                isCollapsed ? 'w-10 px-0 justify-center' : 'w-full px-3',
                // UX-11: force inactive tabs to muted foreground so any leftover
                // color on a specific icon (e.g. a PenTool whiteboard accent)
                // can't stick. Active tab gets `text-foreground` from the
                // `secondary` Button variant.
                !isActive && 'text-muted-foreground'
              )}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
              // Keep `title` as a last-resort a11y fallback on non-collapsed
              // mode and for browsers that can't style a Radix tooltip (Radix
              // tooltip itself owns the visible one when collapsed).
              title={!isCollapsed ? tooltipLabel : undefined}
              aria-label={tooltipLabel}
            >
              <Icon
                data-testid={`sidebar-tab-${tab.id}-icon`}
                aria-hidden="true"
                className="h-4 w-4"
              />
              {!isCollapsed && <span className="ml-2 text-sm">{tab.label}</span>}
            </Button>
          );

          // When collapsed, wrap in a Radix tooltip. When expanded, the label
          // is visible inline so the tooltip would be noisy — skip it.
          if (isCollapsed) {
            return (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent
                  side="right"
                  data-testid={`sidebar-tab-${tab.id}-tooltip`}
                >
                  {tooltipLabel}
                </TooltipContent>
              </Tooltip>
            );
          }
          return button;
        })}
      </div>

      {/* Content area — the active panel. Inactive panels are unmounted to keep
          existing conditional-rendering behaviour, but we still render the
          container with tabpanel semantics for screen readers. */}
      {!isCollapsed && (
        <div
          data-testid="sidebar-content"
          role="tabpanel"
          id={panelId(activeTab)}
          aria-labelledby={tabId(activeTab)}
          tabIndex={0}
          className="flex-1 overflow-hidden focus:outline-none"
        >
          {activeTab === 'files' && (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Files section header with Grid View toggle */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b">
                <span className="text-xs font-semibold text-foreground">Files</span>
                {onOpenGridView && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={onOpenGridView}
                    title="Grid view"
                    data-testid="grid-view-button"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <div className="flex-1 overflow-hidden">
                {fileTreeContent}
              </div>
            </div>
          )}
          {activeTab === 'search' && searchContent}
          {activeTab === 'workflows' && workflowContent}
          {activeTab === 'ai-assistant' && aiAssistantContent}
          {activeTab === 'research' && researchContent}
          {activeTab === 'whiteboard' && whiteboardContent}
          {activeTab === 'audit' && auditContent}
          {activeTab === 'trash' && trashContent}
        </div>
      )}
    </div>
  );
}

export default Sidebar;
