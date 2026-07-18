import type { ReactNode } from 'react';

/**
 * Closed, augmentable IDs for Account-window sections.
 *
 * Each section owner extends this map beside its descriptor. Deliberately omit
 * a string index signature so a misspelled or unregistered id fails typecheck.
 */
export interface AccountSectionIdMap {}

export type AccountSectionId = Extract<keyof AccountSectionIdMap, string>;

/**
 * Closed, augmentable IDs for Account connection cards.
 *
 * Each connector extends this map beside its card descriptor.
 */
export interface ConnectionCardIdMap {}

export type ConnectionCardId = Extract<keyof ConnectionCardIdMap, string>;

export type ConnectionCardPlacement = 'connections' | 'developer-tools';

/** A platform connector's Account card contract. */
export interface ConnectionCardDescriptor {
  id: ConnectionCardId;
  labelKey: string;
  /** Plain advisor-facing provider name. Never render the translation key. */
  displayName: string;
  placement: ConnectionCardPlacement;
  order: number;
  /** The connector's one shared setup/status/disconnect surface. */
  render: () => ReactNode;
  /** Authoritative connection proof. Rejection or false means not active. */
  isConnected?: () => Promise<boolean>;
}
