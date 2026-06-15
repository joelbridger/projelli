import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

export interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  /** Header content (left side); the close button is added on the right. */
  title?: ReactNode;
  width?: number;
  closeLabel?: string;
  children: ReactNode;
  'data-testid'?: string;
}

/** Right-edge detail drawer over a dimmed scrim. Click the scrim or the X to close. */
export function SlidePanel({
  open,
  onClose,
  title,
  width = 420,
  closeLabel = 'Close',
  children,
  'data-testid': testId,
}: SlidePanelProps) {
  if (!open) return null;
  return (
    <div className="kp-overlay" style={{ justifyContent: 'flex-end' }} onClick={onClose}>
      <div
        className="kp-slide-panel"
        style={{ width, maxWidth: '90vw' }}
        role="dialog"
        aria-modal="true"
        data-testid={testId}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="kp-slide-panel__header">
          <div style={{ minWidth: 0, flex: 1 }}>{title}</div>
          <IconButton icon={X} label={closeLabel} variant="secondary" size="sm" onClick={onClose} />
        </div>
        <div className="kp-slide-panel__body">{children}</div>
      </div>
    </div>
  );
}
