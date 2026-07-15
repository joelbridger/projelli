import { createHostedBookingLink } from '../hostedLink';

export interface BookingPageDescriptor {
  /** Stable id. Append a descriptor; never repurpose an existing id. */
  id: string;
  labelKey: string;
  description: string;
  loadPublicPage: () => Promise<typeof import('../BookingPublicPage')>;
  loadSettingsPanel: () => Promise<typeof import('../BookingPageSettings')>;
  createHostedLink: typeof createHostedBookingLink;
}

function requiredString(
  descriptor: Partial<BookingPageDescriptor>,
  field: 'id' | 'labelKey' | 'description',
): void {
  if (typeof descriptor[field] !== 'string' || descriptor[field].trim() === '') {
    throw new Error(`[bookingPageRegistry] missing required field: ${field}`);
  }
}

/** Machine validation for descriptors contributed by future booking page types. */
export function validateBookingPageDescriptors(
  descriptors: readonly Partial<BookingPageDescriptor>[],
): asserts descriptors is readonly BookingPageDescriptor[] {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    requiredString(descriptor, 'id');
    requiredString(descriptor, 'labelKey');
    requiredString(descriptor, 'description');
    if (!descriptor.loadPublicPage || !descriptor.loadSettingsPanel || !descriptor.createHostedLink) {
      throw new Error('[bookingPageRegistry] missing required renderer or hosted-link adapter');
    }
    const id = descriptor.id;
    if (typeof id !== 'string') {
      throw new Error('[bookingPageRegistry] missing required field: id');
    }
    if (ids.has(id)) {
      throw new Error(`[bookingPageRegistry] duplicate page id: ${id}`);
    }
    ids.add(id);
  }
}

/**
 * Append-only public booking-page inventory. Consumers resolve this registry
 * instead of branching on page id in a future hosted route or settings mount.
 */
export const bookingPageRegistry = [
  {
    id: 'branded-public-page',
    labelKey: 'booking-public-page.settings.title',
    description: 'Firm-branded advisor booking page with presentation-only availability.',
    loadPublicPage: () => import('../BookingPublicPage'),
    loadSettingsPanel: () => import('../BookingPageSettings'),
    createHostedLink: createHostedBookingLink,
  },
] as const satisfies readonly BookingPageDescriptor[];

export function getBookingPageDescriptor(id: string): BookingPageDescriptor | undefined {
  validateBookingPageDescriptors(bookingPageRegistry);
  return bookingPageRegistry.find((descriptor) => descriptor.id === id);
}
