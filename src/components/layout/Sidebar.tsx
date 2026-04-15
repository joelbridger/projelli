// Sidebar Component
// Contains file tree, workflow panel, research, whiteboard, and other tools
// Settings have been moved to the AI Assistant pane on the right

import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
  const tabs: { id: SidebarTab; Icon: typeof FolderTree; label: string }[] = [
    { id: 'files', Icon: FolderTree, label: 'Files' },
    { id: 'search', Icon: Search, label: 'Search' },
    { id: 'workflows', Icon: Workflow, label: 'Workflows' },
    { id: 'ai-assistant', Icon: Bot, label: 'AI Assistant' },
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
          return (
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
              title={tab.label}
            >
              <Icon
                data-testid={`sidebar-tab-${tab.id}-icon`}
                aria-hidden="true"
                className="h-4 w-4"
              />
              {!isCollapsed && <span className="ml-2 text-sm">{tab.label}</span>}
            </Button>
          );
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
          {activeTab === 'files' && fileTreeContent}
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
