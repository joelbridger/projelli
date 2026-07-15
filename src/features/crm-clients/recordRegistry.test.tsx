import { describe, expect, it } from 'vitest';
import {
  getHouseholdAddActions,
  getHouseholdHeaderActions,
  getHouseholdRecordExtensions,
  getHouseholdSections,
  validateHouseholdAddActionDescriptors,
  validateHouseholdHeaderActionDescriptors,
  validateHouseholdRecordExtensionDescriptors,
  validateHouseholdSectionDescriptors,
} from './recordRegistry';
import {
  householdTabRegistry,
  validateHouseholdTabDescriptors,
} from './tabRegistry';

describe('household record registries', () => {
  it('keeps compatibility mounts in their existing stable order', () => {
    expect(
      getHouseholdHeaderActions().map((descriptor) => descriptor.id)
    ).toEqual(['ask', 'metadata', 'edit', 'schedule']);
    expect(getHouseholdAddActions().map((descriptor) => descriptor.id)).toEqual(
      [
        'fact',
        'note',
        'task',
        'account',
        'person',
        'opportunity',
        'workflow',
        'client_note',
      ]
    );
    expect(getHouseholdSections().map((descriptor) => descriptor.id)).toEqual([
      'client_map',
      'employment',
    ]);
    expect(
      getHouseholdRecordExtensions().map((descriptor) => descriptor.dataKey)
    ).toEqual(['legacy.record-metadata']);
  });

  it('rejects duplicate extension data keys clearly', () => {
    const descriptor = getHouseholdRecordExtensions()[0];
    if (!descriptor)
      throw new Error('Expected the legacy extension descriptor');
    expect(() => {
      validateHouseholdRecordExtensionDescriptors([descriptor, descriptor]);
    }).toThrow('duplicate extension id: legacy-record-metadata');
    expect(() => {
      validateHouseholdRecordExtensionDescriptors([
        descriptor,
        { ...descriptor, id: 'other-extension' },
      ]);
    }).toThrow('duplicate data key: legacy.record-metadata');
  });

  it('rejects duplicate tab ids clearly', () => {
    const first = householdTabRegistry[0];
    if (!first) throw new Error('Expected a compatibility tab');
    expect(() => {
      validateHouseholdTabDescriptors([...householdTabRegistry, first]);
    }).toThrow(`duplicate tab id: ${first.id}`);
  });

  it('rejects duplicate header, Add-menu, and section ids clearly', () => {
    const header = getHouseholdHeaderActions()[0];
    const addAction = getHouseholdAddActions()[0];
    const section = getHouseholdSections()[0];
    if (!header || !addAction || !section)
      throw new Error('Expected compatibility registry descriptors');

    expect(() => {
      validateHouseholdHeaderActionDescriptors([header, header]);
    }).toThrow(`duplicate id: ${header.id}`);
    expect(() => {
      validateHouseholdAddActionDescriptors([addAction, addAction]);
    }).toThrow(`duplicate id: ${addAction.id}`);
    expect(() => {
      validateHouseholdSectionDescriptors([section, section]);
    }).toThrow(`duplicate id: ${section.id}`);
  });

  it('rejects invalid extension descriptors clearly', () => {
    expect(() => {
      validateHouseholdRecordExtensionDescriptors([
        {
          id: 'invalid-extension',
          dataKey: 'not-namespaced' as never,
          defaultValue: 'bad',
          validate: (value): value is number => typeof value === 'number',
        },
      ]);
    }).toThrow('data key must be namespaced: invalid-extension');
    expect(() => {
      validateHouseholdRecordExtensionDescriptors([
        {
          id: 'bad-default',
          dataKey: 'example.bad-default' as never,
          defaultValue: 'bad',
          validate: (value): value is number => typeof value === 'number',
        },
      ]);
    }).toThrow('default fails validator: bad-default');
  });
});
