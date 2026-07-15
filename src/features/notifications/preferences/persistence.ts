import {
  cloneNotificationPreferences,
  DEFAULT_NOTIFICATION_PREFERENCES,
  isNotificationPreferences,
  type NotificationDeliveryIntent,
  type NotificationPreferences,
} from './model';

export interface NotificationPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_PREFIX = 'lantern:notification-preferences:';

export function notificationPreferencesStorageKey(userId: string): string {
  if (!userId.trim()) throw new Error('A notification preference user id is required.');
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}`;
}

function browserStorage(): NotificationPreferencesStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

function readStoredPreferences(
  storage: NotificationPreferencesStorage | undefined,
  userId: string
): NotificationPreferences {
  if (!storage) return cloneNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
  try {
    const raw = storage.getItem(notificationPreferencesStorageKey(userId));
    if (!raw) return cloneNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
    const parsed: unknown = JSON.parse(raw);
    return isNotificationPreferences(parsed)
      ? cloneNotificationPreferences(parsed)
      : cloneNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
  } catch {
    return cloneNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
  }
}

/** Per-user, local preference persistence. It has no network or native side effects. */
export function createNotificationPreferencesRepository(
  storage: NotificationPreferencesStorage | undefined = browserStorage()
) {
  // Storage can be blocked or full in a browser profile. Keep a session copy so
  // a chosen preference still takes effect in the currently open app.
  const sessionPreferences = new Map<string, NotificationPreferences>();
  const load = (userId: string): NotificationPreferences => {
    const sessionValue = sessionPreferences.get(
      notificationPreferencesStorageKey(userId)
    );
    if (sessionValue) return cloneNotificationPreferences(sessionValue);
    return readStoredPreferences(storage, userId);
  };

  return {
    load,
    save(userId: string, preferences: NotificationPreferences): void {
      if (!isNotificationPreferences(preferences)) {
        throw new Error('Notification preferences are invalid.');
      }
      const next = cloneNotificationPreferences(preferences);
      const key = notificationPreferencesStorageKey(userId);
      sessionPreferences.set(key, next);
      if (!storage) return;
      try {
        storage.setItem(key, JSON.stringify(next));
      } catch {
        // The in-memory value above preserves the user's current-session choice.
        console.warn(
          '[notification-preferences] Storage write failed; keeping the preference for this session only.'
        );
      }
    },
    /** Read-only selector intended for future delivery-channel lanes. */
    getDeliveryIntent(userId: string): NotificationDeliveryIntent {
      return load(userId).deliveryIntent;
    },
  };
}

export const notificationPreferencesRepository =
  createNotificationPreferencesRepository();
