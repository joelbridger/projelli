/**
 * Single source of truth for user-facing keyboard shortcuts.
 *
 * Consumed by:
 *  - `ShortcutsOverlay` (the ? overlay modal)
 *  - `CommandPalette` (when generating default commands)
 *  - Toolbar tooltips (via `formatShortcutHint`)
 *
 * When adding a new shortcut, update this file AND wire the handler in
 * whichever component actually owns the action (most global shortcuts live
 * in `src/App.tsx`). The list here is descriptive — it does not register
 * the handlers.
 */
export type ShortcutCategory = 'File' | 'View' | 'Navigation' | 'Editing' | 'AI' | 'General';

export interface ShortcutDef {
  /** Stable id used for testids and analytics */
  id: string;
  /** Short action label, e.g. "Save File" */
  label: string;
  /** Human readable key combo, already Ctrl-or-Cmd normalized at render time */
  keys: string[];
  category: ShortcutCategory;
  /** Longer description for the overlay list */
  description?: string;
}

/**
 * The canonical shortcut list. Keep the display strings consistent with the
 * actual keydown handlers in `App.tsx`. We use `Ctrl` as the default modifier
 * label; the overlay swaps to `Cmd` on macOS at render time.
 */
export const SHORTCUTS: ShortcutDef[] = [
  // File
  {
    id: 'save-file',
    label: 'Save File',
    keys: ['Ctrl', 'S'],
    category: 'File',
    description: 'Save the active file',
  },
  {
    id: 'close-tab',
    label: 'Close Tab',
    keys: ['Ctrl', 'W'],
    category: 'File',
    description: 'Close the active tab',
  },

  // View
  {
    id: 'split-pane',
    label: 'Toggle Split Pane',
    keys: ['Ctrl', '\\'],
    category: 'View',
    description: 'Split the editor horizontally or close the split',
  },
  {
    id: 'toggle-outline',
    label: 'Toggle Outline Panel',
    keys: ['Ctrl', 'Shift', 'O'],
    category: 'View',
    description: 'Show or hide the outline panel',
  },
  {
    id: 'toggle-backlinks',
    label: 'Toggle Backlinks Panel',
    keys: ['Ctrl', 'Shift', 'B'],
    category: 'View',
    description: 'Show or hide the backlinks panel',
  },

  // Navigation
  {
    id: 'command-palette',
    label: 'Open Command Palette',
    keys: ['Ctrl', 'K'],
    category: 'Navigation',
    description: 'Search and run any command',
  },
  {
    id: 'quick-open',
    label: 'Quick Open File',
    keys: ['Ctrl', 'P'],
    category: 'Navigation',
    description: 'Fuzzy-match any workspace file by name',
  },
  {
    id: 'shortcuts-overlay',
    label: 'Show Keyboard Shortcuts',
    keys: ['?'],
    category: 'Navigation',
    description: 'Open this overlay',
  },

  // AI
  {
    id: 'ai-assistant',
    label: 'Open AI Assistant',
    keys: ['Ctrl', 'Shift', 'A'],
    category: 'AI',
    description: 'Focus the AI Assistant sidebar pane',
  },
];

/**
 * Detect macOS at runtime (guarded for non-browser environments).
 */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

/**
 * Render a keys array for tooltip/inline display, e.g. "Ctrl+S" or "⌘S".
 */
export function formatShortcutHint(keys: string[]): string {
  const mac = isMac();
  const mapped = keys.map((k) => {
    if (mac) {
      if (k === 'Ctrl') return '⌘';
      if (k === 'Shift') return '⇧';
      if (k === 'Alt') return '⌥';
    }
    return k;
  });
  return mac ? mapped.join('') : mapped.join('+');
}

/**
 * Build a tooltip string that combines a label and its shortcut.
 * Pattern: "Save File (Ctrl+S)".
 */
export function withShortcut(label: string, keys: string[]): string {
  return `${label} (${formatShortcutHint(keys)})`;
}

/**
 * Look up a shortcut by id; returns undefined if not found.
 */
export function getShortcut(id: string): ShortcutDef | undefined {
  return SHORTCUTS.find((s) => s.id === id);
}

/**
 * Convenience: return the formatted hint for a shortcut id, or '' if missing.
 */
export function hintFor(id: string): string {
  const s = getShortcut(id);
  return s ? formatShortcutHint(s.keys) : '';
}

/**
 * Group shortcuts by category, preserving insertion order inside each group.
 */
export function groupShortcutsByCategory(
  shortcuts: ShortcutDef[] = SHORTCUTS
): Map<ShortcutCategory, ShortcutDef[]> {
  const groups = new Map<ShortcutCategory, ShortcutDef[]>();
  for (const s of shortcuts) {
    const existing = groups.get(s.category) ?? [];
    existing.push(s);
    groups.set(s.category, existing);
  }
  return groups;
}
