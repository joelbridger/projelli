// Pure leaf helpers + self-contained view bits extracted from TabBar.tsx
// (behavior-preserving 3.0 reorg). Filename/test-id helpers, the per-type
// tab icon, and the AI-context chip (reads the global fileContextStore, not
// any TabBar state). No coupling to the TabBar component body.

import { Globe, MessageSquare, Sparkles, EyeOff, Mail } from 'lucide-react';
import { getFileIcon } from '@/utils/fileIcons';
import { cn } from '@/lib/utils';
import { useFileContextStore } from '@/platform/state/fileContextStore';

// Helper function to remove file extension from name
export const removeExtension = (filename: string): string => {
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
export const getTabIcon = (tab: { name: string; type?: 'file' | 'browser' | 'ai-assistant' | 'workflow-execution' | 'email' }) => {
  if (tab.type === 'browser') {
    return <Globe className="h-4 w-4 text-sky-500 flex-shrink-0" />;
  }
  if (tab.type === 'ai-assistant') {
    return <MessageSquare className="h-4 w-4 text-purple-500 flex-shrink-0" />;
  }
  if (tab.type === 'workflow-execution') {
    return <Sparkles className="h-4 w-4 text-amber-700 flex-shrink-0" />;
  }
  if (tab.type === 'email') {
    return <Mail className="h-4 w-4 text-[#0A2540] flex-shrink-0" />;
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
export function AIContextChip({ path }: { path: string }) {
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
