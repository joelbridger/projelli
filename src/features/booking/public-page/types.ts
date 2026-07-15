/**
 * Presentation-only configuration for the public booking page. This is kept
 * in memory by the settings surface; persistence belongs to a future owner.
 */
export interface BookingPageBranding {
  firmName: string;
  firmMark: string;
  landingCopy: string;
  advisorName: string;
  advisorTitle: string;
  advisorPhotoUrl?: string | undefined;
  meetingTitle: string;
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
  meetingDescription: 'Choose a time for a focused planning meeting with Sarah.',
  disclosure: 'Northstar Advisory · Registered investment adviser',
  privacyLabel: 'Privacy & disclosures',
};
