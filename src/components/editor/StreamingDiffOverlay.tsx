// Streaming Diff Overlay — M5.
//
// Renders below (or beside) the selection while the AI streams a
// replacement. Shows:
//   - a rolling diff of `original` vs `proposed-so-far`
//   - a "streaming..." indicator while tokens are arriving
//   - per-hunk Accept / Reject buttons once the stream finishes
//   - Accept All / Reject All convenience buttons at the top
//
// Accept/reject state is lifted into the parent so that when all
// hunks are resolved the parent can apply the final text and tear
// this component down.

import { useMemo } from 'react';
import { Check, X, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { computeLineDiff, splitIntoHunks } from '@/modules/editor/aiEdit/streamingDiff';
import type { DiffHunk, HunkResolution } from '@/modules/editor/aiEdit/types';

export interface StreamingDiffOverlayProps {
  /** The original selected text. */
  original: string;
  /** The current proposed replacement (partial while streaming). */
  proposed: string;
  /** True while provider tokens are still arriving. */
  streaming: boolean;
  /** Per-hunk resolution state, keyed by hunk index. */
  resolutions: Record<number, HunkResolution>;
  /** Called when the user accepts a hunk. */
  onAcceptHunk: (hunk: DiffHunk) => void;
  /** Called when the user rejects a hunk. */
  onRejectHunk: (hunk: DiffHunk) => void;
  /** Called when the user accepts every remaining pending hunk. */
  onAcceptAll: () => void;
  /** Called when the user rejects every remaining pending hunk. */
  onRejectAll: () => void;
  /** Called when the user cancels mid-stream (Esc or explicit Cancel). */
  onCancel: () => void;
  className?: string;
}

export function StreamingDiffOverlay({
  original,
  proposed,
  streaming,
  resolutions,
  onAcceptHunk,
  onRejectHunk,
  onAcceptAll,
  onRejectAll,
  onCancel,
  className,
}: StreamingDiffOverlayProps) {
  // Recompute diff + hunks on every render. The selections are small
  // (single paragraphs, not whole files) so this is fine. The parent
  // only drops the overlay when `resolutions` is fully decided, so the
  // diff never flashes an outdated shape.
  const diffLines = useMemo(
    () => computeLineDiff(original, proposed),
    [original, proposed]
  );
  const hunks = useMemo(() => splitIntoHunks(diffLines), [diffLines]);

  const anyPending = hunks.some(
    (h) => (resolutions[h.index] ?? 'pending') === 'pending'
  );

  // We render all diff lines; for each hunk start we attach the
  // accept/reject control. Lines that belong to an already-resolved
  // hunk render at reduced opacity so the user can see what they've
  // decided without clutter.
  const hunkIndexByOriginalStart = new Map<number, DiffHunk>();
  for (const h of hunks) hunkIndexByOriginalStart.set(h.originalStart, h);

  return (
    <div
      data-testid="streaming-diff-region"
      className={cn(
        'rounded-md border bg-background text-sm shadow-md',
        'my-2 overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="font-medium">AI edit</span>
          {streaming ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              streaming...
            </span>
          ) : (
            <span className="text-muted-foreground">
              {hunks.length} hunk{hunks.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!streaming && anyPending && (
            <>
              <button
                type="button"
                data-testid="diff-accept-all"
                onClick={onAcceptAll}
                className="rounded-sm px-2 py-0.5 text-xs hover:bg-green-500/10 hover:text-green-700"
              >
                Accept all
              </button>
              <button
                type="button"
                data-testid="diff-reject-all"
                onClick={onRejectAll}
                className="rounded-sm px-2 py-0.5 text-xs hover:bg-red-500/10 hover:text-red-700"
              >
                Reject all
              </button>
            </>
          )}
          {streaming && (
            <button
              type="button"
              data-testid="diff-cancel"
              onClick={onCancel}
              className="rounded-sm px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Diff body */}
      <div className="max-h-[280px] overflow-auto">
        <table className="w-full font-mono text-xs">
          <tbody>
            {diffLines.map((line, idx) => {
              // Figure out if this line is the head of a hunk, and
              // what its resolution state is.
              let hunk: DiffHunk | undefined;
              if (line.type === 'removed' && line.originalLineNumber !== undefined) {
                // originalLineNumber is 1-based, originalStart is 0-based
                hunk = hunkIndexByOriginalStart.get(line.originalLineNumber - 1);
              } else if (line.type === 'added') {
                // An addition-only hunk starts at a proposed index with
                // the same originalStart as the preceding unchanged
                // line. We identify the hunk by scanning for the first
                // added line of a pure-insertion hunk.
                for (const h of hunks) {
                  if (h.removedLines.length === 0 && h.addedLines[0] === line.content) {
                    hunk = h;
                    break;
                  }
                }
              }

              const hunkResolution = hunk
                ? resolutions[hunk.index] ?? 'pending'
                : undefined;

              const rowClass = cn(
                line.type === 'added' && 'bg-green-500/10 text-green-700 dark:text-green-300',
                line.type === 'removed' && 'bg-red-500/10 text-red-700 dark:text-red-300 line-through',
                hunkResolution === 'accepted' && 'opacity-60',
                hunkResolution === 'rejected' && 'opacity-40'
              );

              const prefix =
                line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';

              return (
                <tr key={idx} className={rowClass}>
                  <td className="w-4 select-none px-1 text-muted-foreground">{prefix}</td>
                  <td className="whitespace-pre px-2 py-0.5">{line.content}</td>
                  <td className="w-28 whitespace-nowrap px-1 py-0.5 text-right">
                    {hunk && !streaming && hunkResolution === 'pending' && (
                      <span className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          data-testid={`hunk-accept-${hunk.index}`}
                          onClick={() => onAcceptHunk(hunk!)}
                          className="inline-flex items-center rounded-sm bg-green-500/10 px-1.5 py-0.5 text-green-700 hover:bg-green-500/20"
                          title="Accept this hunk"
                        >
                          <Check className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          data-testid={`hunk-reject-${hunk.index}`}
                          onClick={() => onRejectHunk(hunk!)}
                          className="inline-flex items-center rounded-sm bg-red-500/10 px-1.5 py-0.5 text-red-700 hover:bg-red-500/20"
                          title="Reject this hunk"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                    {hunk && hunkResolution === 'accepted' && (
                      <span className="text-[10px] text-green-700">accepted</span>
                    )}
                    {hunk && hunkResolution === 'rejected' && (
                      <span className="text-[10px] text-red-700">rejected</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default StreamingDiffOverlay;
