import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { WorkspaceSource } from '@/platform/types/ai';
import { citationBasename } from '@/platform/rag/workspaceCommand';
import { citationDisplayLabel } from './renderingHelpers';

/**
 * M2 — Sources accordion shown below any assistant message whose user
 * turn was workspace-aware. Collapsed by default; expanding reveals a
 * list of clickable paths (basename + paragraph). Clicking a row opens
 * the file in the editor.
 */
export function ChatSourcesAccordion({
  sources,
  onOpen,
  onMissing,
}: {
  sources: WorkspaceSource[];
  onOpen: (
    path: string,
    paragraphIndex: number,
    sourceType?: string,
    pageNumber?: number,
    snippet?: string,
  ) => void;
  onMissing: (path: string) => void;
}): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  if (!sources || sources.length === 0) return null;
  return (
    <div
      data-testid="chat-sources-accordion"
      className="mt-2 w-full max-w-[85%]"
    >
      <button
        type="button"
        data-testid="chat-sources-toggle"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {sources.length} source{sources.length === 1 ? '' : 's'}
      </button>
      {open && (
        <ul className="mt-1 ml-4 space-y-1 border-l pl-2 border-muted">
          {sources.map((s, idx) => {
            const base = citationBasename(s.path);
            // F-505 — the accordion rows carry their OWN testid; reusing the
            // inline chip's `chat-citation-*` made bare getByTestId lookups
            // resolve to two elements once the accordion was open.
            const testId = `chat-source-${base}-${s.paragraphIndex}`;
            return (
              <li key={`${s.path}-${s.paragraphIndex}-${idx}`}>
                <button
                  type="button"
                  data-testid={testId}
                  className="text-xs text-muted-foreground hover:text-foreground underline truncate max-w-full text-left"
                  title={s.path}
                  onClick={() => {
                    if (s.path) onOpen(s.path, s.paragraphIndex, s.sourceType, s.pageNumber, s.chunkText);
                    else onMissing(base);
                  }}
                >
                  {citationDisplayLabel(
                    base,
                    s.paragraphIndex,
                    s.sourceType,
                    s.pageNumber,
                    s.extraction,
                    s.extractionConfidence,
                    s.locator,
                    s.path,
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
