import type { ReactNode } from 'react';
import { Bell } from 'lucide-react';
import i18n from '@/i18n';

export interface NotificationBellSlotDescriptor {
  render: () => ReactNode;
}

export interface NotificationBellSlotProps {
  slot?: NotificationBellSlotDescriptor | undefined;
}

export function NotificationBellSlot({ slot }: NotificationBellSlotProps) {
  if (slot) return slot.render();

  return (
    <span
      aria-label={i18n.t('shell-frame.notifications.placeholder')}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500"
      data-testid="v1-shell-notification-slot"
      role="img"
    >
      <Bell aria-hidden="true" className="size-4" />
    </span>
  );
}
