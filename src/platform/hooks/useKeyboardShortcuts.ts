// Keyboard Shortcuts Hook
// Manages keyboard shortcuts across the application

import { useEffect, useCallback, useRef } from 'react';

/**
 * A keyboard shortcut definition
 */
export interface KeyboardShortcut {
  id: string;
  key: string;
  modifiers?: {
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
  };
  description: string;
  category?: string;
  action: () => void;
  enabled?: boolean;
}

/**
 * Options for the useKeyboardShortcuts hook
 */
export interface UseKeyboardShortcutsOptions {
  /**
   * Shortcuts to register
   */
  shortcuts: KeyboardShortcut[];

  /**
   * Whether to prevent default behavior for matched shortcuts
   */
  preventDefault?: boolean;

  /**
   * Whether shortcuts are globally enabled
   */
  enabled?: boolean;

  /**
   * Element to attach listeners to (defaults to document)
   */
  target?: HTMLElement | null;
}

/**
 * Check if the current focus is in an input element
 */
function isInputFocused(): boolean {
  const activeElement = document.activeElement;
  if (!activeElement) return false;

  const tagName = activeElement.tagName.toLowerCase();
  const isContentEditable = activeElement.getAttribute('contenteditable') === 'true';

  return tagName === 'input' || tagName === 'textarea' || isContentEditable;
}

/**
 * Normalize a key event to a consistent format
 */
function normalizeKey(event: KeyboardEvent): string {
  let key = event.key.toLowerCase();

  // Normalize common keys
  if (key === ' ') key = 'space';
  if (key === 'escape') key = 'esc';
  if (key === 'arrowup') key = 'up';
  if (key === 'arrowdown') key = 'down';
  if (key === 'arrowleft') key = 'left';
  if (key === 'arrowright') key = 'right';

  return key;
}

/**
 * Check if a key event matches a shortcut
 */
function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
  const key = normalizeKey(event);
  const shortcutKey = shortcut.key.toLowerCase();

  if (key !== shortcutKey) return false;

  const modifiers = shortcut.modifiers ?? {};

  // Check each modifier
  if (modifiers.ctrl && !event.ctrlKey) return false;
  if (modifiers.alt && !event.altKey) return false;
  if (modifiers.shift && !event.shiftKey) return false;
  if (modifiers.meta && !event.metaKey) return false;

  // Check that no extra modifiers are pressed
  if (event.ctrlKey && !modifiers.ctrl) return false;
  if (event.altKey && !modifiers.alt) return false;
  if (event.metaKey && !modifiers.meta) return false;
  // Note: shift is often okay to be pressed extra

  return true;
}

/**
 * Format a shortcut for display
 */
export function formatShortcut(shortcut: KeyboardShortcut): string {
  const parts: string[] = [];
  const modifiers = shortcut.modifiers ?? {};

  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');

  if (modifiers.meta) {
    parts.push(isMac ? '⌘' : 'Win');
  }
  if (modifiers.ctrl) {
    parts.push(isMac ? '⌃' : 'Ctrl');
  }
  if (modifiers.alt) {
    parts.push(isMac ? '⌥' : 'Alt');
  }
  if (modifiers.shift) {
    parts.push(isMac ? '⇧' : 'Shift');
  }

  // Capitalize single letters
  let key = shortcut.key;
  if (key.length === 1) {
    key = key.toUpperCase();
  }

  parts.push(key);

  return parts.join(isMac ? '' : '+');
}

/**
 * Hook for managing keyboard shortcuts
 */
export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  const { shortcuts, preventDefault = true, enabled = true, target } = options;

  // Store shortcuts in a ref to avoid re-registering on every render
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Skip if typing in an input (unless shortcut specifically allows it)
      if (isInputFocused()) {
        // Only allow shortcuts with ctrl/meta in inputs
        if (!event.ctrlKey && !event.metaKey) {
          return;
        }
      }

      for (const shortcut of shortcutsRef.current) {
        if (shortcut.enabled === false) continue;

        if (matchesShortcut(event, shortcut)) {
          if (preventDefault) {
            event.preventDefault();
            event.stopPropagation();
          }
          shortcut.action();
          return;
        }
      }
    },
    [enabled, preventDefault]
  );

  useEffect(() => {
    const element = target ?? document;
    element.addEventListener('keydown', handleKeyDown as EventListener);

    return () => {
      element.removeEventListener('keydown', handleKeyDown as EventListener);
    };
  }, [handleKeyDown, target]);
}

/**
 * Default shortcuts for the application
 */
export const DEFAULT_SHORTCUTS: Omit<KeyboardShortcut, 'action'>[] = [
  {
    id: 'command-palette',
    key: 'k',
    modifiers: { ctrl: true },
    description: 'Open command palette',
    category: 'General',
  },
  {
    id: 'command-palette-mac',
    key: 'k',
    modifiers: { meta: true },
    description: 'Open command palette',
    category: 'General',
  },
  {
    id: 'save',
    key: 's',
    modifiers: { ctrl: true },
    description: 'Save current file',
    category: 'File',
  },
  {
    id: 'save-mac',
    key: 's',
    modifiers: { meta: true },
    description: 'Save current file',
    category: 'File',
  },
  {
    id: 'undo',
    key: 'z',
    modifiers: { ctrl: true },
    description: 'Undo last action',
    category: 'Edit',
  },
  {
    id: 'redo',
    key: 'z',
    modifiers: { ctrl: true, shift: true },
    description: 'Redo last action',
    category: 'Edit',
  },
  {
    id: 'redo-mac',
    key: 'z',
    modifiers: { meta: true, shift: true },
    description: 'Redo last action',
    category: 'Edit',
  },
  {
    id: 'new-file',
    key: 'n',
    modifiers: { ctrl: true },
    description: 'Create new file',
    category: 'File',
  },
  {
    id: 'close-tab',
    key: 'w',
    modifiers: { ctrl: true },
    description: 'Close current tab',
    category: 'Navigation',
  },
  {
    id: 'toggle-sidebar',
    key: 'b',
    modifiers: { ctrl: true },
    description: 'Toggle sidebar',
    category: 'View',
  },
  {
    id: 'search',
    key: 'f',
    modifiers: { ctrl: true },
    description: 'Search in file',
    category: 'Search',
  },
  {
    id: 'global-search',
    key: 'f',
    modifiers: { ctrl: true, shift: true },
    description: 'Search in workspace',
    category: 'Search',
  },
];

export default useKeyboardShortcuts;
