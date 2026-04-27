import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FolderOpen } from 'lucide-react';

export interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  /**
   * UX-15: optional human-readable destination path to display above the
   * input ("Creating in /docs/"). Leave undefined for plain prompts.
   */
  destinationPath?: string;
  /**
   * UX-15: when set, an extension like `.md` is appended to the current
   * input value for the live preview shown beneath the input. If the user
   * already typed the extension, it's not duplicated.
   */
  previewExtension?: string;
}

export function PromptDialog({
  open,
  onOpenChange,
  title = 'Input Required',
  description,
  defaultValue = '',
  placeholder = '',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  destinationPath,
  previewExtension,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      // Focus input after dialog opens
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [open, defaultValue]);

  const handleConfirm = () => {
    onConfirm(value);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onCancel();
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    }
  };

  // UX-15: live filename preview. If the user typed the extension already,
  // don't duplicate it. Fall back to the placeholder while the input is
  // empty so the user can see the final shape before they start typing.
  const previewFilename = (() => {
    const base = value.trim() || placeholder || 'my-file';
    if (!previewExtension) return base;
    const ext = previewExtension.startsWith('.')
      ? previewExtension
      : `.${previewExtension}`;
    return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : `${base}${ext}`;
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-2 min-w-0">
          {/* UX-15: destination path, so the user knows where the file
              will be created. Rendered only when the caller passed one.
              `min-w-0` on the parent grid item + the flex children lets
              the long unbreakable workspace path truncate instead of
              expanding the modal beyond its `max-w-lg` cap. */}
          {destinationPath && (
            <div
              data-testid="prompt-dialog-destination"
              className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0"
              title={destinationPath}
            >
              <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="flex-shrink-0">Creating in</span>
              <code className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded truncate min-w-0">
                {destinationPath}
              </code>
            </div>
          )}
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
          />
          {/* UX-15: live filename preview (optional). */}
          {previewExtension !== undefined && (
            <div
              data-testid="prompt-dialog-preview"
              className="text-xs text-muted-foreground"
            >
              Preview:{' '}
              <code
                data-testid="prompt-dialog-preview-filename"
                className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded"
              >
                {previewFilename}
              </code>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {cancelLabel}
          </Button>
          <Button onClick={handleConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
