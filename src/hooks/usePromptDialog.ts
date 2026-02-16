import { useState, useCallback, useRef } from 'react';

export interface PromptOptions {
  title?: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface PromptState {
  open: boolean;
  title: string;
  description: string;
  defaultValue: string;
  placeholder: string;
  confirmLabel: string;
  cancelLabel: string;
}

export function usePromptDialog() {
  const [state, setState] = useState<PromptState>({
    open: false,
    title: 'Input Required',
    description: '',
    defaultValue: '',
    placeholder: '',
    confirmLabel: 'OK',
    cancelLabel: 'Cancel',
  });

  const resolveRef = useRef<((value: string | null) => void) | null>(null);

  const prompt = useCallback((message: string, defaultValue?: string, options?: Omit<PromptOptions, 'defaultValue'>): Promise<string | null> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({
        open: true,
        title: options?.title || 'Input Required',
        description: options?.description || message,
        defaultValue: defaultValue || '',
        placeholder: options?.placeholder || '',
        confirmLabel: options?.confirmLabel || 'OK',
        cancelLabel: options?.cancelLabel || 'Cancel',
      });
    });
  }, []);

  const handleConfirm = useCallback((value: string) => {
    if (resolveRef.current) {
      resolveRef.current(value);
      resolveRef.current = null;
    }
  }, []);

  const handleCancel = useCallback(() => {
    if (resolveRef.current) {
      resolveRef.current(null);
      resolveRef.current = null;
    }
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && resolveRef.current) {
      // Dialog closed without explicit confirm/cancel (e.g., ESC key)
      resolveRef.current(null);
      resolveRef.current = null;
    }
    setState((prev) => ({ ...prev, open }));
  }, []);

  return {
    prompt,
    dialogProps: {
      ...state,
      onConfirm: handleConfirm,
      onCancel: handleCancel,
      onOpenChange: handleOpenChange,
    },
  };
}
