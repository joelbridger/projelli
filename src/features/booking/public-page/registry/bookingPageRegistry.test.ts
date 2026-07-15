import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bookingPageRegistry,
  getBookingPageDescriptor,
  validateBookingPageDescriptors,
} from './bookingPageRegistry';

describe('bookingPageRegistry', () => {
  it('resolves the seeded branded public page and its real consumers', async () => {
    const descriptor = getBookingPageDescriptor('branded-public-page');
    expect(descriptor).toBeDefined();
    expect(descriptor?.createHostedLink({ pageId: 'sarah' })).toBe('https://book.lantern.local/p/sarah');
    await expect(descriptor?.loadPublicPage()).resolves.toHaveProperty('BookingPublicPage');
    await expect(descriptor?.loadSettingsPanel()).resolves.toHaveProperty('BookingPageSettings');
  });

  it('rejects duplicate descriptor ids', () => {
    expect(() => validateBookingPageDescriptors([...bookingPageRegistry, bookingPageRegistry[0]!]))
      .toThrow('[bookingPageRegistry] duplicate page id: branded-public-page');
  });

  it('rejects missing required fields', () => {
    expect(() => validateBookingPageDescriptors([{ id: 'missing-fields' }]))
      .toThrow('[bookingPageRegistry] missing required field: labelKey');
  });

  it('documents the Wave 2 availability ownership rule beside the registry', () => {
    const skill = readFileSync(
      resolve(process.cwd(), 'src/features/booking/public-page/registry/SKILL.md'),
      'utf8',
    );
    expect(skill).toContain('Wave 2 `booking-availability` owns the availability model');
    expect(skill).toContain('BookingPageAvailabilityConsumer');
  });
});
