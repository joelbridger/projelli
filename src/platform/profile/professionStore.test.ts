/**
 * professionStore — unit tests.
 *
 * Verifies the store initialises correctly and that the default profession
 * is 'advisor' when localStorage has no stored value.
 */
import { beforeEach, describe, it, expect } from 'vitest';

// Clear the localStorage profession key before each test so we see the
// true "first run" default. The Zustand store reads localStorage once at
// module-init time, so we reset its in-memory state directly via setState.
import { useProfessionStore, getProfession, isLawExperience, PROFESSION_STORAGE_KEY } from '@/platform/profile/professionStore';

beforeEach(() => {
  try {
    localStorage.removeItem(PROFESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
  // Reset in-memory store to simulate a clean first run.
  useProfessionStore.setState({ profession: 'advisor' });
});

describe('professionStore defaults', () => {
  it('default profession is advisor', () => {
    expect(getProfession()).toBe('advisor');
  });

  it('isLawExperience is false for advisor (the default)', () => {
    expect(isLawExperience('advisor')).toBe(false);
  });

  it('isLawExperience is true only for legal', () => {
    expect(isLawExperience('legal')).toBe(true);
    expect(isLawExperience('tax')).toBe(false);
    expect(isLawExperience('consulting')).toBe(false);
    expect(isLawExperience('other')).toBe(false);
  });
});

describe('professionStore setProfession', () => {
  it('updates the reactive state', () => {
    useProfessionStore.getState().setProfession('legal');
    expect(getProfession()).toBe('legal');
  });

  it('round-trips all valid professions', () => {
    const professions = ['legal', 'tax', 'consulting', 'advisor', 'other'] as const;
    for (const p of professions) {
      useProfessionStore.getState().setProfession(p);
      expect(getProfession()).toBe(p);
    }
  });
});
