import { useState, useCallback, useRef } from 'react';

export interface ConfirmOptions {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
}

export interface ConfirmState {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: 'default' | 'destructive';
}

export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    title: 'Confirm Action',
    description: '',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    variant: 'default',
  });

  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((message: string, options?: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({
        open: true,
        title: options?.title || 'Confirm Action',
        description: options?.description || message,
        confirmLabel: options?.confirmLabel || 'Confirm',
        cancelLabel: options?.cancelLabel || 'Cancel',
        variant: options?.variant || 'default',
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (resolveRef.current) {
      resolveRef.current(true);
      resolveRef.current = null;
    }
  }, []);

  const handleCancel = useCallback(() => {
    if (resolveRef.current) {
      resolveRef.current(false);
      resolveRef.current = null;
    }
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && resolveRef.current) {
      // Dialog closed without explicit confirm/cancel (e.g., ESC key)
      resolveRef.current(false);
      resolveRef.current = null;
    }
    setState((prev) => ({ ...prev, open }));
  }, []);

  return {
    confirm,
    dialogProps: {
      ...state,
      onConfirm: handleConfirm,
      onCancel: handleCancel,
      onOpenChange: handleOpenChange,
    },
  };
}
