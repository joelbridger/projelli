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
    id: 'teams-roles',
    description:
      'Keeps Organization people, teams, and roles dark until their acceptance drive passes.',
    ownerLane: 'teams-roles',
    createdAt: '2026-07-15',
    expiresAt: '2026-09-13',
    defaultEnabled: false,
  },
  {
    id: 'own-clients-permissions',
    description:
      'Keeps native household ownership and assignment enforcement dark until its acceptance drive passes.',
    ownerLane: 'own-clients-permissions',
    createdAt: '2026-07-15',
    expiresAt: '2026-09-13',
    defaultEnabled: false,
  },
] as const satisfies readonly FlagDescriptor[];

export type FlagId = (typeof flagRegistry)[number]['id'];
