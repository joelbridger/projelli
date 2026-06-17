// Review-pane view components extracted from DocxEditor.tsx (behavior-
// preserving 3.0 reorg). The right-side change/comment review surface:
// the pane shell, per-revision rows, and comment cards. Pure presentational;
// every input arrives via props.

import { useTranslation } from 'react-i18next';
import { Check, CheckCheck, PanelRightClose, X, XCircle } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import { authorColor, formatRevisionDate, snippet } from '@/platform/utils/docx-dom';
import type { DocxComment, DocxResolveAction, GroupedRevision } from '@/platform/types/docx';

export function ReviewPane({
  reviewing,
  revisions,
  revisionCount,
  comments,
  anchoredIds,
  activeCommentId,
  onResolveOne,
  onResolveAll,
  onSelectComment,
  onClose,
}: {
  reviewing: boolean;
  revisions: GroupedRevision[];
  revisionCount: number;
  comments: DocxComment[];
  anchoredIds: Set<string>;
  activeCommentId: string | null;
  onResolveOne: (id: string, action: DocxResolveAction) => void;
  onResolveAll: (action: DocxResolveAction) => void;
  onSelectComment: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <aside
      data-testid="docx-review-pane"
      className="flex w-80 shrink-0 flex-col border-l bg-muted/20"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('media.docx-editor.review')}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={onClose}
          title={t('media.docx-editor.hide-review')}
          aria-label={t('media.docx-editor.hide-review')}
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>

      {/* Bulk actions */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button
          data-testid="docx-accept-all"
          variant="outline"
          size="sm"
          className="h-7 flex-1 gap-1 text-xs"
          disabled={revisionCount === 0}
          onClick={() => { onResolveAll('accept'); }}
        >
          <CheckCheck className="h-3.5 w-3.5 text-emerald-600" />
          {t('media.docx-editor.accept-all')}
        </Button>
        <Button
          data-testid="docx-reject-all"
          variant="outline"
          size="sm"
          className="h-7 flex-1 gap-1 text-xs"
          disabled={revisionCount === 0}
          onClick={() => { onResolveAll('reject'); }}
        >
          <XCircle className="h-3.5 w-3.5 text-red-600" />
          {t('media.docx-editor.reject-all')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {/* Changes */}
        <div className="px-3 py-2">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('media.docx-editor.changes')} ({revisionCount})
          </h3>
          {!reviewing && revisionCount > 0 && (
            <p
              data-testid="docx-review-final-note"
              className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
            >
              {t('media.docx-editor.final-view-note')}
            </p>
          )}
          {revisionCount === 0 ? (
            <p
              data-testid="docx-no-changes"
              className="py-2 text-xs text-muted-foreground"
            >
              {t('media.docx-editor.no-changes')}
            </p>
          ) : (
            <ul data-testid="docx-revision-list" className="space-y-1.5">
              {revisions.map((rev) => (
                <RevisionRow
                  key={rev.id}
                  revision={rev}
                  onAccept={() => { onResolveOne(rev.id, 'accept'); }}
                  onReject={() => { onResolveOne(rev.id, 'reject'); }}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Comments */}
        {comments.length > 0 && (
          <div className="border-t px-3 py-2">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('media.docx-editor.comments')} ({comments.length})
            </h3>
            <ul data-testid="docx-comment-list" className="space-y-1.5">
              {comments.map((c) => (
                <CommentCard
                  key={c.id}
                  comment={c}
                  anchored={anchoredIds.has(c.id)}
                  active={activeCommentId === c.id}
                  onClick={() => { onSelectComment(c.id); }}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}

export function RevisionRow({
  revision,
  onAccept,
  onReject,
}: {
  revision: GroupedRevision;
  onAccept: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  const color = authorColor(revision.author);
  const isIns = revision.kind === 'insertion';
  return (
    <li
      data-testid="docx-revision-row"
      data-revision-id={revision.id}
      data-revision-kind={revision.kind}
      className="rounded-md border bg-background p-2 text-xs shadow-sm"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="font-medium" style={{ color }}>
          {revision.author}
        </span>
        <span
          className={cn(
            'ml-auto rounded px-1 py-0.5 text-[10px] font-medium uppercase',
            isIns
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-700',
          )}
        >
          {isIns
            ? t('media.docx-editor.insertion')
            : t('media.docx-editor.deletion')}
        </span>
      </div>
      <p
        className={cn(
          'mb-1.5 break-words text-foreground/80',
          isIns ? 'italic' : 'line-through',
        )}
        title={revision.text}
      >
        {snippet(revision.text) || (
          <span className="not-italic text-muted-foreground no-underline">
            {t('media.docx-editor.empty-change')}
          </span>
        )}
      </p>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {formatRevisionDate(revision.date)}
        </span>
        <div className="flex gap-1">
          <Button
            data-testid="docx-accept-one"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
            onClick={onAccept}
            title={t('media.docx-editor.accept')}
            aria-label={t('media.docx-editor.accept')}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            data-testid="docx-reject-one"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={onReject}
            title={t('media.docx-editor.reject')}
            aria-label={t('media.docx-editor.reject')}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </li>
  );
}

export function CommentCard({
  comment,
  anchored,
  active,
  onClick,
}: {
  comment: DocxComment;
  anchored: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const color = authorColor(comment.author);
  return (
    <li
      data-testid="docx-comment-card"
      data-comment-id={comment.id}
      data-active={active ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'w-full rounded-md border bg-background p-2 text-left text-xs shadow-sm transition-colors',
          active ? 'ring-2 ring-amber-300' : 'hover:bg-muted/40',
        )}
      >
        <div className="mb-1 flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-white"
            style={{ backgroundColor: color }}
          >
            {(comment.initials || comment.author || '?')
              .slice(0, 2)
              .toUpperCase()}
          </span>
          <span className="font-medium" style={{ color }}>
            {comment.author}
          </span>
          {!anchored && (
            <span
              className="ml-auto text-[9px] text-muted-foreground"
              title={t('media.docx-editor.orphan-comment')}
            >
              {t('media.docx-editor.orphan-comment')}
            </span>
          )}
        </div>
        <p className="mb-1 whitespace-pre-wrap break-words text-foreground/80">
          {comment.text}
        </p>
        <span className="text-[10px] text-muted-foreground">
          {formatRevisionDate(comment.date)}
        </span>
      </button>
    </li>
  );
}
