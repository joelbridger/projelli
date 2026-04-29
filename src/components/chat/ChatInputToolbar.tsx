/**
 * Stream A1 — Chat input toolbar with attachment support.
 *
 * Wraps the existing Textarea + send/voice buttons and adds:
 *   - Paperclip button (opens hidden file input)
 *   - Paste handler (Ctrl+V / Command+V on any image clipboard data)
 *   - Drag-drop zone with visible overlay on dragenter
 *   - Attachment tiles strip below the textarea
 *   - VisionWarningBanner when model cannot handle the attached image type
 *   - 20 MB per-file cap with toast on rejection
 *
 * Attachment saving is handled by AttachmentService; this component only
 * holds a `pendingAttachments` prop array (managed by AIChatViewer state)
 * and fires callbacks on add/remove.
 */

import { useRef, useState, useCallback, type DragEvent, type ClipboardEvent } from 'react';
import { Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AttachmentTile } from './AttachmentTile';
import { VisionWarningBanner } from './VisionWarningBanner';
import {
  SUPPORTED_IMAGE_MIMES,
  MAX_ATTACHMENT_BYTES,
  getSuggestedVisionModel,
} from '@/modules/models/vision-capability';
import type { ChatAttachment } from '@/types/ai';

export interface ChatInputToolbarProps {
  /** Provider string used for vision capability check ('anthropic'|'openai'|'google'|'ollama'). */
  provider: string;
  /** Currently selected model ID. */
  model: string;
  /** Currently pending attachments (controlled by parent). */
  pendingAttachments: ChatAttachment[];
  /** Preview object URLs keyed by attachment id. Managed by parent. */
  previewUrls: Record<string, string>;
  /**
   * Called when the user selects file(s) or pastes an image.
   * Parent is responsible for calling AttachmentService.save() and updating
   * pendingAttachments.
   */
  onFilesSelected: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  /**
   * Called when the user clicks the "Switch to X" button in the vision warning.
   * Parent updates the chat's model selection.
   */
  onSwitchModel: (model: string) => void;
  /** String error from supportsAttachment, or null when model is compatible. */
  visionWarning: string | null;
  /** Whether the send button should be rendered disabled (propagated from parent). */
  sendDisabled: boolean;
  className?: string;
}

export function ChatInputToolbar({
  provider,
  pendingAttachments,
  previewUrls,
  onFilesSelected,
  onRemoveAttachment,
  onSwitchModel,
  visionWarning,
  className,
}: ChatInputToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const accept = SUPPORTED_IMAGE_MIMES.join(',');

  const validateAndCollect = useCallback(
    (files: FileList | null): File[] => {
      if (!files) return [];
      const valid: File[] = [];
      for (const file of Array.from(files)) {
        if (!SUPPORTED_IMAGE_MIMES.includes(file.type)) {
          continue;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          // Parent's onFilesSelected will detect oversized files and show a toast.
        }
        valid.push(file);
      }
      return valid;
    },
    []
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = validateAndCollect(e.target.files);
      if (files.length > 0) onFilesSelected(files);
      // Reset so the same file can be picked again.
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [onFilesSelected, validateAndCollect]
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && SUPPORTED_IMAGE_MIMES.includes(item.type)) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault(); // Don't paste binary into textarea.
        onFilesSelected(imageFiles);
      }
    },
    [onFilesSelected]
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = validateAndCollect(e.dataTransfer.files);
      if (files.length > 0) onFilesSelected(files);
    },
    [onFilesSelected, validateAndCollect]
  );

  const suggestedModel = visionWarning ? getSuggestedVisionModel(provider) : '';

  return (
    <div
      data-testid="chat-input-toolbar"
      className={cn('relative', className)}
      onPaste={handlePaste}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag-drop overlay */}
      {isDragOver && (
        <div
          data-testid="chat-drop-overlay"
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 pointer-events-none"
        >
          <span className="text-sm font-medium text-primary">Drop image here</span>
        </div>
      )}

      {/* Vision warning */}
      {visionWarning && (
        <VisionWarningBanner
          message={visionWarning}
          suggestedModel={suggestedModel}
          onSwitchModel={onSwitchModel}
          className="mb-2"
        />
      )}

      {/* Attachment tiles */}
      {pendingAttachments.length > 0 && (
        <div
          data-testid="attachment-tiles-strip"
          className="flex flex-wrap gap-2 mb-2"
        >
          {pendingAttachments.map((att) => (
            <AttachmentTile
              key={att.id}
              attachment={att}
              {...(previewUrls[att.id] ? { previewUrl: previewUrls[att.id] } : {})}
              onRemove={onRemoveAttachment}
            />
          ))}
        </div>
      )}

      {/* Paperclip button row */}
      <div className="flex items-center gap-1 mb-1">
        <Button
          data-testid="chat-paperclip-button"
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach image"
          title="Attach image (png, jpg, gif, webp)"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          aria-hidden
          onChange={handleFileInputChange}
        />
      </div>
    </div>
  );
}

export default ChatInputToolbar;
