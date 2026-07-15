/* eslint-disable lantern-i18n/no-hardcoded-string -- Dummy labels are test-only registry mounts. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  getOpportunityFields,
  getPipelineViews,
  mountOpportunityFields,
  mountPipelineView,
  validateOpportunityFieldDescriptors,
  validatePipelineViewDescriptors,
  type OpportunityFieldDescriptor,
  type PipelineViewDescriptor,
} from './pipelineExtensionRegistry';

declare module './pipelineExtensionRegistry' {
  interface PipelineViewIdMap {
    'test.dummy-view': true;
  }
  interface OpportunityFieldIdMap {
    'test.dummy-field': true;
  }
}

describe('pipeline extension registries', () => {
  it('keeps compatibility descriptors in stable order', () => {
    expect(getPipelineViews().map(({ id }) => id)).toEqual([
      'pipeline',
      'pipeline-settings',
    ]);
    expect(getOpportunityFields().map(({ id }) => id)).toEqual([
      'legacy.core-opportunity-fields',
    ]);
  });

  it('mounts a view and opportunity field without a shell switch edit', () => {
    const view: PipelineViewDescriptor = {
      id: 'test.dummy-view',
      order: 30,
      mount: () => <span>Dummy pipeline view</span>,
    };
    const field: OpportunityFieldDescriptor = {
      id: 'test.dummy-field',
      order: 20,
      mount: () => <span>Dummy opportunity field</span>,
    };

    render(
      <>
        {mountPipelineView(
          'test.dummy-view',
          {
            data: {
              records: [],
              save: (record) => Promise.resolve(record),
              error: null,
              freshness: { kind: 'live' },
            },
            onNavigate: () => undefined,
          },
          [view]
        )}
        {mountOpportunityFields(
          { opportunity: null, compatibilityMount: null },
          [field]
        )}
      </>
    );

    expect(screen.getByText('Dummy pipeline view')).toBeInTheDocument();
    expect(screen.getByText('Dummy opportunity field')).toBeInTheDocument();
  });

  it('rejects duplicate ids and malformed descriptors clearly', () => {
    const view = getPipelineViews()[0];
    const field = getOpportunityFields()[0];
    if (!view || !field) throw new Error('Expected compatibility descriptors');

    expect(() => {
      validatePipelineViewDescriptors([view, view]);
    }).toThrow('duplicate id: pipeline');
    expect(() => {
      validateOpportunityFieldDescriptors([field, field]);
    }).toThrow('duplicate id: legacy.core-opportunity-fields');
    expect(() => {
      validatePipelineViewDescriptors([{ ...view, order: Number.NaN }]);
    }).toThrow('order must be finite: pipeline');
    expect(() => {
      validateOpportunityFieldDescriptors([{ ...field, mount: null as never }]);
    }).toThrow('mount must be a function: legacy.core-opportunity-fields');
  });

  it('keeps misspelled ids out at type-check time', () => {
    const invalid: PipelineViewDescriptor = {
      // @ts-expect-error This id is not registered through module augmentation.
      id: 'test.dumy-view',
      order: 10,
      mount: () => null,
    };
    expect(invalid.id).toBe('test.dumy-view');
  });
});
