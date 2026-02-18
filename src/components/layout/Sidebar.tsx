// Sidebar Component
// Contains file tree, workflow panel, research, whiteboard, and other tools
// Settings have been moved to the AI Assistant pane on the right

import { useState } from 'react';
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

  // Use controlled tab if provided, otherwise use internal state
  const activeTab = controlledActiveTab !== undefined ? controlledActiveTab : internalActiveTab;
  const setActiveTab = onTabChange || setInternalActiveTab;

  const tabs: { id: SidebarTab; icon: React.ReactNode; label: string }[] = [
    { id: 'files', icon: <FolderTree className="h-4 w-4" />, label: 'Files' },
    { id: 'search', icon: <Search className="h-4 w-4" />, label: 'Search' },
    { id: 'workflows', icon: <Workflow className="h-4 w-4" />, label: 'Workflows' },
    { id: 'ai-assistant', icon: <Bot className="h-4 w-4" />, label: 'AI Assistant' },
    { id: 'research', icon: <BookOpen className="h-4 w-4" />, label: 'Research' },
    { id: 'whiteboard', icon: <PenTool className="h-4 w-4" />, label: 'Whiteboard' },
    { id: 'audit', icon: <History className="h-4 w-4" />, label: 'AI Audit' },
    { id: 'trash', icon: <Trash2 className="h-4 w-4" />, label: 'Trash' },
  ];

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

      {/* Tab navigation - clean vertical list */}
      <div className={cn(
        'flex flex-col border-b',
        isCollapsed ? 'items-center py-1' : 'py-1'
      )}>
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            data-testid={`sidebar-tab-${tab.id}`}
            variant={activeTab === tab.id ? 'secondary' : 'ghost'}
            size="sm"
            className={cn(
              'justify-start h-8 rounded-none',
              isCollapsed ? 'w-10 px-0 justify-center' : 'w-full px-3'
            )}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
          >
            {tab.icon}
            {!isCollapsed && <span className="ml-2 text-sm">{tab.label}</span>}
          </Button>
        ))}
      </div>

      {/* Content area */}
      {!isCollapsed && (
        <div data-testid="sidebar-content" className="flex-1 overflow-hidden">
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
