import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFirmStore } from '@/platform/firm/firmStore';
import {
  NOTIFICATION_ACTIVITY_CATEGORIES,
  NOTIFICATION_DELIVERY_INTENTS,
  type NotificationActivityCategory,
  type NotificationDeliveryIntent,
  type NotificationPreferences,
} from './model';
import { notificationPreferencesRepository } from './persistence';

const panel = {
  border: '1px solid var(--kp-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)',
  padding: 'var(--kp-space-md)',
} as const;

const muted = {
  color: 'var(--kp-text-faint)',
  fontSize: 'var(--kp-font-sm)',
} as const;

function categoryLabel(
  translate: (key: string) => string,
  category: NotificationActivityCategory
): string {
  switch (category) {
    case 'mentions':
      return translate('notification-preferences.categories.mentions');
    case 'assignments':
      return translate('notification-preferences.categories.assignments');
    case 'approvals':
      return translate('notification-preferences.categories.approvals');
    case 'reminders':
      return translate('notification-preferences.categories.reminders');
  }
}

function deliveryIntentLabel(
  translate: (key: string) => string,
  intent: NotificationDeliveryIntent
): string {
  switch (intent) {
    case 'immediate':
      return translate('notification-preferences.delivery.immediate');
    case 'digest':
      return translate('notification-preferences.delivery.digest');
    case 'off':
      return translate('notification-preferences.delivery.off');
  }
}

/** Preference capture only. It deliberately has no notification delivery behavior. */
export function NotificationPreferencesSettings() {
  const { t } = useTranslation();
  const userId = useFirmStore((state) => state.session?.userId ?? 'local-user');
  const [preferences, setPreferences] = useState<NotificationPreferences>(() =>
    notificationPreferencesRepository.load(userId)
  );

  useEffect(() => {
    setPreferences(notificationPreferencesRepository.load(userId));
  }, [userId]);

  const update = (next: NotificationPreferences) => {
    notificationPreferencesRepository.save(userId, next);
    setPreferences(next);
  };

  return (
    <section data-testid="notification-preferences-panel" style={panel}>
      <h2 style={{ marginTop: 0 }}>{t('notification-preferences.title')}</h2>
      <p style={muted}>{t('notification-preferences.description')}</p>
      <p data-testid="notification-preferences-no-delivery" style={muted}>
        {t('notification-preferences.no-delivery')}
      </p>

      <fieldset style={{ border: 0, margin: '20px 0 0', padding: 0 }}>
        <legend>{t('notification-preferences.categories-title')}</legend>
        <p style={muted}>{t('notification-preferences.categories-description')}</p>
        {NOTIFICATION_ACTIVITY_CATEGORIES.map((category) => (
          <label
            key={category}
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}
          >
            <input
              checked={preferences.categories[category]}
              data-testid={`notification-preferences-category-${category}`}
              type="checkbox"
              onChange={(event) => {
                update({
                  ...preferences,
                  categories: {
                    ...preferences.categories,
                    [category]: event.target.checked,
                  },
                })
              }}
            />
            {categoryLabel(t, category)}
          </label>
        ))}
      </fieldset>

      <fieldset style={{ border: 0, margin: '20px 0 0', padding: 0 }}>
        <legend>{t('notification-preferences.delivery-title')}</legend>
        <p style={muted}>{t('notification-preferences.delivery-description')}</p>
        {NOTIFICATION_DELIVERY_INTENTS.map((intent) => (
          <label
            key={intent}
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}
          >
            <input
              checked={preferences.deliveryIntent === intent}
              data-testid={`notification-preferences-delivery-${intent}`}
              name="notification-delivery-intent"
              type="radio"
              value={intent}
              onChange={() => {
                update({ ...preferences, deliveryIntent: intent });
              }}
            />
            {deliveryIntentLabel(t, intent)}
          </label>
        ))}
      </fieldset>
    </section>
  );
}
