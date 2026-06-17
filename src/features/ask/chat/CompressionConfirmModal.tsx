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

import { useTranslation, Trans } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { formatContextSize } from '@/platform/providers/context-limits';

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
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen) onCancel(); }}>
      <DialogContent data-testid="compression-confirm-modal">
        <DialogHeader>
          <DialogTitle>{t('chat.compression.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          <Trans
            i18nKey="chat.compression.body"
            components={{
              s: <strong data-testid="modal-current-tokens" />,
            }}
            values={{
              current: formatContextSize(currentTokens),
              limit: formatContextSize(limitTokens),
              projected: formatContextSize(projectedAfter),
            }}
          />
        </p>
        <DialogFooter className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t('chat.compression.cancel')}
          </Button>
          <Button variant="outline" onClick={onSendAnyway} data-testid="modal-send-anyway-btn">
            {t('chat.compression.send-anyway')}
          </Button>
          <Button onClick={onCompress} data-testid="modal-compress-btn">
            {t('chat.compression.compress-send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CompressionConfirmModal;
