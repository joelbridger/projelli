import { describe, expect, it } from 'vitest';
import { SYSTEM_ROLE_PERMISSIONS } from '@/features/crm-firm/teams-roles';

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
  it('shows only owned or assigned households to an assigned-scope advisor when native enforcement is active', () => {
    expect(
      filterOwnClientRecords(
        records,
        { memberId: 'maya', role: advisor, operation: 'read' },
        true
      ).map((record) => record.id)
    ).toEqual(['owned', 'assigned']);
  });

  it('shows all households to a firm-wide reader', () => {
    expect(
      filterOwnClientRecords(
        records,
        { memberId: 'compliance', role: compliance, operation: 'read' },
        true
      ).map((record) => record.id)
    ).toEqual(['owned', 'assigned', 'other', 'label-only']);
  });

  it('keeps the existing unfiltered display behavior when native enforcement is NOT active', () => {
    // The decision is driven by the native-resolved state passed in, NOT the
    // renderer flag — so a renderer that believes the feature is on cannot make
    // the mirror claim isolation the native layer is not applying (Finding 6).
    expect(
      filterOwnClientRecords(
        records,
        { memberId: 'maya', role: advisor, operation: 'read' },
        false
      ).map((record) => record.id)
    ).toEqual(['owned', 'assigned', 'other', 'label-only']);
  });
});
