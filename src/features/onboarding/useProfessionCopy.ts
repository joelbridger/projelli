/**
 * useProfessionCopy / getProfessionCopy
 *
 * Returns profession-appropriate framing phrases so every vertical sees trust
 * and confidentiality language that matches their own practice, not legal copy
 * borrowed from law.
 *
 * Shape (ProfessionCopy):
 *
 *   confidentialityTerm
 *     The protection that applies to the user's client work.
 *     legal:            "attorney-client privilege"
 *     tax:              "client and return confidentiality"
 *     consulting:       "engagement confidentiality"
 *     advisor:          "client confidentiality"
 *     other:            "client confidentiality"
 *
 *   confidentialityShort
 *     A shorter form for tight UI spaces (e.g. pill labels, inline phrases).
 *     legal:            "privilege"
 *     tax:              "return confidentiality"
 *     consulting:       "engagement confidentiality"
 *     advisor/other:    "client confidentiality"
 *
 *   clientWorkPhrase
 *     A short "your client work" phrase that reads naturally for the vertical.
 *     legal:            "your client matters"
 *     tax:              "your client tax files"
 *     consulting:       "your client engagements"
 *     advisor:          "your client files"
 *     other:            "your client work"
 *
 *   sensitiveWorkDesc
 *     What to call the most sensitive work in the "nothing-leaves" path copy.
 *     legal:            "your most sensitive client matters"
 *     tax:              "your most sensitive returns"
 *     consulting:       "your most sensitive engagements"
 *     advisor:          "your most sensitive client files"
 *     other:            "your most sensitive work"
 *
 *   practiceNoun
 *     How to refer to the user's practice in one short noun phrase.
 *     legal:            "practice"        (as in "a solo or firm practice")
 *     tax:              "practice"
 *     consulting:       "practice"
 *     advisor:          "practice"
 *     other:            "work"
 *
 *   soloOrTeamDesc
 *     Subtitle on the Firm step describing what "solo vs team" looks like.
 *     legal:            "Keepance works just as well for a solo practitioner as it does for a full firm."
 *     tax:              "Keepance works just as well for a solo practice as it does for an accounting firm."
 *     consulting:       "Keepance works just as well on your own as it does for a consulting team."
 *     advisor:          "Keepance works just as well for a solo advisor as it does for a full advisory team."
 *     other:            "Keepance works just as well on your own as it does for a team."
 *
 *   estimatedCostDesc
 *     Short sentence used in the AI-setup cloud path card.
 *     legal:            "Most solo practitioners spend about $2 to $5 a month, billed by your AI provider, not us."
 *     tax:              "Most tax practitioners spend about $2 to $5 a month, billed by your AI provider, not us."
 *     consulting:       "Most consultants spend about $2 to $5 a month, billed by your AI provider, not us."
 *     advisor:          "Most advisors spend about $2 to $5 a month, billed by your AI provider, not us."
 *     other:            "Most users spend about $2 to $5 a month, billed by your AI provider, not us."
 *
 * Internal privilege store, code names, and the email privilege tagger are
 * intentionally NOT changed here. Those are a legal FEATURE (Attorney-Client
 * Privileged / Work Product) that must remain legal-specific regardless of the
 * user's profession setting.
 */
import { useProfessionStore, getProfession } from '@/platform/profile/professionStore';
import type { Profession } from '@/onboarding/professionModel';

export interface ProfessionCopy {
  /**
   * The protection term that applies to the user's client work.
   * e.g. "attorney-client privilege", "client and return confidentiality"
   */
  confidentialityTerm: string;
  /**
   * Shorter form for tight spaces (pills, inline phrases).
   * e.g. "privilege", "return confidentiality"
   */
  confidentialityShort: string;
  /**
   * Short "your client work" phrase that reads naturally for the vertical.
   */
  clientWorkPhrase: string;
  /**
   * Phrase for the most sensitive work in "nothing-leaves" copy.
   */
  sensitiveWorkDesc: string;
  /**
   * Short noun for the user's practice.
   */
  practiceNoun: string;
  /**
   * Subtitle for the Firm step, describing solo vs team.
   */
  soloOrTeamDesc: string;
  /**
   * Cost sentence for the cloud AI path card.
   */
  estimatedCostDesc: string;
}

const COPY: Record<Profession, ProfessionCopy> = {
  legal: {
    confidentialityTerm: 'attorney-client privilege',
    confidentialityShort: 'privilege',
    clientWorkPhrase: 'your client matters',
    sensitiveWorkDesc: 'your most sensitive client matters',
    practiceNoun: 'practice',
    soloOrTeamDesc: 'Keepance works just as well for a solo practitioner as it does for a full firm.',
    estimatedCostDesc: 'Most solo practitioners spend about $2 to $5 a month, billed by your AI provider, not us.',
  },
  tax: {
    confidentialityTerm: 'client and return confidentiality',
    confidentialityShort: 'return confidentiality',
    clientWorkPhrase: 'your client tax files',
    sensitiveWorkDesc: 'your most sensitive returns',
    practiceNoun: 'practice',
    soloOrTeamDesc: 'Keepance works just as well for a solo practice as it does for an accounting firm.',
    estimatedCostDesc: 'Most tax practitioners spend about $2 to $5 a month, billed by your AI provider, not us.',
  },
  consulting: {
    confidentialityTerm: 'engagement confidentiality',
    confidentialityShort: 'engagement confidentiality',
    clientWorkPhrase: 'your client engagements',
    sensitiveWorkDesc: 'your most sensitive engagements',
    practiceNoun: 'practice',
    soloOrTeamDesc: 'Keepance works just as well on your own as it does for a consulting team.',
    estimatedCostDesc: 'Most consultants spend about $2 to $5 a month, billed by your AI provider, not us.',
  },
  advisor: {
    confidentialityTerm: 'client confidentiality',
    confidentialityShort: 'client confidentiality',
    clientWorkPhrase: 'your client files',
    sensitiveWorkDesc: 'your most sensitive client files',
    practiceNoun: 'practice',
    soloOrTeamDesc: 'Keepance works just as well for a solo advisor as it does for a full advisory team.',
    estimatedCostDesc: 'Most advisors spend about $2 to $5 a month, billed by your AI provider, not us.',
  },
  other: {
    confidentialityTerm: 'client confidentiality',
    confidentialityShort: 'client confidentiality',
    clientWorkPhrase: 'your client work',
    sensitiveWorkDesc: 'your most sensitive work',
    practiceNoun: 'work',
    soloOrTeamDesc: 'Keepance works just as well on your own as it does for a team.',
    estimatedCostDesc: 'Most users spend about $2 to $5 a month, billed by your AI provider, not us.',
  },
};

/**
 * Reactive React hook. Re-renders the component whenever the profession
 * changes (e.g. via settings or localStorage toggle).
 */
export function useProfessionCopy(): ProfessionCopy {
  const profession = useProfessionStore((s) => s.profession);
  return COPY[profession];
}

/**
 * Non-reactive read for code outside React (utilities, event handlers, etc.).
 * Reads the current Zustand snapshot; does NOT subscribe to future changes.
 */
export function getProfessionCopy(): ProfessionCopy {
  return COPY[getProfession()];
}
