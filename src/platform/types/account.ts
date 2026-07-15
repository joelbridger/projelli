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
