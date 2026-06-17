// Document-rendering view components extracted from DocxEditor.tsx
// (behavior-preserving 3.0 reorg). The faithful render tree for the OOXML
// JSON DOM (paragraphs, runs, tracked revisions, comment markers, preserved
// inlines) plus the generic editor message fallback. Pure presentational:
// every input arrives via props; nothing closes over the editor component.

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileType, MessageSquare } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  authorColor,
  formatRevisionDate,
  parseParagraphFormat,
  parseRunFormat,
  runFormatToStyle,
  runsText,
} from '@/utils/docx-dom';
import type {
  DocumentJson,
  DocxBlock,
  DocxInline,
  DocxRun,
} from '@/types/docx';
import { extractLooseText } from './docxEditorHelpers';

export function DocumentBody({
  doc,
  reviewing,
  editable,
  activeCommentId,
  onRunEdit,
  onCommentAnchorClick,
}: {
  doc: DocumentJson;
  reviewing: boolean;
  editable: boolean;
  activeCommentId: string | null;
  onRunEdit: (blockIndex: number, inlineIndex: number, text: string) => void;
  onCommentAnchorClick: (id: string) => void;
}) {
  return (
    <div data-testid="docx-document-body">
      {doc.body.map((block, blockIndex) => (
        <BlockView
          key={blockIndex}
          block={block}
          blockIndex={blockIndex}
          reviewing={reviewing}
          editable={editable}
          activeCommentId={activeCommentId}
          onRunEdit={onRunEdit}
          onCommentAnchorClick={onCommentAnchorClick}
        />
      ))}
    </div>
  );
}

export function BlockView({
  block,
  blockIndex,
  reviewing,
  editable,
  activeCommentId,
  onRunEdit,
  onCommentAnchorClick,
}: {
  block: DocxBlock;
  blockIndex: number;
  reviewing: boolean;
  editable: boolean;
  activeCommentId: string | null;
  onRunEdit: (blockIndex: number, inlineIndex: number, text: string) => void;
  onCommentAnchorClick: (id: string) => void;
}) {
  const { t } = useTranslation();

  if (block.kind === 'raw') {
    // Preserve-by-default block (table, sectPr, content control). Read-only
    // placeholder — never parse the XML. Labeled so users know it's preserved.
    return (
      <div
        data-testid="docx-raw-block"
        className="my-3 select-none rounded border border-dashed border-muted-foreground/30 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        contentEditable={false}
      >
        {t('media.docx-editor.preserved-block')}
      </div>
    );
  }

  const pfmt = parseParagraphFormat(block.propertiesXml);
  const align = pfmt.alignment;

  const inlineEls = block.inlines.map((inline, inlineIndex) => (
    <InlineView
      key={inlineIndex}
      inline={inline}
      blockIndex={blockIndex}
      inlineIndex={inlineIndex}
      reviewing={reviewing}
      editable={editable}
      activeCommentId={activeCommentId}
      onRunEdit={onRunEdit}
      onCommentAnchorClick={onCommentAnchorClick}
    />
  ));

  const commonStyle: React.CSSProperties = {
    textAlign: align,
    margin: '0 0 0.5em',
  };

  // Heading paragraphs get larger, heavier, navy-tinted type (Word default
  // headings are blue-ish; we lean to the app's navy accent).
  if (pfmt.headingLevel) {
    const level = pfmt.headingLevel;
    const sizes: Record<number, string> = {
      1: '20pt',
      2: '16pt',
      3: '13pt',
      4: '12pt',
      5: '11pt',
      6: '11pt',
    };
    return (
      <p
        data-testid="docx-paragraph"
        data-heading={level}
        style={{
          ...commonStyle,
          fontSize: sizes[level],
          fontWeight: 600,
          color: '#0A2540',
          marginTop: '0.8em',
        }}
      >
        {inlineEls.length > 0 ? inlineEls : <br />}
      </p>
    );
  }

  return (
    <p data-testid="docx-paragraph" style={commonStyle}>
      {inlineEls.length > 0 ? inlineEls : <br />}
    </p>
  );
}

export function InlineView({
  inline,
  blockIndex,
  inlineIndex,
  reviewing,
  editable,
  activeCommentId,
  onRunEdit,
  onCommentAnchorClick,
}: {
  inline: DocxInline;
  blockIndex: number;
  inlineIndex: number;
  reviewing: boolean;
  editable: boolean;
  activeCommentId: string | null;
  onRunEdit: (blockIndex: number, inlineIndex: number, text: string) => void;
  onCommentAnchorClick: (id: string) => void;
}) {
  switch (inline.kind) {
    case 'run':
      return (
        <PlainRun
          run={inline}
          blockIndex={blockIndex}
          inlineIndex={inlineIndex}
          editable={editable}
          onRunEdit={onRunEdit}
        />
      );

    case 'insertion':
      return (
        <RevisionRun
          kind="insertion"
          runs={inline.runs}
          author={inline.meta.author}
          date={inline.meta.date}
          reviewing={reviewing}
        />
      );

    case 'deletion':
      return (
        <RevisionRun
          kind="deletion"
          runs={inline.runs}
          author={inline.meta.author}
          date={inline.meta.date}
          reviewing={reviewing}
        />
      );

    case 'commentReference':
      return (
        <CommentMarker
          id={inline.id}
          active={activeCommentId === inline.id}
          onClick={() => { onCommentAnchorClick(inline.id); }}
        />
      );

    case 'commentRangeStart':
      // Anchors are rendered as zero-width markers; the highlight comes from the
      // runs between start/end being wrapped. We keep them as data anchors so
      // future range-highlighting can find them; visually they're invisible.
      return (
        <span
          data-testid="docx-comment-range-start"
          data-comment-id={inline.id}
          className={cn(
            activeCommentId === inline.id && 'bg-amber-100',
          )}
        />
      );

    case 'commentRangeEnd':
      return (
        <span
          data-testid="docx-comment-range-end"
          data-comment-id={inline.id}
        />
      );

    case 'raw':
      // Preserve-by-default inline (hyperlink, field, drawing). Render its
      // flattened text if we can cheaply extract it, else a subtle marker.
      return <RawInline xml={inline.xml} />;

    default:
      return null;
  }
}

