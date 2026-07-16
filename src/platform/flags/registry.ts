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

function defineFlag<const Id extends string>(
  id: Id,
  description: string,
  ownerLane: string,
  createdAt: string,
  expiresAt: string
) {
  return {
    id,
    description,
    ownerLane,
    createdAt,
    expiresAt,
    defaultEnabled: false,
  } as const;
}

/**
 * Feature-flag inventory. Keep this an append-only array while a flag exists.
 * When a feature graduates, remove its descriptor and every guarded branch in
 * the same change. Every descriptor must stay one physical `defineFlag(...)`
 * line: the union merge driver is line-based and that prevents field weaving.
 */
export const flagRegistry = [
  defineFlag('shared-client-bar', 'Keeps the shared client-context bar dark until the v1 shell is ready.', 'p0c', '2026-07-15', '2026-09-13'),
  defineFlag('record-compliance-dates', 'Keeps written-agreement compliance dates dark until the record-depth review is complete.', 'record-compliance-dates', '2026-07-15', '2026-09-13'),
  defineFlag('record-employment', 'Keeps the Employment household details section dark until its acceptance drive is complete.', 'record-employment', '2026-07-15', '2026-09-13'),
  defineFlag('record-investment-profile', 'Keeps the editable investment profile dark until its record-depth acceptance drive is complete.', 'record-investment-profile', '2026-07-15', '2026-09-13'),
  defineFlag('record-professional-contacts', 'Keeps professional and trusted-contact details dark until their record drive passes.', 'record-professional-contacts', '2026-07-15', '2026-09-13'),
  defineFlag('booking-public-page', 'Keeps the branded public booking-page presentation dark until its hosted route is mounted.', 'booking-public-page', '2026-07-15', '2026-09-13'),
  defineFlag('teams-roles', 'Keeps Organization people, teams, and roles dark until their acceptance drive passes.', 'teams-roles', '2026-07-15', '2026-09-13'),
  defineFlag('crm-trash-recovery', 'Keeps CRM record soft-delete and 30-day recovery dark until acceptance testing passes.', 'crm-trash-recovery', '2026-07-15', '2026-09-13'),
  defineFlag('v1-shell-frame', 'Keeps the permanent v1 navigation and top bar dark until its acceptance drive passes.', 'v1-shell-frame', '2026-07-15', '2026-09-13'),
  defineFlag('internal-projects', 'Keeps internal firm project tracking dark until its CRM acceptance drive is complete.', 'internal-projects', '2026-07-15', '2026-09-13'),
  defineFlag('form-activity', 'Keeps firm-wide form submission activity dark until its acceptance drive is complete.', 'form-activity', '2026-07-15', '2026-09-13'),
  defineFlag('custom-fields-firm', 'Keeps firm-defined CRM custom fields dark until the settings panel has passed acceptance review.', 'custom-fields-firm', '2026-07-15', '2026-09-13'),
  defineFlag('contact-sources', 'Keeps firm contact-source management dark until its acceptance drive is complete.', 'contact-sources', '2026-07-15', '2026-09-13'),
  defineFlag('notification-preferences', 'Keeps personal notification preference capture dark until its acceptance drive is complete.', 'notification-preferences', '2026-07-15', '2026-09-13'),
  defineFlag('custom-fields-advisor', 'Keeps advisor editing of firm-defined custom field values dark until its record review is complete.', 'custom-fields-advisor', '2026-07-15', '2026-09-13'),
  defineFlag('crm-bulk-select', 'Keeps CRM directory household selection dark until its acceptance review is complete.', 'crm-bulk-select', '2026-07-16', '2026-09-14'),
  defineFlag('home-surface-v1', 'Keeps the v1 Home orientation surface dark until its acceptance drive passes.', 'home-surface-v1', '2026-07-16', '2026-09-14'),
  defineFlag('record-member-kebab', 'Keeps the household-member rail and its scoped record actions dark until review is complete.', 'record-member-kebab', '2026-07-16', '2026-09-14'),
  defineFlag('crm-advisor-filters', 'Keeps advanced advisor-field directory filters dark until their acceptance review is complete.', 'crm-advisor-filters', '2026-07-16', '2026-09-14'),
  defineFlag('crm-shell-v1', 'Keeps the CRM v1 frame and destination rail dark until its acceptance review is complete.', 'crm-shell-v1', '2026-07-16', '2026-09-14'),
  defineFlag('settings-shell-v1', 'Keeps the v1 Settings frame dark until its acceptance drive is complete.', 'settings-shell-v1', '2026-07-16', '2026-09-14'),
  defineFlag('own-clients-permissions', 'Keeps own-client permission scoping dark: the read-side policy doorway is present, but the native enforcement engine is deferred, so consumers stay off until provable no-bypass enforcement lands.', 'own-clients-permissions', '2026-07-16', '2026-09-14'),
  defineFlag('universal-tags', 'Keeps firm-wide reusable tag administration dark until its acceptance drive is complete.', 'universal-tags', '2026-07-16', '2026-09-14'),
  defineFlag('crm-merge-clients', 'Keeps advisor-reviewed duplicate household merges dark until acceptance review is complete.', 'crm-merge-clients', '2026-07-16', '2026-09-14'),
] as const satisfies readonly FlagDescriptor[];

export type FlagId = (typeof flagRegistry)[number]['id'];
