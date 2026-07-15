import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PermissionPolicyDescriptor } from './permissionPolicyRegistry';
import {
  ownClientsOnlyPolicy,
  permissionPolicyRegistry,
  validatePermissionPolicyRegistry,
} from './permissionPolicyRegistry';

const registryDirectory = dirname(fileURLToPath(import.meta.url));
const registrySkillPath = join(registryDirectory, 'SKILL.md');

describe('permissionPolicyRegistry', () => {
  it('keeps the required registry instructions beside the append-only registry', () => {
    expect(existsSync(registrySkillPath)).toBe(true);
    expect(readFileSync(registrySkillPath, 'utf8')).toContain(
      'Permission policy registry'
    );
  });

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
