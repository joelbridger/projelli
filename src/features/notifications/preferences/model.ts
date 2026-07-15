/**
 * Personal notification choices. This is deliberately a preference-only
 * contract: it records what a future delivery lane may read, but it does not
 * schedule, send, or acknowledge a notification.
 */
export const NOTIFICATION_ACTIVITY_CATEGORIES = [
  'mentions',
  'assignments',
  'approvals',
  'reminders',
] as const;

export type NotificationActivityCategory =
  (typeof NOTIFICATION_ACTIVITY_CATEGORIES)[number];

/** A future delivery channel reads this intent; this feature never delivers. */
export const NOTIFICATION_DELIVERY_INTENTS = [
  'immediate',
  'digest',
  'off',
] as const;

export type NotificationDeliveryIntent =
  (typeof NOTIFICATION_DELIVERY_INTENTS)[number];

export interface NotificationPreferences {
  readonly version: 1;
  readonly categories: Readonly<Record<NotificationActivityCategory, boolean>>;
  readonly deliveryIntent: NotificationDeliveryIntent;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  version: 1,
  categories: {
    mentions: true,
    assignments: true,
    approvals: true,
    reminders: true,
  },
  deliveryIntent: 'immediate',
};

export function cloneNotificationPreferences(
  preferences: NotificationPreferences
): NotificationPreferences {
  return {
    version: 1,
    categories: { ...preferences.categories },
    deliveryIntent: preferences.deliveryIntent,
  };
}

export function isNotificationDeliveryIntent(
  value: unknown
): value is NotificationDeliveryIntent {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_DELIVERY_INTENTS as readonly string[]).includes(value)
  );
}

/** Reject malformed persisted input instead of guessing which settings apply. */
export function isNotificationPreferences(
  value: unknown
): value is NotificationPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['version'] !== 1 ||
    !isNotificationDeliveryIntent(candidate['deliveryIntent'])
  ) {
    return false;
  }
  if (!candidate['categories'] || typeof candidate['categories'] !== 'object') {
    return false;
  }
  const categories = candidate['categories'] as Record<string, unknown>;
  return NOTIFICATION_ACTIVITY_CATEGORIES.every(
    (category) => typeof categories[category] === 'boolean'
  );
}

/**
 * Stable, read-only selector for Wave 4 delivery lanes. It is pure so future
 * channel code can use the exact preference contract without owning storage.
 */
export function selectNotificationDeliveryIntent(
  preferences: NotificationPreferences
): NotificationDeliveryIntent {
  return preferences.deliveryIntent;
}
