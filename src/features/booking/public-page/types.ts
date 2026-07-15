/**
 * Presentation-only configuration for the public booking page. This is kept
 * in memory by the settings surface; persistence belongs to a future owner.
 */
declare const localBookingImageSourceBrand: unique symbol;

/**
 * A bundled image or a browser-created object URL. The brand prevents an
 * arbitrary remote URL from reaching the public-page image element by type.
 */
export type LocalBookingImageSource = string & {
  readonly [localBookingImageSourceBrand]: true;
};

const bundledImagePath = /^(?:\.?\/)?assets\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/;
const embeddedRasterImage = /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[A-Za-z0-9+/=\s]+$/;

export function isLocalBookingImageSource(value: unknown): value is LocalBookingImageSource {
  if (typeof value !== 'string' || value.length === 0) return false;
  return value.startsWith('blob:') || bundledImagePath.test(value) || embeddedRasterImage.test(value);
}

/** Validates a source before settings code may add it to page branding. */
export function createLocalBookingImageSource(value: string): LocalBookingImageSource {
  if (!isLocalBookingImageSource(value)) {
    throw new Error('[booking-public-page] advisor photo must be a local image source');
  }
  return value;
}

export interface BookingPageBranding {
  firmName: string;
  firmMark: string;
  landingCopy: string;
  advisorName: string;
  advisorTitle: string;
  advisorPhotoSource?: LocalBookingImageSource | undefined;
  meetingTitle: string;
  /** Display copy only; Wave 2 owns the meeting-type model behind it. */
  meetingDetails: string;
  meetingDescription: string;
  disclosure: string;
  privacyLabel: string;
}

export const defaultBookingPageBranding: BookingPageBranding = {
  firmName: 'Northstar Advisory',
  firmMark: 'N',
  landingCopy: 'Thoughtful planning for the life you are building.',
  advisorName: 'Sarah Morgan',
  advisorTitle: 'CFP®',
  meetingTitle: 'Plan your next conversation',
  meetingDetails: '45-minute planning meeting · Microsoft Teams · Mountain Time',
  meetingDescription: 'A planning question, an upcoming decision, or a review of progress since we last met.',
  disclosure: 'Northstar Advisory · Registered investment adviser',
  privacyLabel: 'Privacy & disclosures',
};
