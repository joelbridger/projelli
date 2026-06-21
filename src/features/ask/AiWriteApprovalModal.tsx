/**
 * AI file-change approval modal (BUG-060).
 *
 * Shows when the AI's chat tool executor has requested approval for a file
 * write / move / delete (see `aiApprovalStore`). The user sees exactly what is
 * about to happen — a before/after for an overwrite, the new content for a
 * create, the destination for a move, or the content about to be trashed for a
 * delete — and clicks Approve or Skip. The decision settles the awaiting
 * executor, which then applies the change or tells the model it was declined.
 *
 * Mirrors the existing MCP write-approval modal so the two approval flows feel
 * the same.
 */

import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { AlertTriangle, Check, X, FilePlus2, FilePen, FolderPlus, FolderInput, Trash2, FileWarning } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useAiApprovalStore } from '@/platform/ai/aiApprovalStore';
import type { AiWriteOp } from '@/platform/ai/aiWriteApproval';

/** Per-op title, with LITERAL keys so the i18n parser can extract them. */
function opTitle(t: TFunction, op: AiWriteOp): string {
  switch (op.kind) {
    case 'create_file':
      return t('ai.write-approval.title.create-file');
    case 'overwrite_file':
      return t('ai.write-approval.title.overwrite-file');
    case 'create_folder':
      return t('ai.write-approval.title.create-folder');
    case 'move_file':
      return t('ai.write-approval.title.move-file');
    case 'delete_file':
      return t('ai.write-approval.title.delete-file');
  }
}

/** Tiny inline line diff (same style as the MCP approval modal). */
function renderDiff(oldText: string, newText: string): React.ReactElement {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const max = Math.max(oldLines.length, newLines.length);
  const rows: React.ReactElement[] = [];
  for (let i = 0; i < max; i += 1) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) {
      rows.push(
        <div key={`eq-${i}`} className="text-muted-foreground">
          {'  '}
          {o ?? ''}
        </div>,
      );
    } else {
      if (o !== undefined) {
        rows.push(
          <div key={`old-${i}`} className="text-destructive">
            - {o}
          </div>,
        );
      }
      if (n !== undefined) {
        rows.push(
          <div key={`new-${i}`} className="text-emerald-600 dark:text-emerald-400">
            + {n}
          </div>,
        );
      }
    }
  }
  return (
    <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words">
      {rows}
    </pre>
  );
}

/** The path the op acts on (for the header code chip). */
function opPath(op: AiWriteOp): string {
  return op.kind === 'move_file' ? `${op.from} → ${op.to}` : op.path;
}

function OpIcon({ op }: { op: AiWriteOp }): React.ReactElement {
  const cls = 'h-4 w-4 text-muted-foreground shrink-0';
  switch (op.kind) {
    case 'create_file':
      return <FilePlus2 className={cls} />;
    case 'overwrite_file':
      return <FilePen className={cls} />;
    case 'create_folder':
      return <FolderPlus className={cls} />;
    case 'move_file':
      return <FolderInput className={cls} />;
    case 'delete_file':
      return <Trash2 className={cls} />;
  }
}

export function AiWriteApprovalModal(): React.ReactElement | null {
  const { t } = useTranslation();
  const pending = useAiApprovalStore((s) => s.pending);
  const resolvePending = useAiApprovalStore((s) => s.resolvePending);

  if (!pending) return null;
  const { op, beforeText, afterText, binary } = pending;

  // Per-op title + one-line summary.
  const isDestructive = op.kind === 'delete_file' || op.kind === 'overwrite_file' || (op.kind === 'move_file' && op.destExists);

  return (
    <Dialog open={true}>
      <DialogContent
        data-testid="ai-write-approval-modal"
        className="max-w-2xl w-[92vw] p-0 flex flex-col overflow-hidden"
      >
        <div className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className={`h-4 w-4 shrink-0 ${isDestructive ? 'text-amber-500' : 'text-muted-foreground'}`} />
            <span>{opTitle(t, op)}</span>
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs">
            {t('ai.write-approval.description')}
          </DialogDescription>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto max-h-[60vh]">
          <div className="flex items-center gap-2 text-sm">
            <OpIcon op={op} />
            <code
              data-testid="ai-approval-path"
              className="px-1.5 py-0.5 rounded bg-muted font-mono text-[12px] break-all"
            >
              {opPath(op)}
            </code>
          </div>

          {/* Move onto an existing file: call out that it replaces something. */}
          {op.kind === 'move_file' && op.destExists && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <FileWarning className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
              <span>{t('ai.write-approval.move-overwrite-warning')}</span>
            </div>
          )}

          {/* Delete: note it's recoverable from Trash. */}
          {op.kind === 'delete_file' && (
            <p className="text-xs text-muted-foreground">{t('ai.write-approval.delete-trash-note')}</p>
          )}

          {/* Binary file: no text diff to show. */}
          {binary && (op.kind === 'overwrite_file' || op.kind === 'create_file' || op.kind === 'delete_file') ? (
            <div
              data-testid="ai-approval-binary"
              className="rounded-md border border-border/60 bg-muted/10 p-3 text-xs text-muted-foreground"
            >
              {t('ai.write-approval.binary-note')}
            </div>
          ) : (
            // Text preview / diff for create + overwrite (and content being trashed on delete).
            (afterText !== undefined || beforeText !== undefined) && (
              <div
                data-testid="ai-approval-preview"
                className="rounded-md border border-border/60 bg-muted/10 p-3 overflow-x-auto"
              >
                {op.kind === 'overwrite_file' ? (
                  renderDiff(beforeText ?? '', afterText ?? '')
                ) : op.kind === 'delete_file' ? (
                  <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words text-destructive">
                    {beforeText ?? ''}
                  </pre>
                ) : (
                  <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words text-emerald-600 dark:text-emerald-400">
                    {afterText ?? ''}
                  </pre>
                )}
              </div>
            )
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-end gap-2">
          <Button
            data-testid="ai-approval-skip"
            variant="outline"
            size="sm"
            onClick={() => resolvePending('skip')}
            className="gap-1.5 text-xs"
          >
            <X className="h-3.5 w-3.5" />
            {t('ai.write-approval.skip')}
          </Button>
          <Button
            data-testid="ai-approval-approve"
            variant="default"
            size="sm"
            onClick={() => resolvePending('approve')}
            className="gap-1.5 text-xs"
          >
            <Check className="h-3.5 w-3.5" />
            {t('ai.write-approval.approve')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AiWriteApprovalModal;
