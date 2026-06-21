/**
 * AI batch-review panel (BUG-060, layer 3).
 *
 * Shown at the END of an AI turn when the approval mode is `batch`: the AI's
 * file changes were applied immediately, and this panel lists every one of them
 * so the user can keep them all or undo any subset. Each row shows the op, the
 * path, and a preview (a before/after diff for a text overwrite, the new text
 * for a create, the trashed text for a delete, or a summary for binary/move).
 *
 * The changes already live on disk, so "Keep all changes" simply dismisses the
 * panel; "Undo selected" reverses the checked rows via the batch store (which
 * uses the live WorkspaceService registered from App).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import {
  AlertTriangle, Undo2, Check, FilePlus2, FilePen, FolderPlus, FolderInput, Trash2,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import { useAiBatchReviewStore } from '@/platform/ai/aiBatchReviewStore';
import { unsafePartialUndos, type BatchChange } from '@/platform/ai/aiBatchReview';

/** Per-op past-tense label, with LITERAL keys so the i18n parser extracts them. */
function opLabel(t: TFunction, kind: BatchChange['kind']): string {
  switch (kind) {
    case 'create_file':
      return t('ai.batch-review.op.create-file');
    case 'overwrite_file':
      return t('ai.batch-review.op.overwrite-file');
    case 'create_folder':
      return t('ai.batch-review.op.create-folder');
    case 'move_file':
      return t('ai.batch-review.op.move-file');
    case 'delete_file':
      return t('ai.batch-review.op.delete-file');
  }
}

function OpIcon({ kind }: { kind: BatchChange['kind'] }): React.ReactElement {
  const cls = 'h-4 w-4 text-muted-foreground shrink-0';
  switch (kind) {
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

/** The path shown for a change (move shows from → to). */
function changePath(change: BatchChange): string {
  return change.kind === 'move_file' ? `${change.from} → ${change.to}` : change.path;
}

/** Compact inline line diff (same look as the per-action approval modal). */
function renderDiff(oldText: string, newText: string): React.ReactElement {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const max = Math.max(oldLines.length, newLines.length);
  const rows: React.ReactElement[] = [];
  for (let i = 0; i < max; i += 1) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) {
      rows.push(<div key={`eq-${String(i)}`} className="text-muted-foreground">{'  '}{o ?? ''}</div>);
    } else {
      if (o !== undefined) rows.push(<div key={`old-${String(i)}`} className="text-destructive">- {o}</div>);
      if (n !== undefined) rows.push(<div key={`new-${String(i)}`} className="text-emerald-600 dark:text-emerald-400">+ {n}</div>);
    }
  }
  return <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words">{rows}</pre>;
}

/** Preview body for a single change (diff / new text / trashed text / summary). */
function ChangePreview({ change, binaryNote }: { change: BatchChange; binaryNote: string }): React.ReactElement | null {
  if (change.kind === 'create_folder' || change.kind === 'move_file') return null;
  if (change.binary) {
    return (
      <div data-testid="ai-batch-binary" className="rounded-md border border-border/60 bg-muted/10 p-2 text-[11px] text-muted-foreground">
        {binaryNote}
      </div>
    );
  }
  if (change.kind === 'overwrite_file') {
    if (change.beforeText === undefined && change.afterText === undefined) return null;
    return <div className="rounded-md border border-border/60 bg-muted/10 p-2 overflow-x-auto">{renderDiff(change.beforeText ?? '', change.afterText ?? '')}</div>;
  }
  if (change.kind === 'create_file') {
    if (change.afterText === undefined) return null;
    return (
      <div className="rounded-md border border-border/60 bg-muted/10 p-2 overflow-x-auto">
        <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words text-emerald-600 dark:text-emerald-400">{change.afterText}</pre>
      </div>
    );
  }
  // delete_file
  if (change.beforeText === undefined) return null;
  return (
    <div className="rounded-md border border-border/60 bg-muted/10 p-2 overflow-x-auto">
      <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words text-destructive">{change.beforeText}</pre>
    </div>
  );
}

