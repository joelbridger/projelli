/**
 * The complete feature-flag inventory. Add entries here only; never create a
 * second list in a feature, test, or build script. Entries are append-only
 * until their flag and guarded code are removed together.
 */
export interface FlagDescriptor {
  /** Stable kebab-case identifier used by the router. */
  id: string;
  /** What is being protected and why it is still dark. */
  description: string;
  /** The delivery lane that owns removal of this flag. */
  ownerLane: string;
  /** ISO calendar date (YYYY-MM-DD). */
  createdAt: string;
  /** ISO calendar date by which the flag must be removed or deliberately extended. */
  expiresAt: string;
  /** Flags ship dark unless a production build explicitly enables one. */
  defaultEnabled: false;
}

/**
 * Feature-flag inventory. Keep this an append-only array while a flag exists.
 * When a feature graduates, remove its descriptor and every guarded branch in
 * the same change. The expiry test and cleanup lane make forgotten flags loud.
 */
export const flagRegistry = [
  {
    id: 'shared-client-bar',
    description:
      'Keeps the shared client-context bar dark until the v1 shell is ready.',
    ownerLane: 'p0c',
    createdAt: '2026-07-15',
    expiresAt: '2026-09-13',
    defaultEnabled: false,
  },
  {
    id: 'record-compliance-dates',
    description:
      'Keeps written-agreement compliance dates dark until the record-depth review is complete.',
    ownerLane: 'record-compliance-dates',
    createdAt: '2026-07-15',
    expiresAt: '2026-09-13',
    defaultEnabled: false,
  },
  {
    id: 'record-employment',
    description:
      'Keeps the Employment household details section dark until its acceptance drive is complete.',
    ownerLane: 'record-employment',
    createdAt: '2026-07-15',
    expiresAt: '2026-09-13',
    defaultEnabled: false,
  },
  {
    id: 'record-investment-profile',
    description:
      'Keeps the editable investment profile dark until its record-depth acceptance drive is complete.',
    ownerLane: 'record-investment-profile',
    createdAt: '2026-07-15',
    expiresAt: '2026-09-13',
    defaultEnabled: false,
  },
  {
    id: 'record-professional-contacts',
    description:
      'Keeps professional and trusted-contact details dark until their record drive passes.',
    ownerLane: 'record-professional-contacts',
    createdAt: '2026-07-15',
    expiresAt: '2026-09-13',
    defaultEnabled: false,
  },
  {
    id: 'booking-public-page',
    description:
      'Keeps the branded public booking-page presentation dark until its hosted route is mounted.',
    ownerLane: 'booking-public-page',
    createdAt: '2026-07-15',
    expiresAt: '2026-09-13',
    defaultEnabled: false,
  },
  {
    id: 'teams-roles',
    description:
      'Keeps Organization people, teams, and roles dark until their acceptance drive passes.',
    ownerLane: 'teams-roles',
    createdAt: '2026-07-15',
    expiresAt: '2026-09-13',
    defaultEnabled: false,
  },
  {
    id: 'crm-trash-recovery',
    description: 'Keeps CRM record soft-delete and 30-day recovery dark until acceptance testing passes.',
    ownerLane: 'crm-trash-recovery',
    createdAt: '2026-07-15',
    expiresAt: '2026-09-13',
    defaultEnabled: false,
  },
  {
    id: 'v1-shell-frame',
    description:
      'Keeps the permanent v1 navigation and top bar dark until its acceptance drive passes.',
    ownerLane: 'v1-shell-frame',
    createdAt: '2026-07-15',
    expiresAt: '2026-09-13',
    defaultEnabled: false,
  },
  {
    id: 'internal-projects',
    description:
      'Keeps internal firm project tracking dark until its CRM acceptance drive is complete.',
    ownerLane: 'internal-projects',
    createdAt: '2026-07-15',
    expiresAt: '2026-09-13',
    defaultEnabled: false,
  },
  {
    id: 'form-activity',
    description:
      'Keeps firm-wide form submission activity dark until its acceptance drive is complete.',
    ownerLane: 'form-activity',
    createdAt: '2026-07-15',
    expiresAt: '2026-09-13',
    defaultEnabled: false,
  },
  {
    id: 'notification-preferences',
    description:
      'Keeps personal notification preference capture dark until its acceptance drive is complete.',
    ownerLane: 'notification-preferences',
    createdAt: '2026-07-15',
    expiresAt: '2026-09-13',
    defaultEnabled: false,
  },
] as const satisfies readonly FlagDescriptor[];

export type FlagId = (typeof flagRegistry)[number]['id'];
