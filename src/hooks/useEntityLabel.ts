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
 *   other     → matter / matters / Matter / Matters  (safe default)
 *
 * Shape: { one, other, One, Other }
 *   one   – lowercase singular  e.g. "matter"
 *   other – lowercase plural    e.g. "matters"
 *   One   – capitalized singular e.g. "Matter"
 *   Other – capitalized plural   e.g. "Matters"
 *
 * Internal Matter type, ids, store names, and SAMPLE_MATTER_ID are NEVER
 * changed by this hook; only the visible words adapt.
 */
import { useProfessionStore, getProfession } from '@/platform/profile/professionStore';
import type { Profession } from '@/onboarding/professionModel';

export interface EntityLabel {
  /** lowercase singular  – "matter" / "client" / "engagement" */
  one: string;
  /** lowercase plural    – "matters" / "clients" / "engagements" */
  other: string;
  /** capitalized singular – "Matter" / "Client" / "Engagement" */
  One: string;
  /** capitalized plural   – "Matters" / "Clients" / "Engagements" */
  Other: string;
}

const LABELS: Record<Profession, EntityLabel> = {
  legal: {
    one: 'matter',
    other: 'matters',
    One: 'Matter',
    Other: 'Matters',
  },
  tax: {
    one: 'client',
    other: 'clients',
    One: 'Client',
    Other: 'Clients',
  },
  consulting: {
    one: 'engagement',
    other: 'engagements',
    One: 'Engagement',
    Other: 'Engagements',
  },
  advisor: {
    one: 'client',
    other: 'clients',
    One: 'Client',
    Other: 'Clients',
  },
  other: {
    one: 'matter',
    other: 'matters',
    One: 'Matter',
    Other: 'Matters',
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