/** A normal, editable run. */
export function PlainRun({
  run,
  blockIndex,
  inlineIndex,
  editable,
  onRunEdit,
}: {
  run: DocxRun;
  blockIndex: number;
  inlineIndex: number;
  editable: boolean;
  onRunEdit: (blockIndex: number, inlineIndex: number, text: string) => void;
}) {
  const fmt = useMemo(() => parseRunFormat(run.propertiesXml), [run.propertiesXml]);
  const { style, underline, strike } = runFormatToStyle(fmt);
  // Combine underline + strike into a single CSS decoration value (inline, so we
  // don't depend on specific Tailwind utility classes being present).
  const decorationLine = [underline && 'underline', strike && 'line-through']
    .filter(Boolean)
    .join(' ');

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLSpanElement>) => {
      const text = e.currentTarget.textContent ?? '';
      onRunEdit(blockIndex, inlineIndex, text);
    },
    [blockIndex, inlineIndex, onRunEdit],
  );

  return (
    <span
      data-testid="docx-run"
      data-block={blockIndex}
      data-inline={inlineIndex}
      // `suppressContentEditableWarning` because we set initial text as a child
      // and let the browser own subsequent edits; we read it back on blur.
      contentEditable={editable}
      suppressContentEditableWarning
      spellCheck={editable}
      onBlur={editable ? handleBlur : undefined}
      style={{
        ...style,
        ...(decorationLine ? { textDecorationLine: decorationLine } : {}),
        whiteSpace: 'pre-wrap',
        outline: 'none',
      }}
    >
      {run.text}
    </span>
  );
}

/** A tracked insertion or deletion run, Word-styled, with author tooltip. */
export function RevisionRun({
  kind,
  runs,
  author,
  date,
  reviewing,
}: {
  kind: 'insertion' | 'deletion';
  runs: DocxRun[];
  author: string;
  date: string;
  reviewing: boolean;
}) {
  const text = runsText(runs);
  const color = authorColor(author);

  // Clean "final" view: insertions become normal text, deletions vanish.
  if (!reviewing) {
    if (kind === 'deletion') return null;
    return (
      <span data-testid="docx-run" data-revision="insertion-final">
        {text}
      </span>
    );
  }

  const isIns = kind === 'insertion';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid={isIns ? 'docx-insertion' : 'docx-deletion'}
          data-author={author}
          style={{
            color,
            textDecorationLine: isIns ? 'underline' : 'line-through',
            textDecorationColor: color,
            whiteSpace: 'pre-wrap',
            cursor: 'help',
          }}
        >
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-medium">
          {isIns ? 'Inserted' : 'Deleted'} by {author}
        </span>
        <span className="ml-1 text-muted-foreground">
          · {formatRevisionDate(date)}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/** The little [n] marker Word shows where a comment reference sits. */
export function CommentMarker({
  id,
  active,
  onClick,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="docx-comment-marker"
      data-comment-id={id}
      onClick={onClick}
      title={`Comment ${id}`}
      className={cn(
        'mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-sm px-1 align-super text-[9px] font-semibold leading-none',
        active
          ? 'bg-amber-400 text-amber-950'
          : 'bg-amber-200 text-amber-900 hover:bg-amber-300',
      )}
    >
      <MessageSquare className="mr-0.5 h-2.5 w-2.5" />
      {id}
    </button>
  );
}

/**
 * Render a preserved (unmodeled) inline. We try a cheap text extraction from the
 * raw XML so hyperlinks/fields still read naturally; if there's no text, show a
 * subtle non-editable marker. Never parse structurally.
 */
export function RawInline({ xml }: { xml: string }) {
  const text = useMemo(() => extractLooseText(xml), [xml]);
  if (text.trim().length > 0) {
    return (
      <span data-testid="docx-raw-inline" data-preserved="true">
        {text}
      </span>
    );
  }
  return (
    <span
      data-testid="docx-raw-inline"
      data-preserved="true"
      contentEditable={false}
      className="mx-0.5 inline-block select-none rounded bg-muted px-1 text-[10px] text-muted-foreground"
      title="Preserved content"
    >
      ⋯
    </span>
  );
}

// ===========================================================================
// Generic editor message fallback
// ===========================================================================

export function DocxEditorMessage({
  fileName,
  message,
}: {
  fileName: string;
  message: string;
}) {
  return (
    <div
      data-testid="docx-editor"
      data-mode="message"
      className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground"
    >
      <FileType className="h-12 w-12 opacity-50" />
      <p className="text-sm font-medium text-foreground">{fileName}</p>
      <p className="max-w-sm text-xs">{message}</p>
    </div>
  );
}
