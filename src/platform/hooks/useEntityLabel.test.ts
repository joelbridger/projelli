/**
 * useEntityLabel — unit tests for the label facade.
 *
 * Verifies that each profession gets the right user-visible words, and that
 * the new household forms are correct for advisor (and mirror one/other for
 * all other professions). Also verifies the words are wired through i18n:
 * they change with the active locale, and useEntityLabel() re-renders when
 * the locale changes.
 */
import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProfessionStore } from '@/platform/profile/professionStore';
import { useEntityLabel, getEntityLabel } from '@/platform/hooks/useEntityLabel';
import i18n from '@/i18n';

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

  it('uses advisor language for the internal privileged flag', () => {
    const label = getEntityLabel();
    expect(label.confidentialityColumn).toBe('Sensitive');
    expect(label.confidentialityBadge).toBe('Sensitive');
  });
});

describe('getEntityLabel — legal', () => {
  it('returns client/clients', () => {
    const label = getEntityLabel();
    expect(label.one).toBe('client');
    expect(label.other).toBe('clients');
    expect(label.One).toBe('Client');
    expect(label.Other).toBe('Clients');
  });

  it('household forms mirror one/other for legal', () => {
    const label = getEntityLabel();
    expect(label.household).toBe('client');
    expect(label.households).toBe('clients');
    expect(label.Household).toBe('Client');
    expect(label.Households).toBe('Clients');
  });

  it('keeps legal privilege language for the internal privileged flag', () => {
    const label = getEntityLabel();
    expect(label.confidentialityColumn).toBe('Privilege');
    expect(label.confidentialityBadge).toBe('Privileged');
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
    expect(label.confidentialityColumn).toBe('Confidential');
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
    expect(label.confidentialityColumn).toBe('Confidential');
  });
});

describe('getEntityLabel — other', () => {
  beforeEach(() => {
    useProfessionStore.setState({ profession: 'other' });
  });

  it('returns client/clients (safe default)', () => {
    const label = getEntityLabel();
    expect(label.one).toBe('client');
    expect(label.household).toBe('client');
    expect(label.Households).toBe('Clients');
  });
});

describe('entity words are wired through i18n (not hardcoded English)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates the advisor noun into German', async () => {
    useProfessionStore.setState({ profession: 'advisor' });
    await i18n.changeLanguage('de');
    const label = getEntityLabel();
    expect(label.one).toBe('Kunde');
    expect(label.other).toBe('Kunden');
    expect(label.household).toBe('Haushalt');
    expect(label.households).toBe('Haushalte');
    expect(label.confidentialityColumn).toBe('Sensibel');
  });

  it('translates the legal noun into Spanish', async () => {
    useProfessionStore.setState({ profession: 'legal' });
    await i18n.changeLanguage('es');
    const label = getEntityLabel();
    expect(label.one).toBe('asunto');
    expect(label.Other).toBe('Asuntos');
    expect(label.confidentialityColumn).toBe('Privilegio');
    expect(label.confidentialityBadge).toBe('Privilegiado');
  });

  it('translates the tax noun into German', async () => {
    useProfessionStore.setState({ profession: 'tax' });
    await i18n.changeLanguage('de');
    const label = getEntityLabel();
    expect(label.one).toBe('Mandant');
    expect(label.other).toBe('Mandanten');
    expect(label.confidentialityColumn).toBe('Vertraulich');
  });

  it('translates the consulting noun into Spanish', async () => {
    useProfessionStore.setState({ profession: 'consulting' });
    await i18n.changeLanguage('es');
    const label = getEntityLabel();
    expect(label.one).toBe('encargo');
    expect(label.Households).toBe('Encargos');
  });

  it('useEntityLabel() re-renders with the new noun when the locale changes', async () => {
    useProfessionStore.setState({ profession: 'advisor' });
    await i18n.changeLanguage('en');
    const { result } = renderHook(() => useEntityLabel());
    expect(result.current.one).toBe('client');

    await act(async () => {
      await i18n.changeLanguage('de');
    });
    expect(result.current.one).toBe('Kunde');
  });

  it('falls back to English profession switching still works with a non-English locale active', async () => {
    await i18n.changeLanguage('de');
    useProfessionStore.setState({ profession: 'legal' });
    expect(getEntityLabel().one).toBe('Akte');
    useProfessionStore.setState({ profession: 'advisor' });
    expect(getEntityLabel().one).toBe('Kunde');
  });
});
