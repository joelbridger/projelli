/**
 * Stream A4 — confirmation modal shown before auto-triggered compression.
 *
 * Appears when a send would exceed the chatContextTokenLimit. Shows
 * before/after token estimates and gives the user Compress + Send or
 * Send Anyway options.
 *
 * Props:
 *   currentTokens   - tokens that would be sent without compression
 *   limitTokens     - the configured context token limit
 *   projectedAfter  - estimated tokens after compression
 *   onCompress      - user chose "Compress + Send"
 *   onSendAnyway    - user chose "Send Anyway"
 *   onCancel        - user dismissed
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatContextSize } from '@/modules/models/context-limits';

export interface CompressionConfirmModalProps {
  open: boolean;
  currentTokens: number;
  limitTokens: number;
  projectedAfter: number;
  onCompress: () => void;
  onSendAnyway: () => void;
  onCancel: () => void;
}

export function CompressionConfirmModal({
  open,
  currentTokens,
  limitTokens,
  projectedAfter,
  onCompress,
  onSendAnyway,
  onCancel,
}: CompressionConfirmModalProps) {
  return (
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen) onCancel(); }}>
      <DialogContent data-testid="compression-confirm-modal">
        <DialogHeader>
          <DialogTitle>Context is full</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This send would use{' '}
          <strong data-testid="modal-current-tokens">{formatContextSize(currentTokens)}</strong>{' '}
          tokens, over your {formatContextSize(limitTokens)} limit. Compress older messages to free
          space ({formatContextSize(projectedAfter)} tokens after compression) or send anyway.
        </p>
        <DialogFooter className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onSendAnyway} data-testid="modal-send-anyway-btn">
            Send Anyway
          </Button>
          <Button onClick={onCompress} data-testid="modal-compress-btn">
            Compress + Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CompressionConfirmModal;
