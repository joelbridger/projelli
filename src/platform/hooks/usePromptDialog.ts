import { useState, useCallback, useRef } from 'react';

export interface PromptOptions {
  title?: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * UX-15: destination path to display above the input (e.g. "/docs/").
   * Pass undefined to hide the destination line.
   */
  destinationPath?: string;
  /**
   * UX-15: file extension (with or without a leading dot) used for the
   * live filename preview below the input.
   */
  previewExtension?: string;
  /**
   * When provided, runs on confirm; a returned (non-empty) string is shown
   * inline and the dialog stays open instead of resolving — so a required
   * field can never be confirmed empty as a silent no-op.
   */
  validate?: (value: string) => string | undefined;
}

export interface PromptState {
  open: boolean;
  title: string;
  description: string;
  defaultValue: string;
  placeholder: string;
  confirmLabel: string;
  cancelLabel: string;
  destinationPath?: string;
  previewExtension?: string;
  validate?: (value: string) => string | undefined;
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
        ...(options?.destinationPath !== undefined && {
          destinationPath: options.destinationPath,
        }),
        ...(options?.previewExtension !== undefined && {
          previewExtension: options.previewExtension,
        }),
        ...(options?.validate !== undefined && { validate: options.validate }),
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
