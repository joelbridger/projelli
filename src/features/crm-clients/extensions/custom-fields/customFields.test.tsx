import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState } from 'react';
import { renameField, type FieldCatalog } from '@/features/crm-firm';
import { setDevFlagOverride } from '@/platform/flags';
import { assertCrossContextIsolation } from '@/testing/cross-context-isolation';
import type { HouseholdRecord } from '../../adapters';
import { householdRecordExtensionRegistry } from '../../recordRegistry';
import { HouseholdRecordSurface } from '../../HouseholdRecordSurface';
import type { HouseholdTabSurfaceProps } from '../../tabRegistry';
import {
  CUSTOM_FIELD_VALUES_DATA_KEY,
  readCustomFieldValues,
  withCustomFieldValues,
} from './customFieldValues';
import { CustomFieldsSectionContent } from './CustomFieldsSection';

const { live, catalogPersistence, useLiveCrmRecords } = vi.hoisted(() => ({
  live: {
    records: [] as unknown[],
    save: vi.fn(),
    workspaceRoot: '/workspace-a',
  },
  catalogPersistence: {
    load: vi.fn(),
    save: vi.fn(),
  },
  useLiveCrmRecords: vi.fn(),
}));

vi.mock('@/features/crm-firm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/crm-firm')>();
  return {
    ...actual,
    createLiveFieldCatalogPersistence: vi.fn(() => catalogPersistence),
  };
});

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords,
}));

// The real Client Map tab has its own live-record reader. This focused shell
// integration test replaces only that unrelated tab, so its spy measures the
// custom-fields section's reader alone.
vi.mock('../../clientMapTab', () => ({
  clientMapTab: {
    id: 'client-map',
    label: 'Client Map',
    route: 'client_map',
    Component: ({ renderLegacySurface }: HouseholdTabSurfaceProps) => (
      <>{renderLegacySurface('client_map')}</>
    ),
  },
}));

