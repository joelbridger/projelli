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

type DescriptorField = keyof BookingPageDescriptor;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(descriptor: Record<string, unknown>, field: Extract<DescriptorField, 'id' | 'labelKey' | 'description'>): string {
  const value = descriptor[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`[bookingPageRegistry] missing required field: ${field}`);
  }
  return value;
}

function requiredFunction(descriptor: Record<string, unknown>, field: Exclude<DescriptorField, 'id' | 'labelKey' | 'description'>): void {
  if (typeof descriptor[field] !== 'function') {
    throw new Error(`[bookingPageRegistry] invalid field type: ${field} (expected function)`);
  }
}

/** Machine validation for descriptors contributed by future booking page types. */
export function validateBookingPageDescriptors(descriptors: readonly unknown[]): asserts descriptors is readonly BookingPageDescriptor[] {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (!isRecord(descriptor)) {
      throw new Error('[bookingPageRegistry] descriptor must be an object');
    }
    const id = requiredString(descriptor, 'id');
    requiredString(descriptor, 'labelKey');
    requiredString(descriptor, 'description');
    requiredFunction(descriptor, 'loadPublicPage');
    requiredFunction(descriptor, 'loadSettingsPanel');
    requiredFunction(descriptor, 'createHostedLink');
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

validateBookingPageDescriptors(bookingPageRegistry);

export function getBookingPageDescriptor(id: string): BookingPageDescriptor | undefined {
  validateBookingPageDescriptors(bookingPageRegistry);
  return bookingPageRegistry.find((descriptor) => descriptor.id === id);
}
