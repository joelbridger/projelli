/**
 * Stream A1 — Renders a single pending attachment below the chat input.
 * Shows a thumbnail (for images) or a file-type icon, file name, and a
 * remove button.
 */
import { X, Image as ImageIcon, FileText } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import type { ChatAttachment } from '@/types/ai';

export interface AttachmentTileProps {
  attachment: ChatAttachment;
  /** Object URL for preview (revoked by caller after unmount). */
  previewUrl?: string;
  onRemove: (id: string) => void;
  className?: string;
}

export function AttachmentTile({
  attachment,
  previewUrl,
  onRemove,
  className,
}: AttachmentTileProps) {
  return (
    <div
      data-testid={`attachment-tile-${attachment.id}`}
      className={cn(
        'relative flex items-center gap-2 rounded-md border border-border',
        'bg-muted/40 px-2 py-1.5 text-xs max-w-[180px]',
        className
      )}
    >
      {attachment.type === 'image' && previewUrl ? (
        <img
          src={previewUrl}
          alt={attachment.fileName}
          className="h-8 w-8 rounded object-cover shrink-0"
        />
      ) : attachment.type === 'pdf' ? (
        <FileText className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden />
      ) : (
        <ImageIcon className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden />
      )}
      <span
        className="truncate text-muted-foreground leading-tight"
        title={attachment.fileName}
      >
        {attachment.fileName}
      </span>
      <Button
        data-testid={`attachment-remove-${attachment.id}`}
        type="button"
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0 ml-auto hover:text-destructive"
        onClick={() => onRemove(attachment.id)}
        aria-label={`Remove attachment ${attachment.fileName}`}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

export default AttachmentTile;
