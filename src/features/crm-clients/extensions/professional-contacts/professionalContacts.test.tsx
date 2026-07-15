import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { HouseholdRecord } from '../../adapters';
import type { HouseholdRecordShellContext } from '../../recordRegistry';
import {
  ProfessionalContactsSection,
  ProfessionalContactsSectionContent,
} from './ProfessionalContactsSection';
import {
  PROFESSIONAL_CONTACTS_DATA_KEY,
  emptyProfessionalContacts,
  isProfessionalContactsData,
  professionalContactsFor,
  withProfessionalContacts,
} from './professionalContactsData';

const household: HouseholdRecord = {
  id: 'household-1',
  name: 'Foster household',
  lifecycle: 'Active',
  primaryAdvisor: 'Morgan',
  ownership: 'mine',
  serviceTier: 'Private wealth',
  syncState: 'live',
  facts: [],
  accounts: [],
  members: [],
  externalParties: [],
  notes: [],
};

function context(
  current: HouseholdRecord,
  onSaveHousehold: NonNullable<
    HouseholdRecordShellContext['onSaveHousehold']
  > = vi.fn()
): HouseholdRecordShellContext {
  return {
    household: current,
    onSaveHousehold,
    openPanel: vi.fn(),
    setNoteAudience: vi.fn(),
    setAdding: vi.fn(),
    setEditingPerson: vi.fn(),
    deleteFact: vi.fn(),
    renderLegacyClientMap: vi.fn(),
  };
}

function EnabledHarness() {
  const [current, setCurrent] = useState(household);
  return (
    <ProfessionalContactsSectionContent {...context(current, setCurrent)} />
  );
}

describe('professional contacts extension', () => {
  it('keeps a complete, typed four-relationship payload', () => {
    expect(isProfessionalContactsData(emptyProfessionalContacts())).toBe(true);
    expect(isProfessionalContactsData({ trusted_contact: null })).toBe(false);
    expect(
      isProfessionalContactsData({
        ...emptyProfessionalContacts(),
        cpa: { name: 4 },
      })
    ).toBe(false);
    expect(
      isProfessionalContactsData({
        ...emptyProfessionalContacts(),
        unexpected: null,
      })
    ).toBe(false);
  });

  it('writes only its namespaced extension bag and reads it back', () => {
    const next = withProfessionalContacts(household, {
      ...emptyProfessionalContacts(),
      cpa: {
        name: 'Thomas Lee',
        relationship: 'Tax adviser',
        organization: 'Lee CPA',
        email: 'thomas@example.test',
        phone: '555-0101',
        notes: 'Coordinates annual tax planning.',
      },
    });
    expect(next.extensionData?.[PROFESSIONAL_CONTACTS_DATA_KEY]).toMatchObject({
      cpa: { name: 'Thomas Lee' },
    });
    expect(professionalContactsFor(next).cpa?.organization).toBe('Lee CPA');
  });

  it('stays absent while the flag is off', () => {
    localStorage.clear();
    render(<ProfessionalContactsSection {...context(household)} />);
    expect(
      screen.queryByTestId('professional-contacts-section')
    ).not.toBeInTheDocument();
  });

  it('adds and renders trusted, CPA, attorney, and insurance relationships inline', async () => {
    render(<EnabledHarness />);
    const rows = [
      ['trusted_contact', 'Amelia Foster'],
      ['cpa', 'Thomas Lee'],
      ['estate_attorney', 'Nina Alvarez'],
      ['insurance_professional', 'Jon Bell'],
    ] as const;
    for (const [kind, name] of rows) {
      fireEvent.click(screen.getByTestId(`professional-contacts-edit-${kind}`));
      fireEvent.change(
        screen.getByTestId(`professional-contacts-name-${kind}`),
        { target: { value: name } }
      );
      fireEvent.click(screen.getByTestId(`professional-contacts-save-${kind}`));
      await waitFor(() => {
        expect(
          screen.getByTestId(`professional-contacts-summary-${kind}`)
        ).toHaveTextContent(name);
      });
    }
  });
});
