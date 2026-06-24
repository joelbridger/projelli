/**
 * useEntityLabel / getEntityLabel
 *
 * Returns the profession-appropriate term for a "matter" so every vertical
 * sees the language of their own practice:
 *
 *   legal     → matter / matters / Matter / Matters
 *   tax       → client / clients / Client / Clients
 *   consulting→ engagement / engagements / Engagement / Engagements
 *   advisor   → client / clients / Client / Clients
 *               household / households / Household / Households (advisor only)
 *   other     → matter / matters / Matter / Matters  (safe default)
 *
 * Shape:
 *   {
 *     one, other, One, Other,
 *     household, households, Household, Households,
 *     confidentialityColumn, confidentialityBadge
 *   }
 *   one        – lowercase singular  e.g. "matter"
 *   other      – lowercase plural    e.g. "matters"
 *   One        – capitalized singular e.g. "Matter"
 *   Other      – capitalized plural   e.g. "Matters"
 *   household  – lowercase singular group noun  (advisor: "household"; others mirror `one`)
 *   households – lowercase plural group noun    (advisor: "households"; others mirror `other`)
 *   Household  – capitalized singular group noun (advisor: "Household"; others mirror `One`)
 *   Households – capitalized plural group noun   (advisor: "Households"; others mirror `Other`)
 *   confidentialityColumn – visible label for the internal `privileged` flag
 *   confidentialityBadge  – visible badge text for a flagged record
 *
 * Internal Matter type, ids, store names, and SAMPLE_MATTER_ID are NEVER
 * changed by this hook; only the visible words adapt.
 */
import { useProfessionStore, getProfession } from '@/platform/profile/professionStore';
import type { Profession } from '@/platform/profile/professionModel';

export interface EntityLabel {
  /** lowercase singular  – "matter" / "client" / "engagement" */
  one: string;
  /** lowercase plural    – "matters" / "clients" / "engagements" */
  other: string;
  /** capitalized singular – "Matter" / "Client" / "Engagement" */
  One: string;
  /** capitalized plural   – "Matters" / "Clients" / "Engagements" */
  Other: string;
  /** lowercase singular group noun – "household" for advisor, mirrors `one` for others */
  household: string;
  /** lowercase plural group noun – "households" for advisor, mirrors `other` for others */
  households: string;
  /** capitalized singular group noun – "Household" for advisor, mirrors `One` for others */
  Household: string;
  /** capitalized plural group noun – "Households" for advisor, mirrors `Other` for others */
  Households: string;
  /** Column label for the internal privileged/sensitive flag */
  confidentialityColumn: string;
  /** Badge label for an item with the internal privileged/sensitive flag */
  confidentialityBadge: string;
}

const LABELS: Record<Profession, EntityLabel> = {
  legal: {
    one: 'matter',
    other: 'matters',
    One: 'Matter',
    Other: 'Matters',
    household: 'matter',
    households: 'matters',
    Household: 'Matter',
    Households: 'Matters',
    confidentialityColumn: 'Privilege',
    confidentialityBadge: 'Privileged',
  },
  tax: {
    one: 'client',
    other: 'clients',
    One: 'Client',
    Other: 'Clients',
    household: 'client',
    households: 'clients',
    Household: 'Client',
    Households: 'Clients',
    confidentialityColumn: 'Confidential',
    confidentialityBadge: 'Confidential',
  },
  consulting: {
    one: 'engagement',
    other: 'engagements',
    One: 'Engagement',
    Other: 'Engagements',
    household: 'engagement',
    households: 'engagements',
    Household: 'Engagement',
    Households: 'Engagements',
    confidentialityColumn: 'Confidential',
    confidentialityBadge: 'Confidential',
  },
  advisor: {
    one: 'client',
    other: 'clients',
    One: 'Client',
    Other: 'Clients',
    household: 'household',
    households: 'households',
    Household: 'Household',
    Households: 'Households',
    confidentialityColumn: 'Sensitive',
    confidentialityBadge: 'Sensitive',
  },
  other: {
    one: 'matter',
    other: 'matters',
    One: 'Matter',
    Other: 'Matters',
    household: 'matter',
    households: 'matters',
    Household: 'Matter',
    Households: 'Matters',
    confidentialityColumn: 'Sensitive',
    confidentialityBadge: 'Sensitive',
  },
};

/**
 * Reactive React hook. Re-renders the component whenever the profession
 * changes (e.g. via settings or localStorage toggle).
 */
export function useEntityLabel(): EntityLabel {
  const profession = useProfessionStore((s) => s.profession);
  return LABELS[profession];
}

/**
 * Non-reactive read for code outside React (utilities, event handlers, etc.).
 * Reads the current Zustand snapshot; does NOT subscribe to future changes.
 */
export function getEntityLabel(): EntityLabel {
  return LABELS[getProfession()];
}
