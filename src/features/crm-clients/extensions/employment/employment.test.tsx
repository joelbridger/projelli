import '@/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HouseholdRecord } from '../../adapters';
import { EmploymentSection } from './EmploymentSection';
import {
  persistEmploymentInformation,
  readEmploymentInformation,
} from './persistence';
import { EMPLOYMENT_EXTENSION_KEY, isEmploymentInformation } from './types';

const household: HouseholdRecord = {
  id: 'household-1',
  name: 'Foster household',
  lifecycle: 'Active',
  primaryAdvisor: 'Sarah Morgan',
  ownership: 'mine',
  serviceTier: 'Private wealth',
  syncState: 'live',
  facts: [],
  accounts: [],
  members: [
    {
      id: 'robert',
      name: 'Robert Foster',
      personType: 'person',
      roles: [],
      relatedHouseholds: 1,
    },
    {
      id: 'elena',
      name: 'Elena Foster',
      personType: 'person',
      roles: [],
      relatedHouseholds: 1,
    },
  ],
  externalParties: [],
  notes: [],
};

describe('Employment section', () => {
  it('stays absent while its flag is off', () => {
    render(<EmploymentSection household={household} enabled={false} />);
    expect(screen.queryByTestId('crm-employment-section')).toBeNull();
  });

  it('edits member-aware work and retirement information and saves household income', async () => {
    const onSaveHousehold = vi.fn(async () => {});
    render(
      <EmploymentSection
        household={household}
        onSaveHousehold={onSaveHousehold}
        enabled
      />
    );

    fireEvent.click(screen.getByTestId('crm-employment-edit'));
    fireEvent.change(screen.getByTestId('crm-employment-occupation'), {
      target: { value: 'Managing partner' },
    });
    fireEvent.change(screen.getByTestId('crm-employment-employer'), {
      target: { value: 'Foster & Lane Architects' },
    });
    fireEvent.change(screen.getByTestId('crm-employment-start'), {
      target: { value: '2002-04-01' },
    });
    fireEvent.change(screen.getByTestId('crm-employment-retirement'), {
      target: { value: '2027-03-01' },
    });
    fireEvent.change(screen.getByTestId('crm-employment-reduced-schedule'), {
      target: { value: 'Four days per week first' },
    });
    fireEvent.change(screen.getByTestId('crm-employment-income'), {
      target: { value: '284000' },
    });
    fireEvent.click(screen.getByTestId('crm-employment-save'));

    await waitFor(() => {
      expect(onSaveHousehold).toHaveBeenCalledTimes(1);
    });
    expect(onSaveHousehold).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionData: {
          [EMPLOYMENT_EXTENSION_KEY]: {
            version: 1,
            householdGrossAnnualIncome: 284000,
            members: {
              robert: {
                occupation: 'Managing partner',
                employer: 'Foster & Lane Architects',
                occupationStart: '2002-04-01',
                plannedRetirement: '2027-03-01',
                reducedScheduleContext: 'Four days per week first',
              },
            },
          },
        },
      })
    );
  });

  it('shows a save error and keeps the unsaved edits when persistence rejects', async () => {
    const onSaveHousehold = vi
      .fn()
      .mockRejectedValue(new Error('store unavailable'));
    render(
      <EmploymentSection
        household={household}
        onSaveHousehold={onSaveHousehold}
        enabled
      />
    );

    fireEvent.click(screen.getByTestId('crm-employment-edit'));
    fireEvent.change(screen.getByTestId('crm-employment-occupation'), {
      target: { value: 'Managing partner' },
    });
    fireEvent.change(screen.getByTestId('crm-employment-income'), {
      target: { value: '284000' },
    });
    fireEvent.click(screen.getByTestId('crm-employment-save'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Employment could not be saved. Please try again.'
    );
    expect(onSaveHousehold).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('crm-employment-occupation')).toHaveValue(
      'Managing partner'
    );
    expect(screen.getByTestId('crm-employment-income')).toHaveValue(284000);
  });

  it('keeps each member association separate', () => {
    const saved = persistEmploymentInformation(household, {
      version: 1,
      householdGrossAnnualIncome: 284000,
      members: {
        robert: { occupation: 'Architect', employer: 'Foster & Lane' },
        elena: { occupation: 'Teacher', employer: 'Denver Public Schools' },
      },
    });
    render(<EmploymentSection household={saved} enabled />);

    expect(
      screen.getByTestId('crm-employment-occupation-value')
    ).toHaveTextContent('Architect');
    fireEvent.click(screen.getByTestId('crm-employment-edit'));
    fireEvent.change(screen.getByTestId('crm-employment-member'), {
      target: { value: 'elena' },
    });
    fireEvent.click(screen.getByTestId('crm-employment-edit'));
    expect(
      screen.getByTestId('crm-employment-occupation-value')
    ).toHaveTextContent('Teacher');
  });

  it('rejects malformed persisted information and safely starts empty', () => {
    expect(
      isEmploymentInformation({
        version: 1,
        members: { robert: { occupation: 9 } },
      })
    ).toBe(false);
    expect(
      readEmploymentInformation({
        extensionData: {
          [EMPLOYMENT_EXTENSION_KEY]: { version: 2, members: {} },
        },
      })
    ).toEqual({ version: 1, members: {} });
  });

  it('restores information produced by the real editor save path after a fresh render', async () => {
    let saved: HouseholdRecord | undefined;
    const firstRender = render(
      <EmploymentSection
        household={household}
        onSaveHousehold={(next) => {
          saved = next;
        }}
        enabled
      />
    );

    fireEvent.click(screen.getByTestId('crm-employment-edit'));
    fireEvent.change(screen.getByTestId('crm-employment-occupation'), {
      target: { value: 'Managing partner' },
    });
    fireEvent.change(screen.getByTestId('crm-employment-employer'), {
      target: { value: 'Foster & Lane Architects' },
    });
    fireEvent.change(screen.getByTestId('crm-employment-start'), {
      target: { value: '2002-04-01' },
    });
    fireEvent.change(screen.getByTestId('crm-employment-retirement'), {
      target: { value: '2027-03-01' },
    });
    fireEvent.change(screen.getByTestId('crm-employment-reduced-schedule'), {
      target: { value: 'Four days per week first' },
    });
    fireEvent.change(screen.getByTestId('crm-employment-income'), {
      target: { value: '284000' },
    });
    fireEvent.click(screen.getByTestId('crm-employment-save'));

    await waitFor(() => {
      expect(saved).toBeDefined();
    });
    firstRender.unmount();
    if (!saved)
      throw new Error('Expected the editor save path to return a household');
    render(<EmploymentSection household={saved} enabled />);

    expect(
      screen.getByTestId('crm-employment-occupation-value')
    ).toHaveTextContent('Managing partner');
    expect(screen.getByTestId('crm-employment-income-value')).toHaveTextContent(
      '$284,000 household'
    );
    expect(screen.getByText('April 2002')).toBeInTheDocument();
    expect(screen.getByText(/March 2027/)).toBeInTheDocument();
    expect(screen.getByText(/Four days per week first/)).toBeInTheDocument();
  });
});
