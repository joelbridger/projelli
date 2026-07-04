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
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
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

/**
 * Every profession's words live under `entity-label.<profession>.<field>` in
 * the locale files (en/es/de) — kebab-case keys, mapped here onto the
 * PascalCase-friendly EntityLabel field names (`One`, `Household`, etc.) that
 * dozens of call sites already depend on. Keys are looked up with literal
 * strings (not a template built from `profession`) because the i18next-parser
 * extractor can't trace a dynamic key — see `meetingTypeLabel` in
 * meetingDisplay.ts for the same pattern.
 */
function buildEntityLabel(profession: Profession, t: (key: string) => string): EntityLabel {
  switch (profession) {
    case 'legal':
      return {
        one: t('entity-label.legal.one'),
        other: t('entity-label.legal.other'),
        One: t('entity-label.legal.one-cap'),
        Other: t('entity-label.legal.other-cap'),
        household: t('entity-label.legal.household'),
        households: t('entity-label.legal.households'),
        Household: t('entity-label.legal.household-cap'),
        Households: t('entity-label.legal.households-cap'),
        confidentialityColumn: t('entity-label.legal.confidentiality-column'),
        confidentialityBadge: t('entity-label.legal.confidentiality-badge'),
      };
    case 'tax':
      return {
        one: t('entity-label.tax.one'),
        other: t('entity-label.tax.other'),
        One: t('entity-label.tax.one-cap'),
        Other: t('entity-label.tax.other-cap'),
        household: t('entity-label.tax.household'),
        households: t('entity-label.tax.households'),
        Household: t('entity-label.tax.household-cap'),
        Households: t('entity-label.tax.households-cap'),
        confidentialityColumn: t('entity-label.tax.confidentiality-column'),
        confidentialityBadge: t('entity-label.tax.confidentiality-badge'),
      };
    case 'consulting':
      return {
        one: t('entity-label.consulting.one'),
        other: t('entity-label.consulting.other'),
        One: t('entity-label.consulting.one-cap'),
        Other: t('entity-label.consulting.other-cap'),
        household: t('entity-label.consulting.household'),
        households: t('entity-label.consulting.households'),
        Household: t('entity-label.consulting.household-cap'),
        Households: t('entity-label.consulting.households-cap'),
        confidentialityColumn: t('entity-label.consulting.confidentiality-column'),
        confidentialityBadge: t('entity-label.consulting.confidentiality-badge'),
      };
    case 'advisor':
      return {
        one: t('entity-label.advisor.one'),
        other: t('entity-label.advisor.other'),
        One: t('entity-label.advisor.one-cap'),
        Other: t('entity-label.advisor.other-cap'),
        household: t('entity-label.advisor.household'),
        households: t('entity-label.advisor.households'),
        Household: t('entity-label.advisor.household-cap'),
        Households: t('entity-label.advisor.households-cap'),
        confidentialityColumn: t('entity-label.advisor.confidentiality-column'),
        confidentialityBadge: t('entity-label.advisor.confidentiality-badge'),
      };
    case 'other':
      return {
        one: t('entity-label.other.one'),
        other: t('entity-label.other.other'),
        One: t('entity-label.other.one-cap'),
        Other: t('entity-label.other.other-cap'),
        household: t('entity-label.other.household'),
        households: t('entity-label.other.households'),
        Household: t('entity-label.other.household-cap'),
        Households: t('entity-label.other.households-cap'),
        confidentialityColumn: t('entity-label.other.confidentiality-column'),
        confidentialityBadge: t('entity-label.other.confidentiality-badge'),
      };
  }
}

/**
 * Reactive React hook. Re-renders the component whenever the profession or
 * the active locale changes (e.g. via settings or localStorage toggle).
 *
 * Memoized on (profession, language) so the returned object keeps its
 * identity across unrelated re-renders — callers like AIChatViewer pass this
 * down to memoized children (ChatMessageList/MessageBubble) that depend on
 * referential stability to skip re-rendering the message history.
 */
export function useEntityLabel(): EntityLabel {
  const profession = useProfessionStore((s) => s.profession);
  const { t } = useTranslation();
  // Depend on the global i18n instance's language (not react-i18next's
  // destructured `i18n`, which some tests mock without it) so this stays
  // referentially stable across unrelated re-renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- t's behavior only changes with language, which is already a dep
  return useMemo(() => buildEntityLabel(profession, t), [profession, i18n.language]);
}

/**
 * Non-reactive read for code outside React (utilities, event handlers, etc.).
 * Reads the current Zustand + i18next snapshot; does NOT subscribe to future
 * changes.
 */
export function getEntityLabel(): EntityLabel {
  return buildEntityLabel(getProfession(), i18n.t.bind(i18n));
}
