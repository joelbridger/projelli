import { describe, expect, it, vi } from 'vitest';
import { SYSTEM_ROLE_PERMISSIONS } from '@/features/crm-firm/teams-roles';

const { flagEnabled } = vi.hoisted(() => ({ flagEnabled: { value: true } }));

vi.mock('@/platform/flags/router', () => ({
  isEnabled: () => flagEnabled.value,
}));

import { filterOwnClientRecords } from './ownClientsOnly';

const advisor = SYSTEM_ROLE_PERMISSIONS.find((role) => role.id === 'advisor');
const compliance = SYSTEM_ROLE_PERMISSIONS.find(
  (role) => role.id === 'compliance-admin'
);

const records = [
  { id: 'owned', kind: 'household', ownerMemberId: 'maya' },
  { id: 'assigned', kind: 'household', assignedMemberIds: ['maya'] },
  { id: 'other', kind: 'household', ownerMemberId: 'noah' },
  { id: 'label-only', kind: 'household', primaryAdvisor: 'Maya' },
];

describe('own-clients-only display mirror', () => {
  it('shows only owned or assigned households to an assigned-scope advisor', () => {
    expect(
      filterOwnClientRecords(records, {
        memberId: 'maya',
        role: advisor,
        operation: 'read',
      }).map((record) => record.id)
    ).toEqual(['owned', 'assigned']);
  });

  it('shows all households to a firm-wide reader', () => {
    expect(
      filterOwnClientRecords(records, {
        memberId: 'compliance',
        role: compliance,
        operation: 'read',
      }).map((record) => record.id)
    ).toEqual(['owned', 'assigned', 'other', 'label-only']);
  });

  it('keeps the existing unfiltered display behavior while the flag is off', () => {
    flagEnabled.value = false;
    expect(
      filterOwnClientRecords(records, {
        memberId: 'maya',
        role: advisor,
        operation: 'read',
      }).map((record) => record.id)
    ).toEqual(['owned', 'assigned', 'other', 'label-only']);
    flagEnabled.value = true;
  });
});