const household: HouseholdRecord = {
  id: 'household-custom-fields',
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

const catalog: FieldCatalog = {
  fields: [
    {
      id: 'planning-note',
      name: 'Planning note',
      kind: 'text',
      appliesTo: ['household'],
      retired: false,
    },
    {
      id: 'target-rate',
      name: 'Target rate',
      kind: 'number',
      appliesTo: ['household'],
      retired: false,
    },
    {
      id: 'reserve',
      name: 'Reserve',
      kind: 'money',
      appliesTo: ['household'],
      retired: false,
    },
    {
      id: 'review-date',
      name: 'Review date',
      kind: 'date',
      appliesTo: ['household'],
      retired: false,
    },
    {
      id: 'managed',
      name: 'Managed',
      kind: 'boolean',
      appliesTo: ['household'],
      retired: false,
    },
    {
      id: 'risk-band',
      name: 'Risk band',
      kind: 'select',
      options: ['Conservative', 'Balanced'],
      appliesTo: ['household'],
      retired: false,
    },
    {
      id: 'services',
      name: 'Services',
      kind: 'multi-select',
      options: ['Tax', 'Estate'],
      appliesTo: ['household'],
      retired: false,
    },
    {
      id: 'person-only',
      name: 'Person only',
      kind: 'text',
      appliesTo: ['person'],
      retired: false,
    },
    {
      id: 'retired',
      name: 'Retired field',
      kind: 'text',
      appliesTo: ['household'],
      retired: true,
    },
  ],
};

afterEach(() => {
  cleanup();
  setDevFlagOverride('custom-fields-advisor', undefined);
});

beforeEach(() => {
  live.workspaceRoot = '/workspace-a';
  live.records = [
    ...catalog.fields.map((field, order) => ({
      id: field.id,
      kind: 'customFieldDef',
      matterId: 'firm_home',
      key: field.id,
      label: field.name,
      fieldType:
        field.kind === 'boolean'
          ? 'bool'
          : field.kind === 'select'
            ? 'enum'
            : field.kind === 'multi-select'
              ? 'multi-enum'
              : field.kind,
      ...(field.options ? { options: [...field.options] } : {}),
      appliesTo: [...field.appliesTo],
      archived: field.retired,
      required: false,
      order,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    })),
  ];
  useLiveCrmRecords.mockReset();
  useLiveCrmRecords.mockReturnValue(live);
  live.save.mockReset();
  catalogPersistence.load.mockReset();
  catalogPersistence.load.mockResolvedValue(catalog);
  catalogPersistence.save.mockReset();
});

describe('advisor custom fields extension', () => {
  it('uses the real household registries without catalog work while dark, then renders when enabled', async () => {
    const extension = householdRecordExtensionRegistry.find(
      (descriptor) => descriptor.id === 'custom-fields-advisor-values'
    );
    if (!extension)
      throw new Error('Expected the custom fields record extension.');
    const validate = vi.spyOn(extension, 'validate');

    render(
      <HouseholdRecordSurface
        household={{
          ...household,
          extensionData: { [CUSTOM_FIELD_VALUES_DATA_KEY]: {} },
        }}
      />
    );

    expect(extension.dataKey).toBe(CUSTOM_FIELD_VALUES_DATA_KEY);
    expect(validate).toHaveBeenCalledWith({});
    expect(
      screen.queryByTestId('custom-fields-advisor-section')
    ).not.toBeInTheDocument();
    expect(catalogPersistence.load).not.toHaveBeenCalled();
    expect(catalogPersistence.save).not.toHaveBeenCalled();
    expect(live.save).not.toHaveBeenCalled();
    expect(useLiveCrmRecords).not.toHaveBeenCalled();

    act(() => {
      setDevFlagOverride('custom-fields-advisor', true);
    });
    expect(useLiveCrmRecords).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByTestId('custom-fields-advisor-section')
    ).toBeInTheDocument();
    expect(catalogPersistence.load).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Planning note')).toBeInTheDocument();
    expect(screen.queryByLabelText('Person only')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Retired field')).not.toBeInTheDocument();
  });

  it('edits every firm-defined field kind and saves values under their stable ids', async () => {
    setDevFlagOverride('custom-fields-advisor', true);
    let saved: HouseholdRecord | undefined;
    render(
      <CustomFieldsSectionContent
        household={household}
        catalog={catalog}
        onSaveHousehold={(next) => {
          saved = next;
        }}
      />
    );

    fireEvent.change(screen.getByLabelText('Planning note'), {
      target: { value: 'Annual review' },
    });
    fireEvent.change(screen.getByLabelText('Target rate'), {
      target: { value: '7' },
    });
    fireEvent.change(screen.getByLabelText('Reserve'), {
      target: { value: '1250.50' },
    });
    fireEvent.change(screen.getByLabelText('Review date'), {
      target: { value: '2026-09-01' },
    });
    fireEvent.click(screen.getByLabelText('Managed'));
    fireEvent.change(screen.getByLabelText('Risk band'), {
      target: { value: 'Balanced' },
    });
    const services = screen.getByLabelText('Services');
    if (!(services instanceof HTMLSelectElement)) {
      throw new Error('Expected Services to use a multi-select control.');
    }
    for (const option of Array.from(services.options)) {
      option.selected = option.value === 'Tax' || option.value === 'Estate';
    }
    fireEvent.change(services);
    fireEvent.click(screen.getByTestId('custom-fields-advisor-save'));

    await waitFor(() => {
      expect(saved?.extensionData?.[CUSTOM_FIELD_VALUES_DATA_KEY]).toEqual({
        'planning-note': 'Annual review',
        'target-rate': 7,
        reserve: 1250.5,
        'review-date': '2026-09-01',
        managed: true,
        'risk-band': 'Balanced',
        services: ['Tax', 'Estate'],
      });
    });
  });

  it('uses the shared complete cross-context isolation probe through the production registry', async () => {
    setDevFlagOverride('custom-fields-advisor', true);
    const saveHousehold = vi.fn();
    let view: ReturnType<typeof render> | undefined;
    const original = withCustomFieldValues(household, { 'planning-note': 'A saved private note', reserve: 7654, managed: true });
    await assertCrossContextIsolation({
      name: 'Custom fields workspace switch',
      identity: { contextA: '/workspace-a', contextB: '/workspace-b', sameRecordId: household.id, sameFieldId: 'planning-note' },
      renderSurface: async () => { live.workspaceRoot = '/workspace-a'; catalogPersistence.load.mockReset(); catalogPersistence.load.mockResolvedValue(catalog); view?.unmount(); view = render(<HouseholdRecordSurface household={original} onSaveHousehold={saveHousehold} />); await screen.findByLabelText('Planning note'); },
      typeIntoField: () => { fireEvent.change(screen.getByLabelText('Planning note'), { target: { value: 'A newly typed private note' } }); fireEvent.change(screen.getByLabelText('Reserve'), { target: { value: '8765' } }); return { typedA: 'A newly typed private note', loadedA: ['A saved private note', '8765'] }; },
      reseedSameContext: () => { view?.rerender(<HouseholdRecordSurface household={withCustomFieldValues({ ...original, name: 'Fresh A object' }, { 'planning-note': 'Late A note', reserve: 1 })} onSaveHousehold={saveHousehold} />); },
      switchContext: (load) => { live.workspaceRoot = '/workspace-b'; if (load === 'success') { catalogPersistence.load.mockResolvedValueOnce(catalog); view?.rerender(<HouseholdRecordSurface household={withCustomFieldValues({ ...household, name: 'Workspace B reused record id' }, { 'planning-note': 'B loaded note', reserve: 42 })} onSaveHousehold={saveHousehold} />); } else { catalogPersistence.load.mockRejectedValueOnce(new Error('Workspace B catalog could not load')); view?.rerender(<HouseholdRecordSurface household={{ ...household, name: 'Workspace B reused record id' }} onSaveHousehold={saveHousehold} />); } },
      waitForBSuccess: async () => { await waitFor(() => { expect(screen.getByLabelText('Planning note')).toHaveValue('B loaded note'); }); },
      waitForBFailure: async () => { await screen.findByRole('alert'); },
      assertATypedValueVisible: () => { expect(screen.getByLabelText('Planning note')).toHaveValue('A newly typed private note'); },
      assertWithinContextEditPreserved: () => { expect(screen.getByLabelText('Planning note')).toHaveValue('A newly typed private note'); expect(screen.getByLabelText('Reserve')).toHaveValue(8765); },
      assertBSuccessLoaded: () => { expect(screen.getByLabelText('Planning note')).toHaveValue('B loaded note'); expect(screen.getByLabelText('Reserve')).toHaveValue(42); expect(screen.getByLabelText('Managed')).not.toBeChecked(); },
      assertBFailureIsFailClosed: () => { expect(screen.getByRole('alert')).toBeInTheDocument(); expect(screen.queryByLabelText('Planning note')).not.toBeInTheDocument(); },
      assertNoAContentInFields: ({ typedA, loadedA }) => { expect(screen.queryByDisplayValue(typedA)).not.toBeInTheDocument(); for (const marker of loadedA) expect(screen.queryByDisplayValue(marker)).not.toBeInTheDocument(); },
      assertNoAContentInUnderlyingState: async () => { if (screen.queryByTestId('custom-fields-advisor-save')) { fireEvent.click(screen.getByTestId('custom-fields-advisor-save')); await waitFor(() => { const saved = saveHousehold.mock.calls.at(-1)?.[0] as HouseholdRecord | undefined; expect(readCustomFieldValues(saved as HouseholdRecord)).toEqual({ 'planning-note': 'B loaded note', reserve: 42 }); expect(readCustomFieldValues(saved as HouseholdRecord)).not.toMatchObject({ managed: true, 'planning-note': 'A newly typed private note', reserve: 8765 }); }); } else { expect(screen.queryByTestId('custom-fields-advisor-section')).not.toBeInTheDocument(); } },
    });
  });

  it('round-trips a save through a fresh render and preserves sibling bags', async () => {
    setDevFlagOverride('custom-fields-advisor', true);
    const initial: HouseholdRecord = {
      ...household,
      extensionData: {
        'compliance-dates.written-agreements': {
          formAdvDeliveredOn: '2026-01-01',
        },
        'another-extension.data': { untouched: true },
      },
    };
    let saved: HouseholdRecord | undefined;
    const { unmount } = render(
      <CustomFieldsSectionContent
        household={initial}
        catalog={catalog}
        onSaveHousehold={(next) => {
          saved = next;
        }}
      />
    );
    fireEvent.change(screen.getByLabelText('Planning note'), {
      target: { value: 'Saved and reloaded' },
    });
    fireEvent.click(screen.getByTestId('custom-fields-advisor-save'));

    await waitFor(() => {
      expect(saved?.extensionData).toMatchObject({
        'compliance-dates.written-agreements': {
          formAdvDeliveredOn: '2026-01-01',
        },
        'another-extension.data': { untouched: true },
        [CUSTOM_FIELD_VALUES_DATA_KEY]: {
          'planning-note': 'Saved and reloaded',
        },
      });
    });
    unmount();
    render(
      <CustomFieldsSectionContent
        household={saved as HouseholdRecord}
        catalog={catalog}
        onSaveHousehold={() => undefined}
      />
    );
    expect(screen.getByLabelText('Planning note')).toHaveValue(
      'Saved and reloaded'
    );
  });

  it('keeps stored values keyed by id when the firm renames a catalog field', () => {
    const first = withCustomFieldValues(household, {
      'risk-band': 'Balanced',
      'retired-value': 'still retained',
    });
    const renamed = renameField(catalog, 'risk-band', 'Investment risk band');

    expect(renamed.fields.find((field) => field.id === 'risk-band')?.name).toBe(
      'Investment risk band'
    );
    expect(readCustomFieldValues(first)).toEqual({
      'risk-band': 'Balanced',
      'retired-value': 'still retained',
    });
  });

  it('rejects malformed extension data without changing sibling namespace values', () => {
    const malformed: HouseholdRecord = {
      ...household,
      extensionData: {
        'another-extension.data': { preserved: true },
        [CUSTOM_FIELD_VALUES_DATA_KEY]: { 'bad-field': { nope: true } },
      },
    };
    expect(readCustomFieldValues(malformed)).toEqual({});
    expect(
      withCustomFieldValues(malformed, { 'good-field': 'valid' }).extensionData
    ).toMatchObject({
      'another-extension.data': { preserved: true },
      [CUSTOM_FIELD_VALUES_DATA_KEY]: { 'good-field': 'valid' },
    });
  });

  it('keeps a saved value visible after its parent publishes the new record', async () => {
    setDevFlagOverride('custom-fields-advisor', true);
    function StatefulEditor() {
      const [current, setCurrent] = useState(household);
      return (
        <CustomFieldsSectionContent
          household={current}
          catalog={catalog}
          onSaveHousehold={setCurrent}
        />
      );
    }
    render(<StatefulEditor />);
    fireEvent.change(screen.getByLabelText('Planning note'), {
      target: { value: 'Current plan' },
    });
    fireEvent.click(screen.getByTestId('custom-fields-advisor-save'));
    await waitFor(() => {
      expect(screen.getByLabelText('Planning note')).toHaveValue(
        'Current plan'
      );
    });
  });
});
