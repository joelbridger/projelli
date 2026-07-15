import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bookingPageRegistry, getBookingPageDescriptor, validateBookingPageDescriptors, type BookingPageDescriptor } from './bookingPageRegistry';

describe('bookingPageRegistry', () => {
  it('resolves the seeded branded public page and its real consumers', async () => {
    const descriptor = getBookingPageDescriptor('branded-public-page');
    expect(descriptor).toBeDefined();
    expect(descriptor?.createHostedLink({ pageId: 'sarah' })).toBe('https://book.lantern.local/p/sarah');
    await expect(descriptor?.loadPublicPage()).resolves.toHaveProperty('BookingPublicPage');
    await expect(descriptor?.loadSettingsPanel()).resolves.toHaveProperty('BookingPageSettings');
  });

  it('rejects duplicate descriptor ids', () => {
    const brandedPage = bookingPageRegistry[0];
    expect(() => {
      validateBookingPageDescriptors([...bookingPageRegistry, brandedPage]);
    }).toThrow('[bookingPageRegistry] duplicate page id: branded-public-page');
  });

  it('rejects missing required fields', () => {
    expect(() => {
      validateBookingPageDescriptors([{ id: 'missing-fields' }]);
    }).toThrow('[bookingPageRegistry] missing required field: labelKey');
  });

  it('runtime-validates the type of every descriptor field', () => {
    const valid = bookingPageRegistry[0];
    const malformed: readonly [keyof BookingPageDescriptor, unknown, string][] = [
      ['id', 42, 'missing required field: id'],
      ['labelKey', {}, 'missing required field: labelKey'],
      ['description', null, 'missing required field: description'],
      ['loadPublicPage', 'not a loader', 'invalid field type: loadPublicPage'],
      ['loadSettingsPanel', 1, 'invalid field type: loadSettingsPanel'],
      ['createHostedLink', false, 'invalid field type: createHostedLink'],
    ];

    for (const [field, value, expectedError] of malformed) {
      expect(() => {
        validateBookingPageDescriptors([{ ...valid, [field]: value }]);
      }, `${field} should be validated at runtime`).toThrow(expectedError);
    }
  });

  it('rejects non-object descriptors', () => {
    expect(() => {
      validateBookingPageDescriptors([null]);
    }).toThrow('[bookingPageRegistry] descriptor must be an object');
  });

  it('documents the Wave 2 availability ownership rule beside the registry', () => {
    const skill = readFileSync(resolve(process.cwd(), 'src/features/booking/public-page/registry/SKILL.md'), 'utf8');
    expect(skill).toContain('Wave 2 `booking-availability` owns the availability model');
    expect(skill).toContain('BookingPageAvailabilityConsumer');
    expect(skill).toContain('Reviewer checks');
  });
});
