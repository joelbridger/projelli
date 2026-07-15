import { describe, expect, it } from 'vitest';
import type { PermissionPolicyDescriptor } from './permissionPolicyRegistry';
import {
  ownClientsOnlyPolicy,
  permissionPolicyRegistry,
  validatePermissionPolicyRegistry,
} from './permissionPolicyRegistry';

describe('permissionPolicyRegistry', () => {
  it('exports the own-clients-only policy for consumers', () => {
    expect(permissionPolicyRegistry).toEqual([ownClientsOnlyPolicy]);
  });

  it('rejects duplicate policy ids', () => {
    expect(() => {
      validatePermissionPolicyRegistry([
        ownClientsOnlyPolicy,
        { ...ownClientsOnlyPolicy },
      ]);
    }).toThrow('Duplicate permission policy id: own-clients-only.');
  });

  it('rejects missing required policy fields', () => {
    const missingDescription: PermissionPolicyDescriptor = {
      ...ownClientsOnlyPolicy,
      id: 'missing-description',
      description: '',
    };
    expect(() => {
      validatePermissionPolicyRegistry([missingDescription]);
    }).toThrow('Permission policy missing-description requires a description.');
  });

  it('rejects a policy that names a frontend authority', () => {
    expect(() => {
      validatePermissionPolicyRegistry([
        { ...ownClientsOnlyPolicy, id: 'frontend-only', authority: 'frontend' },
      ]);
    }).toThrow(
      'Permission policy frontend-only must name native-command-layer as authority.'
    );
  });
});
