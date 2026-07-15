import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setDevFlagOverride } from '@/platform/flags';
import { useFirmStore } from '@/platform/firm/firmStore';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isNotificationPreferences,
  selectNotificationDeliveryIntent,
} from './model';
import {
  createNotificationPreferencesRepository,
  notificationPreferencesStorageKey,
} from './persistence';
import { NotificationPreferencesSettings } from './NotificationPreferencesSettings';

describe('notification preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    setDevFlagOverride('notification-preferences', undefined);
    useFirmStore.setState({ session: null });
  });

  afterEach(() => {
    setDevFlagOverride('notification-preferences', undefined);
  });

  it('validates the frozen preference-only contract and exposes its read-only delivery selector', () => {
    expect(isNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES)).toBe(true);
    expect(
      isNotificationPreferences({
        version: 1,
        categories: { mentions: true, assignments: true, approvals: true },
        deliveryIntent: 'immediate',
      })
    ).toBe(false);
    expect(selectNotificationDeliveryIntent(DEFAULT_NOTIFICATION_PREFERENCES)).toBe(
      'immediate'
    );
  });

  it('persists one user’s choices through a real repository reload without changing another user', () => {
    const firstRepository = createNotificationPreferencesRepository(localStorage);
    firstRepository.save('maya', {
      version: 1,
      categories: {
        mentions: true,
        assignments: false,
        approvals: true,
        reminders: false,
      },
      deliveryIntent: 'digest',
    });

    // A new repository simulates a full application reload against real storage.
    const reloadedRepository = createNotificationPreferencesRepository(localStorage);
    expect(reloadedRepository.load('maya')).toEqual({
      version: 1,
      categories: {
        mentions: true,
        assignments: false,
        approvals: true,
        reminders: false,
      },
      deliveryIntent: 'digest',
    });
    expect(reloadedRepository.getDeliveryIntent('maya')).toBe('digest');
    expect(reloadedRepository.load('david')).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(localStorage.getItem(notificationPreferencesStorageKey('david'))).toBeNull();
  });

  it('keeps a preference usable for this session when storage rejects the write', () => {
    const repository = createNotificationPreferencesRepository({
      getItem: () => null,
      setItem: () => {
        throw new Error('storage is full');
      },
    });
    const next = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      deliveryIntent: 'off' as const,
    };

    expect(() => {
      repository.save('maya', next);
    }).not.toThrow();
    expect(repository.load('maya')).toEqual(next);
    expect(repository.getDeliveryIntent('maya')).toBe('off');
  });

  it('reloads saved values in the settings panel and clearly offers no delivery action', () => {
    const { unmount } = render(<NotificationPreferencesSettings />);
    fireEvent.click(screen.getByTestId('notification-preferences-category-assignments'));
    fireEvent.click(screen.getByTestId('notification-preferences-delivery-digest'));
    expect(screen.getByTestId('notification-preferences-category-assignments')).not.toBeChecked();
    expect(screen.getByTestId('notification-preferences-delivery-digest')).toBeChecked();
    expect(screen.getByTestId('notification-preferences-no-delivery')).toHaveTextContent(
      'saved only'
    );

    unmount();
    render(<NotificationPreferencesSettings />);
    expect(screen.getByTestId('notification-preferences-category-assignments')).not.toBeChecked();
    expect(screen.getByTestId('notification-preferences-delivery-digest')).toBeChecked();
  });

});
