/**
 * Undo toast system (UX-16)
 *
 * A lightweight, screen-scoped toast for destructive actions. Shows a
 * single message with an "Undo" button at the bottom-right of the screen
 * for a fixed TTL (default 10s). Invoking undo fires the caller's
 * restore callback and dismisses the toast. Letting it expire commits
 * the destructive action silently.
 *
 * Usage:
 *
 *   const undoToast = useUndoToast();
 *   undoToast.show({
 *     message: 'File moved to Trash',
 *     onUndo: () => restoreFile(snapshot),
 *     ttlMs: 10_000,
 *   });
 *
 *   // Render <UndoToastRenderer {...undoToast.props} /> once at the app root.
 *
 * Why not sonner: a single transient toast at the bottom-right is all
 * we need for delete/restore. Adding a dependency for this would pull in
 * ~8 KB minified plus styling differences. When we need a broader toast
 * system (success/info/warn), we can swap this for sonner without
 * breaking the call site.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';

interface UndoToastSpec {
  message: string;
  onUndo: () => void | Promise<void>;
  ttlMs?: number;
  /** Label for the action button. Defaults to "Undo" (the original use). */
  actionLabel?: string;
}

interface UndoToastState extends UndoToastSpec {
  id: string;
  visible: boolean;
}

export interface UndoToastController {
  state: UndoToastState | null;
  show: (spec: UndoToastSpec) => void;
  dismiss: () => void;
  invokeUndo: () => void;
}

export function useUndoToast(): UndoToastController {
  const [state, setState] = useState<UndoToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setState(null);
  }, [clearTimer]);

  const show = useCallback(
    (spec: UndoToastSpec) => {
      clearTimer();
      const id = `undo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setState({ ...spec, id, visible: true });
      const ttl = spec.ttlMs ?? 10_000;
      timerRef.current = setTimeout(() => {
        setState(null);
        timerRef.current = null;
      }, ttl);
    },
    [clearTimer]
  );

  const invokeUndo = useCallback(() => {
    if (!state) return;
    const onUndo = state.onUndo;
    dismiss();
    void onUndo();
  }, [state, dismiss]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { state, show, dismiss, invokeUndo };
}

interface UndoToastRendererProps {
  controller: UndoToastController;
  className?: string;
}

export function UndoToastRenderer({ controller, className }: UndoToastRendererProps) {
  const { state, invokeUndo, dismiss } = controller;
  if (!state) return null;
  return (
    <div
      data-testid="undo-toast"
      role="status"
      aria-live="polite"
      className={cn(
        'fixed bottom-6 right-6 z-[100] flex items-center gap-3 rounded-md border bg-background shadow-lg px-4 py-2 text-sm',
        className
      )}
    >
      <span data-testid="undo-toast-message">{state.message}</span>
      <Button
        data-testid="undo-toast-undo"
        size="sm"
        variant="secondary"
        className="h-7 px-3 text-xs"
        onClick={invokeUndo}
      >
        {state.actionLabel ?? 'Undo'}
      </Button>
      <Button
        data-testid="undo-toast-dismiss"
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0 text-xs"
        onClick={dismiss}
        aria-label="Dismiss"
      >
        ×
      </Button>
    </div>
  );
}
