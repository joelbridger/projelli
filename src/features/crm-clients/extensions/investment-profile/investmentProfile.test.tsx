import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import i18n from '@/i18n';
import { setDevFlagOverride } from '@/platform/flags';
import type { HouseholdRecord } from '../../adapters';
import { InvestmentProfileSection, investmentProfileSection } from './index';
import {
  EMPTY_INVESTMENT_PROFILE,
  INVESTMENT_PROFILE_DATA_KEY,
  isInvestmentProfile,
} from './investmentProfile';
import { withInvestmentProfile } from './persistence';

const household: HouseholdRecord = {
  id: 'household-investment-profile',
  name: 'Henderson household',
  lifecycle: 'Active',
  primaryAdvisor: 'Maya',
  ownership: 'mine',
  serviceTier: 'Platinum',
  syncState: 'live',
  facts: [],
  accounts: [],
  members: [],
  externalParties: [],
  notes: [],
};

afterEach(async () => {
  cleanup();
  setDevFlagOverride('record-investment-profile', undefined);
  await i18n.changeLanguage('en');
});

describe('investment profile record extension', () => {
  it('accepts only the complete bounded namespaced payload', () => {
    expect(isInvestmentProfile(EMPTY_INVESTMENT_PROFILE)).toBe(true);
    expect(
      isInvestmentProfile({ ...EMPTY_INVESTMENT_PROFILE, unknown: 'no' })
    ).toBe(false);
    expect(isInvestmentProfile({ investmentObjective: 'x' })).toBe(false);
    expect(
      isInvestmentProfile({
        ...EMPTY_INVESTMENT_PROFILE,
        investmentObjective: 'speculation',
      })
    ).toBe(false);
    expect(
      isInvestmentProfile({
        ...EMPTY_INVESTMENT_PROFILE,
        riskTolerance: 'very-high',
      })
    ).toBe(false);
    expect(
      isInvestmentProfile({
        ...EMPTY_INVESTMENT_PROFILE,
        liquidityNeed: 'x'.repeat(281),
      })
    ).toBe(false);
  });

  it('keeps the card absent while the flag is off', () => {
    render(
      investmentProfileSection.mount({
        household,
        openPanel: () => undefined,
        setNoteAudience: () => undefined,
        setAdding: () => undefined,
        setEditingPerson: () => undefined,
        deleteFact: () => undefined,
        renderLegacyClientMap: () => null,
      })
    );

    expect(
      screen.queryByTestId('investment-profile-section')
    ).not.toBeInTheDocument();
  });

  it('shows every prototype field and saves the namespaced payload when enabled', async () => {
    setDevFlagOverride('record-investment-profile', true);
    const onSaveHousehold = (next: HouseholdRecord) => {
      saved = next;
    };
    let saved: HouseholdRecord | undefined;
    render(
      investmentProfileSection.mount({
        household,
        onSaveHousehold,
        openPanel: () => undefined,
        setNoteAudience: () => undefined,
        setAdding: () => undefined,
        setEditingPerson: () => undefined,
        deleteFact: () => undefined,
        renderLegacyClientMap: () => null,
      })
    );

    expect(screen.getByText('Investment profile')).toBeInTheDocument();
    expect(
      screen.getByText('Planning horizon and risk preferences')
    ).toBeInTheDocument();
    expect(
      Array.from(
        screen.getByLabelText('Investment objective').querySelectorAll('option')
      ).map((option) => option.value)
    ).toEqual(['', 'growth', 'income', 'preservation']);
    expect(
      Array.from(
        screen.getByLabelText('Risk tolerance').querySelectorAll('option')
      ).map((option) => option.value)
    ).toEqual(['', 'conservative', 'moderate', 'aggressive']);
    fireEvent.change(screen.getByLabelText('Investment objective'), {
      target: { value: 'growth' },
    });
    fireEvent.change(screen.getByLabelText('Risk tolerance'), {
      target: { value: 'moderate' },
    });
    fireEvent.change(screen.getByLabelText('Time horizon'), {
      target: { value: 'over-10-years' },
    });
    fireEvent.change(screen.getByLabelText('Liquidity need'), {
      target: { value: '$180K over next 3 years' },
    });
    fireEvent.click(screen.getByTestId('investment-profile-save'));

    await waitFor(() => {
      expect(saved?.extensionData?.[INVESTMENT_PROFILE_DATA_KEY]).toEqual({
        investmentObjective: 'growth',
        riskTolerance: 'moderate',
        timeHorizon: 'over-10-years',
        liquidityNeed: '$180K over next 3 years',
      });
    });
  });

  it('keeps the entered profile visible and explains when its save fails', async () => {
    setDevFlagOverride('record-investment-profile', true);
    render(
      investmentProfileSection.mount({
        household,
        onSaveHousehold: () =>
          Promise.reject(new Error('Storage is unavailable')),
        openPanel: () => undefined,
        setNoteAudience: () => undefined,
        setAdding: () => undefined,
        setEditingPerson: () => undefined,
        deleteFact: () => undefined,
        renderLegacyClientMap: () => null,
      })
    );

    fireEvent.change(screen.getByLabelText('Investment objective'), {
      target: { value: 'income' },
    });
    fireEvent.click(screen.getByTestId('investment-profile-save'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        "I couldn't save this investment profile. Please try again."
      );
    });
    expect(screen.getByLabelText('Investment objective')).toHaveValue('income');
  });

  it('accepts another edit after its own saved record is published back', async () => {
    setDevFlagOverride('record-investment-profile', true);
    const savedProfiles: HouseholdRecord[] = [];

    function StatefulProfile() {
      const [current, setCurrent] = useState(household);
      return (
        <InvestmentProfileSection
          household={current}
          onSaveHousehold={(next) => {
            savedProfiles.push(next);
            setCurrent(next);
          }}
        />
      );
    }

    render(<StatefulProfile />);
    fireEvent.change(screen.getByLabelText('Investment objective'), {
      target: { value: 'growth' },
    });
    fireEvent.click(screen.getByTestId('investment-profile-save'));

    await waitFor(() => {
      expect(savedProfiles).toHaveLength(1);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Investment objective'), {
      target: { value: 'income' },
    });
    fireEvent.click(screen.getByTestId('investment-profile-save'));

    await waitFor(() => {
      expect(savedProfiles).toHaveLength(2);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(
      savedProfiles[1]?.extensionData?.[INVESTMENT_PROFILE_DATA_KEY]
    ).toMatchObject({ investmentObjective: 'income' });
  });

  it('refreshes an untouched editor when the saved profile changes', () => {
    setDevFlagOverride('record-investment-profile', true);
    const first = withInvestmentProfile(household, {
      investmentObjective: 'growth',
      riskTolerance: 'moderate',
      timeHorizon: 'over-10-years',
      liquidityNeed: '$20K next year',
    });
    const { rerender } = render(
      <InvestmentProfileSection
        household={first}
        onSaveHousehold={() => undefined}
      />
    );

    expect(screen.getByLabelText('Investment objective')).toHaveValue('growth');
    const updated = withInvestmentProfile(first, {
      investmentObjective: 'income',
      riskTolerance: 'conservative',
      timeHorizon: '3-to-10-years',
      liquidityNeed: '$40K next year',
    });
    rerender(
      <InvestmentProfileSection
        household={updated}
        onSaveHousehold={() => undefined}
      />
    );

    expect(screen.getByLabelText('Investment objective')).toHaveValue('income');
    expect(screen.getByLabelText('Risk tolerance')).toHaveValue('conservative');
    expect(screen.getByLabelText('Time horizon')).toHaveValue('3-to-10-years');
    expect(screen.getByLabelText('Liquidity need')).toHaveValue(
      '$40K next year'
    );
  });

  it('blocks a stale draft when the saved profile changes and loads the latest values', () => {
    setDevFlagOverride('record-investment-profile', true);
    const onSaveHousehold = vi.fn();
    const first = withInvestmentProfile(household, {
      investmentObjective: 'growth',
      riskTolerance: 'moderate',
      timeHorizon: 'over-10-years',
      liquidityNeed: '$20K next year',
    });
    const { rerender } = render(
      <InvestmentProfileSection
        household={first}
        onSaveHousehold={onSaveHousehold}
      />
    );
    fireEvent.change(screen.getByLabelText('Investment objective'), {
      target: { value: 'preservation' },
    });

    const updated = withInvestmentProfile(first, {
      investmentObjective: 'income',
      riskTolerance: 'conservative',
      timeHorizon: '3-to-10-years',
      liquidityNeed: '$40K next year',
    });
    rerender(
      <InvestmentProfileSection
        household={updated}
        onSaveHousehold={onSaveHousehold}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'changed elsewhere while you were editing'
    );
    fireEvent.click(screen.getByTestId('investment-profile-save'));
    expect(onSaveHousehold).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('investment-profile-use-latest'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Investment objective')).toHaveValue('income');
    expect(screen.getByLabelText('Liquidity need')).toHaveValue(
      '$40K next year'
    );
  });
});
