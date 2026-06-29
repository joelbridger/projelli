/**
 * useEntityLabel — unit tests for the label facade.
 *
 * Verifies that each profession gets the right user-visible words, and that
 * the new household forms are correct for advisor (and mirror one/other for
 * all other professions).
 */
import { describe, beforeEach, it, expect } from 'vitest';
import { useProfessionStore } from '@/platform/profile/professionStore';
import { getEntityLabel } from '@/platform/hooks/useEntityLabel';

beforeEach(() => {
  // Reset store to a known state before each test.
  useProfessionStore.setState({ profession: 'legal' });
});

describe('getEntityLabel — advisor', () => {
  beforeEach(() => {
    useProfessionStore.setState({ profession: 'advisor' });
  });

  it('returns client/clients for one/other', () => {
    const label = getEntityLabel();
    expect(label.one).toBe('client');
    expect(label.other).toBe('clients');
    expect(label.One).toBe('Client');
    expect(label.Other).toBe('Clients');
  });

  it('returns household/households for household forms', () => {
    const label = getEntityLabel();
    expect(label.household).toBe('household');
    expect(label.households).toBe('households');
    expect(label.Household).toBe('Household');
    expect(label.Households).toBe('Households');
  });
});

describe('getEntityLabel — legal', () => {
  it('returns matter/matters', () => {
    const label = getEntityLabel();
    expect(label.one).toBe('matter');
    expect(label.other).toBe('matters');
    expect(label.One).toBe('Matter');
    expect(label.Other).toBe('Matters');
  });

  it('household forms mirror one/other for legal', () => {
    const label = getEntityLabel();
    expect(label.household).toBe('matter');
    expect(label.households).toBe('matters');
    expect(label.Household).toBe('Matter');
    expect(label.Households).toBe('Matters');
  });
});

describe('getEntityLabel — tax', () => {
  beforeEach(() => {
    useProfessionStore.setState({ profession: 'tax' });
  });

  it('returns client/clients', () => {
    const label = getEntityLabel();
    expect(label.one).toBe('client');
    expect(label.other).toBe('clients');
  });

  it('household forms mirror one/other for tax', () => {
    const label = getEntityLabel();
    expect(label.household).toBe('client');
    expect(label.households).toBe('clients');
  });
});

describe('getEntityLabel — consulting', () => {
  beforeEach(() => {
    useProfessionStore.setState({ profession: 'consulting' });
  });

  it('returns engagement/engagements', () => {
    const label = getEntityLabel();
    expect(label.one).toBe('engagement');
    expect(label.other).toBe('engagements');
  });

  it('household forms mirror one/other for consulting', () => {
    const label = getEntityLabel();
    expect(label.household).toBe('engagement');
    expect(label.households).toBe('engagements');
    expect(label.Household).toBe('Engagement');
    expect(label.Households).toBe('Engagements');
  });
});

describe('getEntityLabel — other', () => {
  beforeEach(() => {
    useProfessionStore.setState({ profession: 'other' });
  });

  it('returns matter/matters (safe default)', () => {
    const label = getEntityLabel();
    expect(label.one).toBe('matter');
    expect(label.household).toBe('matter');
    expect(label.Households).toBe('Matters');
  });
});
