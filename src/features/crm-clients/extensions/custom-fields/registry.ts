import { createElement } from 'react';
import type {
  HouseholdRecordExtensionDescriptor,
  HouseholdRecordShellSectionDescriptor,
} from '../../recordRegistry';
import { CustomFieldsSection } from './CustomFieldsSection';
import {
  CUSTOM_FIELD_VALUES_DATA_KEY,
  isCustomFieldValues,
} from './customFieldValues';

declare module '../../recordRegistry' {
  interface HouseholdSectionIdMap {
    'custom-fields-advisor': true;
  }
  interface HouseholdRecordExtensionKeyMap {
    'custom-fields.advisor': true;
  }
}

/** Registers the namespaced value bag without giving this lane catalog ownership. */
export const customFieldsAdvisorRecordExtension: HouseholdRecordExtensionDescriptor =
  {
    id: 'custom-fields-advisor-values',
    dataKey: CUSTOM_FIELD_VALUES_DATA_KEY,
    defaultValue: {},
    validate: isCustomFieldValues,
  };

/** Advisor values appear in the existing client-map record surface. */
export const customFieldsAdvisorSection: HouseholdRecordShellSectionDescriptor =
  {
    id: 'custom-fields-advisor',
    order: 50,
    tab: 'client_map',
    mount: ({ household, onSaveHousehold }) =>
      createElement(CustomFieldsSection, {
        // Persisted publications are updates within this record, not a new
        // editing context. Keeping this key stable lets dirty fields survive
        // those re-seeds; the state-owning child handles real workspace/record
        // boundaries explicitly.
        key: household.id,
        household,
        ...(onSaveHousehold ? { onSaveHousehold } : {}),
      }),
  };
