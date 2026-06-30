/**
 * professionStore — the reactive source of truth for the user's profession.
 *
 * The lead ICP is now financial advisors: Advisor Prep Hero is "the private intelligence
 * layer for your advisory practice." The profession the user picked in onboarding
 * (stored under `keepance_profession`) decides whether the founder-era surfaces
 * (Research, Whiteboard, founder templates) appear at all. Before this store,
 * that value sat read-only in localStorage and gated almost nothing; promoting
 * it to reactive Zustand state lets the nav, scaffolding, templates, and copy
 * react.
 *
 * Default when unset: 'advisor' (financial advisors are the lead ICP).
 */
import { create } from 'zustand';
import type { Profession } from '@/platform/profile/professionModel';

/** Same key the onboarding wizard's getOnboardingProfession() reads. */
export const PROFESSION_STORAGE_KEY = 'keepance_profession';

const VALID: readonly Profession[] = ['legal', 'tax', 'consulting', 'advisor', 'other'];

function readInitial(): Profession {
  try {
    const v = localStorage.getItem(PROFESSION_STORAGE_KEY);
    if (v && (VALID as readonly string[]).includes(v)) return v as Profession;
  } catch {
    // localStorage may be unavailable (strict privacy mode); fall through.
  }
  return 'advisor';
}

interface ProfessionState {
  profession: Profession;
  setProfession: (p: Profession) => void;
}

export const useProfessionStore = create<ProfessionState>((set) => ({
  profession: readInitial(),
  setProfession: (p) => {
    try {
      localStorage.setItem(PROFESSION_STORAGE_KEY, p);
    } catch {
      // ignore persistence failures; the in-memory value still updates.
    }
    set({ profession: p });
  },
}));

/** Non-reactive read for code outside React. */
export function getProfession(): Profession {
  return useProfessionStore.getState().profession;
}

/**
 * Is this the law-practice experience? Legal is the default and lead ICP, so
 * the founder-era surfaces are hidden for it. Other professional packs (tax,
 * consulting, advisor) and 'other' may still see them.
 */
export function isLawExperience(profession: Profession = getProfession()): boolean {
  return profession === 'legal';
}
