import {
  BookOpen,
  File,
  Folder,
  History,
  Layout,
  Play,
  Search,
  Settings,
} from 'lucide-react';
import type { PaletteCommand } from '@/app/commands/registry/types';

/** Compatibility adapter for callers outside useAppCommands. */
export function getDefaultCommands(handlers: {
  onNewFile?: () => void;
  onOpenFile?: () => void;
  onSaveFile?: () => void;
  onToggleSidebar?: () => void;
  onOpenSettings?: () => void;
  onOpenWorkflows?: () => void;
  onOpenResearch?: () => void;
  onOpenAuditLog?: () => void;
  onSearch?: () => void;
}): PaletteCommand[] {
  const commands: PaletteCommand[] = [];
  const add = (
    handler: (() => void) | undefined,
    command: Omit<PaletteCommand, 'action'>
  ) => {
    if (handler) commands.push({ ...command, action: handler });
  };

  add(handlers.onNewFile, {
    id: 'new-file',
    label: 'New File',
    description: 'Create a new file',
    icon: <File className="h-4 w-4" />,
    category: 'File',
    keywords: ['create', 'add'],
  });
  add(handlers.onOpenFile, {
    id: 'open-file',
    label: 'Open File',
    description: 'Open an existing file',
    icon: <Folder className="h-4 w-4" />,
    category: 'File',
    keywords: ['browse', 'find'],
  });
  add(handlers.onSaveFile, {
    id: 'save-file',
    label: 'Save File',
    description: 'Save the current file',
    icon: <File className="h-4 w-4" />,
    category: 'File',
  });
  add(handlers.onToggleSidebar, {
    id: 'toggle-sidebar',
    label: 'Toggle Sidebar',
    description: 'Show or hide the sidebar',
    icon: <Layout className="h-4 w-4" />,
    category: 'View',
  });
  add(handlers.onOpenSettings, {
    id: 'open-settings',
    label: 'Open Settings',
    description: 'Configure application settings',
    icon: <Settings className="h-4 w-4" />,
    category: 'General',
    keywords: ['preferences', 'config'],
  });
  add(handlers.onOpenWorkflows, {
    id: 'open-workflows',
    label: 'Open Workflows',
    description: 'View and run workflows',
    icon: <Play className="h-4 w-4" />,
    category: 'Workflows',
    keywords: ['run', 'execute', 'generate'],
  });
  add(handlers.onOpenResearch, {
    id: 'open-research',
    label: 'Open Research',
    description: 'Manage sources and citations',
    icon: <BookOpen className="h-4 w-4" />,
    category: 'Research',
    keywords: ['sources', 'citations', 'references'],
  });
  add(handlers.onOpenAuditLog, {
    id: 'open-audit-log',
    label: 'Open Audit Log',
    description: 'View AI action history',
    icon: <History className="h-4 w-4" />,
    category: 'General',
    keywords: ['history', 'log', 'actions'],
  });
  add(handlers.onSearch, {
    id: 'search',
    label: 'Search',
    description: 'Search in workspace',
    icon: <Search className="h-4 w-4" />,
    category: 'Search',
    keywords: ['find', 'query'],
  });

  return commands;
}
