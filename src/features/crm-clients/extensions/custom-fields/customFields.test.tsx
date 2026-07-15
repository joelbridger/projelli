import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState } from 'react';
import { renameField, type FieldCatalog } from '@/features/crm-firm';
import { setDevFlagOverride } from '@/platform/flags';
import type { HouseholdRecord } from '../../adapters';
import {
  getHouseholdSections,
  type HouseholdRecordShellContext,
} from '../../recordRegistry';
import {
  CUSTOM_FIELD_VALUES_DATA_KEY,
  readCustomFieldValues,
  withCustomFieldValues,
} from './customFieldValues';
import { CustomFieldsSectionContent } from './CustomFieldsSection';

const { live } = vi.hoisted(() => ({
  live: {
    records: [] as unknown[],
    save: vi.fn(),
  },
}));

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => live,
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

afterEach(() => {
  cleanup();
  setDevFlagOverride('custom-fields-advisor', undefined);
});

beforeEach(() => {
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
  live.save.mockReset();
});

describe('advisor custom fields extension', () => {
  it('keeps the real registry mount absent with the flag off and renders it with the flag on', async () => {
    const descriptor = getHouseholdSections().find(
      (section) => section.id === 'custom-fields-advisor'
    );
    if (!descriptor)
      throw new Error('Expected the custom fields registry mount.');

    const { rerender } = render(descriptor.mount(context(household)));
    expect(
      screen.queryByTestId('custom-fields-advisor-section')
    ).not.toBeInTheDocument();

    setDevFlagOverride('custom-fields-advisor', true);
    rerender(descriptor.mount(context(household)));
    expect(
      await screen.findByTestId('custom-fields-advisor-section')
    ).toBeInTheDocument();
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
