import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { setDevFlagOverride } from '@/platform/flags/router';
import type { HouseholdRecord } from '../../adapters';
import {
  getHouseholdRecordExtensions,
  getHouseholdSections,
} from '../../recordRegistry';
import {
  COMPLIANCE_DATES_DATA_KEY,
  EMPTY_COMPLIANCE_DATES,
  isComplianceDatesPayload,
  isValidComplianceDate,
  persistComplianceDates,
  validateComplianceDates,
  writtenAgreementsSection,
} from '.';

const household: HouseholdRecord = {
  id: 'compliance-household',
  name: 'Foster household',
  lifecycle: 'Active',
  primaryAdvisor: 'Sarah Morgan',
  ownership: 'mine',
  serviceTier: 'Platinum',
  syncState: 'live',
  facts: [],
  accounts: [],
  members: [],
  externalParties: [],
  notes: [],
};

afterEach(() => {
  cleanup();
  setDevFlagOverride('record-compliance-dates', undefined);
});

describe('written agreement compliance dates', () => {
  it('accepts real ISO dates and rejects impossible or inferred values', () => {
    expect(isValidComplianceDate('2026-02-28')).toBe(true);
    expect(isValidComplianceDate('2026-02-29')).toBe(false);
    expect(isValidComplianceDate('2026-2-28')).toBe(false);
    expect(isComplianceDatesPayload(EMPTY_COMPLIANCE_DATES)).toBe(true);
    expect(
      isComplianceDatesPayload({
        ...EMPTY_COMPLIANCE_DATES,
        formAdvDeliveredOn: 'Mar 12, 2026',
      })
    ).toBe(false);
    expect(
      validateComplianceDates({
        ...EMPTY_COMPLIANCE_DATES,
        formAdvDeliveredOn: '2026-02-29',
      }).valid
    ).toBe(false);
  });

  it('stays out of the record when its flag is off', () => {
    setDevFlagOverride('record-compliance-dates', false);
    render(
      <>
        {writtenAgreementsSection.mount({
          household,
          openPanel: vi.fn(),
          setNoteAudience: vi.fn(),
          setAdding: vi.fn(),
          setEditingPerson: vi.fn(),
          deleteFact: vi.fn(),
          renderLegacyClientMap: vi.fn(),
        })}
      </>
    );
    expect(
      screen.queryByTestId('compliance-dates-written-agreements')
    ).not.toBeInTheDocument();
  });

  it('renders six clear missing values, saves dates, and reads them after a restart', async () => {
    setDevFlagOverride('record-compliance-dates', true);
    const onSaveHousehold = vi.fn<(saved: HouseholdRecord) => void>();
    const context = {
      household,
      onSaveHousehold,
      openPanel: vi.fn(),
      setNoteAudience: vi.fn(),
      setAdding: vi.fn(),
      setEditingPerson: vi.fn(),
      deleteFact: vi.fn(),
      renderLegacyClientMap: vi.fn(),
    };
    const mounted = render(<>{writtenAgreementsSection.mount(context)}</>);
    expect(screen.getByText('Written agreements')).toBeInTheDocument();
    expect(screen.getAllByText('Missing date')).toHaveLength(6);
    fireEvent.click(screen.getByTestId('compliance-dates-edit'));
    fireEvent.change(
      screen.getByTestId('compliance-dates-input-advisoryAgreementSignedOn'),
      { target: { value: '2017-01-18' } }
    );
    fireEvent.change(
      screen.getByTestId('compliance-dates-input-formAdvDeliveredOn'),
      { target: { value: '2026-03-12' } }
    );
    fireEvent.click(screen.getByTestId('compliance-dates-save'));
    await waitFor(() => {
      expect(onSaveHousehold).toHaveBeenCalledTimes(1);
    });

    const restarted = onSaveHousehold.mock.calls.at(-1)?.[0];
    if (!restarted) throw new Error('Expected the date save callback to run.');
    expect(restarted.extensionData?.[COMPLIANCE_DATES_DATA_KEY]).toMatchObject({
      advisoryAgreementSignedOn: '2017-01-18',
      formAdvDeliveredOn: '2026-03-12',
    });
    mounted.unmount();
    render(
      <>
        {writtenAgreementsSection.mount({ ...context, household: restarted })}
      </>
    );
    expect(
      screen.getByTestId('compliance-dates-row-advisoryAgreementSignedOn')
    ).toHaveTextContent('Signed Jan 18, 2017');
    expect(
      screen.getByTestId('compliance-dates-row-formAdvDeliveredOn')
    ).toHaveTextContent('Delivered Mar 12, 2026');
    expect(screen.getAllByText('Missing date')).toHaveLength(4);
  });

  it('shows validation and does not call the connected save callback for an invalid date', async () => {
    setDevFlagOverride('record-compliance-dates', true);
    const onSaveHousehold = vi.fn<(saved: HouseholdRecord) => void>();
    render(
      <>
        {writtenAgreementsSection.mount({
          household,
          onSaveHousehold,
          openPanel: vi.fn(),
          setNoteAudience: vi.fn(),
          setAdding: vi.fn(),
          setEditingPerson: vi.fn(),
          deleteFact: vi.fn(),
          renderLegacyClientMap: vi.fn(),
        })}
      </>
    );

    fireEvent.click(screen.getByTestId('compliance-dates-edit'));
    fireEvent.change(
      screen.getByTestId('compliance-dates-input-privacyNoticeDeliveredOn'),
      { target: { value: '2026-02-29' } }
    );
    fireEvent.click(screen.getByTestId('compliance-dates-save'));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Enter a real date in YYYY-MM-DD format, or leave it blank.'
        )
      ).toBeInTheDocument();
    });
    expect(onSaveHousehold).not.toHaveBeenCalled();
  });

  it('registers exactly one section and one namespaced extension', () => {
    expect(
      getHouseholdSections().filter(
        (section) => section.id === 'written-agreements'
      )
    ).toHaveLength(1);
    expect(
      getHouseholdRecordExtensions().filter(
        (extension) => extension.dataKey === COMPLIANCE_DATES_DATA_KEY
      )
    ).toHaveLength(1);
    expect(
      persistComplianceDates(household, EMPTY_COMPLIANCE_DATES).extensionData?.[
        COMPLIANCE_DATES_DATA_KEY
      ]
    ).toEqual(EMPTY_COMPLIANCE_DATES);
  });
});
