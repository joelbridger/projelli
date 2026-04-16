// Inline Chat Anchor — M5.
//
// Renders a small floating "Ask AI" button anchored to the end of the
// current selection, plus (when toggled open) an inline textarea where
// the user types their instruction. This component is pure UI; all of
// the actual streaming / diff / history work lives in the parent
// editor (`MarkdownEditor`, `PlainTextEditor`) via `useInlineAiEdit`.
//
// We avoid depending directly on CodeMirror types here so the same
// component can be reused for any editor surface — the parent just
// hands us the absolute anchor coordinates in the editor's client
// coordinate space.

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface InlineChatAnchorProps {
  /** Coordinates (viewport-relative) of the bottom-right of the selection. */
  coords: { x: number; y: number } | null;
  /** Whether an edit session is currently streaming — suppresses the anchor. */
  sessionActive: boolean;
  /** Fires when the user submits an instruction. */
  onSubmit: (instruction: string) => void;
  /**
   * External open signal. `null` = not explicitly triggered (anchor shows
   * but input is collapsed). When set to a counter value, we pop open.
   */
  externalOpenSignal?: number;
  /** Optional class overrides for the container. */
  className?: string;
}

export function InlineChatAnchor({
  coords,
  sessionActive,
  onSubmit,
  externalOpenSignal,
  className,
}: InlineChatAnchorProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const lastSignalRef = useRef<number | undefined>(externalOpenSignal);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // External keyboard-shortcut trigger: when the signal counter ticks
  // forward we pop the input open and focus it.
  useEffect(() => {
    if (externalOpenSignal === undefined) return;
    if (lastSignalRef.current === externalOpenSignal) return;
    lastSignalRef.current = externalOpenSignal;
    setOpen(true);
  }, [externalOpenSignal]);

  useEffect(() => {
    if (open) {
      // Delay focus until after the textarea is mounted.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  // Hide entirely when a streaming session is in progress (the overlay
  // takes over) or when there's no selection to anchor to.
  if (sessionActive || !coords) {
    return null;
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    top: `${coords.y + 4}px`,
    left: `${coords.x + 4}px`,
    zIndex: 40,
  };

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue('');
    setOpen(false);
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setValue('');
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        data-testid="inline-chat-anchor"
        style={style}
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs shadow-sm',
          'hover:bg-accent focus:outline-none focus:ring-1 focus:ring-primary',
          className
        )}
        title="Ask AI to change this selection (Ctrl+Shift+E)"
      >
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span>Ask AI</span>
      </button>
    );
  }

  return (
    <div
      data-testid="inline-chat-input-container"
      style={style}
      className={cn(
        'flex flex-col gap-1 rounded-md border bg-background p-2 shadow-md',
        'w-[320px]',
        className
      )}
    >
      <textarea
        ref={inputRef}
        data-testid="inline-chat-input"
        placeholder="Ask AI to change this selection..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
        className="w-full resize-none rounded-sm border border-input bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setValue('');
          }}
          className="rounded-sm px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="inline-chat-submit"
          onClick={submit}
          disabled={!value.trim()}
          className={cn(
            'inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          <Send className="h-3 w-3" />
          Ask
        </button>
      </div>
    </div>
  );
}

export default InlineChatAnchor;
