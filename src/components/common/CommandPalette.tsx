// Command Palette Component
// Quick access to all application commands

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Search,
  File,
  Folder,
  Play,
  Settings,
  History,
  BookOpen,
  Layout,
  Moon,
  Command,
  ArrowRight,
} from 'lucide-react';
/**
 * A command that can be executed from the palette
 */
export interface PaletteCommand {
  id: string;
  label: string;
  description?: string | undefined;
  icon?: React.ReactNode | undefined;
  category: string;
  shortcut?: string | undefined; // Simple string like "Ctrl+S"
  action: () => void | Promise<void>;
  keywords?: string[] | undefined;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: PaletteCommand[];
  recentCommands?: string[] | undefined;
  onExecute?: ((commandId: string) => void) | undefined;
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  recentCommands = [],
  onExecute,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      // Focus input after a short delay for dialog to open
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [open]);

  // Filter and sort commands
  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      // Show recent commands first, then all commands
      const recent = recentCommands
        .map((id) => commands.find((c) => c.id === id))
        .filter((c): c is PaletteCommand => c !== undefined);

      const others = commands.filter((c) => !recentCommands.includes(c.id));

      return [...recent, ...others];
    }

    const lowerQuery = query.toLowerCase();
    const words = lowerQuery.split(/\s+/);

    return commands
      .map((command) => {
        // Calculate match score
        let score = 0;

        const label = command.label.toLowerCase();
        const description = (command.description ?? '').toLowerCase();
        const category = command.category.toLowerCase();
        const keywords = command.keywords?.map((k) => k.toLowerCase()) ?? [];

        for (const word of words) {
          // Exact label match
          if (label === word) score += 100;
          // Label starts with word
          else if (label.startsWith(word)) score += 50;
          // Label contains word
          else if (label.includes(word)) score += 30;
          // Category match
          else if (category.includes(word)) score += 20;
          // Description match
          else if (description.includes(word)) score += 10;
          // Keyword match
          else if (keywords.some((k) => k.includes(word))) score += 15;
          // No match for this word
          else score -= 10;
        }

        return { command, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.command);
  }, [commands, query, recentCommands]);

  // Group commands by category
  const groupedCommands = useMemo(() => {
    const groups = new Map<string, PaletteCommand[]>();

    for (const command of filteredCommands) {
      const existing = groups.get(command.category) ?? [];
      existing.push(command);
      groups.set(command.category, existing);
    }

    return groups;
  }, [filteredCommands]);

  // Execute a command
  const executeCommand = useCallback(
    (command: PaletteCommand) => {
      onOpenChange(false);
      command.action();
      onExecute?.(command.id);
    },
    [onOpenChange, onExecute]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex((prev) =>
            Math.min(prev + 1, filteredCommands.length - 1)
          );
          break;
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          event.preventDefault();
          if (filteredCommands[selectedIndex]) {
            executeCommand(filteredCommands[selectedIndex]);
          }
          break;
        case 'Escape':
          event.preventDefault();
          onOpenChange(false);
          break;
      }
    },
    [filteredCommands, selectedIndex, onOpenChange, executeCommand]
  );

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedElement = listRef.current.querySelector(
        `[data-index="${selectedIndex}"]`
      );
      selectedElement?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  let currentIndex = 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 max-w-lg overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="border-0 p-0 h-auto focus-visible:ring-0"
          />
          <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs text-muted-foreground">
            esc
          </kbd>
        </div>

        {/* Command list */}
        <div ref={listRef} className="max-h-[400px] overflow-auto py-2">
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground">
              <Command className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No commands found</p>
            </div>
          ) : (
            Array.from(groupedCommands.entries()).map(([category, categoryCommands]) => (
              <div key={category} className="mb-2 last:mb-0">
                <div className="px-4 py-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase">
                    {category}
                  </span>
                </div>
                {categoryCommands.map((command) => {
                  const index = currentIndex++;
                  const isSelected = index === selectedIndex;

                  return (
                    <button
                      key={command.id}
                      data-index={index}
                      onClick={() => executeCommand(command)}
                      className={cn(
                        'w-full px-4 py-2 flex items-center gap-3 text-left',
                        'hover:bg-muted/50',
                        isSelected && 'bg-muted'
                      )}
                    >
                      {command.icon ?? <ArrowRight className="h-4 w-4 text-muted-foreground" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">{command.label}</div>
                        {command.description && (
                          <div className="text-xs text-muted-foreground truncate">
                            {command.description}
                          </div>
                        )}
                      </div>
                      {command.shortcut && (
                        <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs text-muted-foreground">
                          {command.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Get default commands for the application
 */
export function getDefaultCommands(handlers: {
  onNewFile?: () => void;
  onOpenFile?: () => void;
  onSaveFile?: () => void;
  onToggleSidebar?: () => void;
  onToggleTheme?: () => void;
  onOpenSettings?: () => void;
  onOpenWorkflows?: () => void;
  onOpenResearch?: () => void;
  onOpenAuditLog?: () => void;
  onSearch?: () => void;
}): PaletteCommand[] {
  const commands: PaletteCommand[] = [];

  if (handlers.onNewFile) {
    commands.push({
      id: 'new-file',
      label: 'New File',
      description: 'Create a new file',
      icon: <File className="h-4 w-4" />,
      category: 'File',
      keywords: ['create', 'add'],
      action: handlers.onNewFile,
    });
  }

  if (handlers.onOpenFile) {
    commands.push({
      id: 'open-file',
      label: 'Open File',
      description: 'Open an existing file',
      icon: <Folder className="h-4 w-4" />,
      category: 'File',
      keywords: ['browse', 'find'],
      action: handlers.onOpenFile,
    });
  }

  if (handlers.onSaveFile) {
    commands.push({
      id: 'save-file',
      label: 'Save File',
      description: 'Save the current file',
      icon: <File className="h-4 w-4" />,
      category: 'File',
      action: handlers.onSaveFile,
    });
  }

  if (handlers.onToggleSidebar) {
    commands.push({
      id: 'toggle-sidebar',
      label: 'Toggle Sidebar',
      description: 'Show or hide the sidebar',
      icon: <Layout className="h-4 w-4" />,
      category: 'View',
      action: handlers.onToggleSidebar,
    });
  }

  if (handlers.onToggleTheme) {
    commands.push({
      id: 'toggle-theme',
      label: 'Toggle Theme',
      description: 'Switch between light and dark mode',
      icon: <Moon className="h-4 w-4" />,
      category: 'View',
      keywords: ['dark', 'light', 'mode'],
      action: handlers.onToggleTheme,
    });
  }

  if (handlers.onOpenSettings) {
    commands.push({
      id: 'open-settings',
      label: 'Open Settings',
      description: 'Configure application settings',
      icon: <Settings className="h-4 w-4" />,
      category: 'General',
      keywords: ['preferences', 'config'],
      action: handlers.onOpenSettings,
    });
  }

  if (handlers.onOpenWorkflows) {
    commands.push({
      id: 'open-workflows',
      label: 'Open Workflows',
      description: 'View and run workflows',
      icon: <Play className="h-4 w-4" />,
      category: 'Workflows',
      keywords: ['run', 'execute', 'generate'],
      action: handlers.onOpenWorkflows,
    });
  }

  if (handlers.onOpenResearch) {
    commands.push({
      id: 'open-research',
      label: 'Open Research',
      description: 'Manage sources and citations',
      icon: <BookOpen className="h-4 w-4" />,
      category: 'Research',
      keywords: ['sources', 'citations', 'references'],
      action: handlers.onOpenResearch,
    });
  }

  if (handlers.onOpenAuditLog) {
    commands.push({
      id: 'open-audit-log',
      label: 'Open Audit Log',
      description: 'View AI action history',
      icon: <History className="h-4 w-4" />,
      category: 'General',
      keywords: ['history', 'log', 'actions'],
      action: handlers.onOpenAuditLog,
    });
  }

  if (handlers.onSearch) {
    commands.push({
      id: 'search',
      label: 'Search',
      description: 'Search in workspace',
      icon: <Search className="h-4 w-4" />,
      category: 'Search',
      keywords: ['find', 'query'],
      action: handlers.onSearch,
    });
  }

  return commands;
}

export default CommandPalette;