export function AiBatchReviewPanel(): React.ReactElement | null {
  const { t } = useTranslation();
  const reviewOpen = useAiBatchReviewStore((s) => s.reviewOpen);
  const changes = useAiBatchReviewStore((s) => s.changes);
  const undoErrors = useAiBatchReviewStore((s) => s.undoErrors);
  const reset = useAiBatchReviewStore((s) => s.reset);
  const undo = useAiBatchReviewStore((s) => s.undo);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [undoing, setUndoing] = useState(false);
  const [blockMsg, setBlockMsg] = useState<string | null>(null);

  if (!reviewOpen || changes.length === 0) return null;

  const toggle = (id: string) => {
    setBlockMsg(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const undoSelected = async () => {
    // Refuse an unsafe partial undo: if undoing the selection would destroy a
    // change the user is KEEPING (a later change builds on one being undone),
    // don't silently clobber it — ask them to include those too or Keep all.
    const unsafe = unsafePartialUndos(Array.from(selected), changes);
    if (unsafe.length > 0) {
      setBlockMsg(t('ai.batch-review.unsafe-partial'));
      return;
    }
    setBlockMsg(null);
    setUndoing(true);
    try {
      // Undo in REVERSE applied order so dependent changes reverse correctly
      // (e.g. if the AI overwrote a.md then moved a.md→b.md, undo the move
      // first, then restore a.md's bytes — never the other way around).
      const orderedIds = changes
        .map((c, i) => ({ id: c.id, i }))
        .filter(({ id }) => selected.has(id))
        .sort((a, b) => b.i - a.i)
        .map(({ id }) => id);
      for (const id of orderedIds) {
        await undo(id);
      }
      setSelected(new Set());
    } finally {
      setUndoing(false);
    }
  };

  return (
    <Dialog open={true}>
      <DialogContent
        data-testid="ai-batch-review-panel"
        className="max-w-2xl w-[92vw] p-0 flex flex-col overflow-hidden"
      >
        <div className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{t('ai.batch-review.title')}</span>
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs">{t('ai.batch-review.description')}</DialogDescription>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto max-h-[60vh]">
          {changes.map((change) => {
            const err = undoErrors[change.id];
            return (
              <div key={change.id} data-testid="ai-batch-change" className="rounded-md border border-border/60 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-testid={`ai-batch-select-${change.id}`}
                    className="h-3.5 w-3.5 accent-primary"
                    disabled={!change.undoable}
                    checked={selected.has(change.id)}
                    onChange={() => { toggle(change.id); }}
                    aria-label={`select ${changePath(change)}`}
                  />
                  <OpIcon kind={change.kind} />
                  <span className="text-xs font-medium text-muted-foreground">{opLabel(t, change.kind)}</span>
                  <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-[12px] break-all">{changePath(change)}</code>
                </div>

                <ChangePreview change={change} binaryNote={t('ai.batch-review.binary-note')} />

                {!change.undoable && (
                  <p data-testid="ai-batch-not-undoable" className="text-[11px] text-amber-600 dark:text-amber-400">
                    {t('ai.batch-review.not-undoable')}
                  </p>
                )}
                {err && (
                  <p data-testid="ai-batch-error" className="flex items-center gap-1 text-[11px] text-destructive">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> {err}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {blockMsg && (
          <div
            data-testid="ai-batch-block-msg"
            className="mx-5 mb-1 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            <span>{blockMsg}</span>
          </div>
        )}

        <div className="px-5 py-3 border-t flex items-center justify-end gap-2">
          <Button
            data-testid="ai-batch-undo-selected"
            variant="outline"
            size="sm"
            disabled={selected.size === 0 || undoing}
            onClick={() => void undoSelected()}
            className="gap-1.5 text-xs"
          >
            <Undo2 className="h-3.5 w-3.5" />
            {t('ai.batch-review.undo-selected')}
          </Button>
          <Button
            data-testid="ai-batch-keep-all"
            variant="default"
            size="sm"
            onClick={() => { reset(); }}
            className="gap-1.5 text-xs"
          >
            <Check className="h-3.5 w-3.5" />
            {t('ai.batch-review.keep-all')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AiBatchReviewPanel;
