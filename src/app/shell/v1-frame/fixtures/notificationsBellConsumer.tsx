import {
  type NotificationBellSlotDescriptor,
  V1ShellFrame,
} from '@/app/shell/v1-frame';

const notificationBellSlot: NotificationBellSlotDescriptor = {
  render: () => (
    <button aria-label="Open fixture notifications" type="button">
      Fixture notifications
    </button>
  ),
};

export function NotificationsBellConsumerFixture() {
  return (
    <V1ShellFrame
      activeSurface="home"
      notificationBellSlot={notificationBellSlot}
      onOpenCommandPalette={() => {}}
      onSurfaceChange={() => {}}
    >
      <div>Fixture surface</div>
    </V1ShellFrame>
  );
}
