import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';

export interface NotificationBellSlotDescriptor {
  render: () => ReactNode;
}

export interface NotificationBellSlotProps {
  slot?: NotificationBellSlotDescriptor | undefined;
}

function DefaultNotificationBell() {
  const { t } = useTranslation();

  return (
    <span
      aria-label={t('shell-frame.notifications.placeholder')}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500"
      data-testid="v1-shell-notification-slot"
      role="img"
    >
      <Bell aria-hidden="true" className="size-4" />
    </span>
  );
}

export function NotificationBellSlot({ slot }: NotificationBellSlotProps) {
  if (slot) return slot.render();

  return <DefaultNotificationBell />;
}
