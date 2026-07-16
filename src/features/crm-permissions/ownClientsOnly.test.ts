import { describe, expect, it } from 'vitest';
import { SYSTEM_ROLE_PERMISSIONS } from '@/features/crm-firm/teams-roles';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

import {
  filterOwnClientRecords,
  ownClientsEnforcementActive,
  permitsOwnClientRecord,
} from './ownClientsOnly';

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

describe('own-clients-only single-record mirror (permitsOwnClientRecord)', () => {
  const owned: LiveCrmRecord = {
    id: 'owned',
    kind: 'household',
    ownerMemberId: 'maya',
  };
  const other: LiveCrmRecord = {
    id: 'other',
    kind: 'household',
    ownerMemberId: 'noah',
  };

  it('permits an owned household and refuses another member\'s household to an assigned-scope advisor when native enforcement is active', () => {
    const context = {
      memberId: 'maya',
      role: advisor,
      operation: 'write' as const,
    };
    expect(permitsOwnClientRecord(owned, context, true)).toBe(true);
    expect(permitsOwnClientRecord(other, context, true)).toBe(false);
  });

  it('permits every household — including another member\'s — when native enforcement is NOT active', () => {
    // Dark = unfiltered: a merge/permission-validation consumer must not block
    // on the mirror while enforcement is inactive; native is the only authority.
    const context = {
      memberId: 'maya',
      role: advisor,
      operation: 'write' as const,
    };
    expect(permitsOwnClientRecord(owned, context, false)).toBe(true);
    expect(permitsOwnClientRecord(other, context, false)).toBe(true);
  });
});

describe('ownClientsEnforcementActive (deferred-enforcement stub)', () => {
  it('resolves false because the native enforcement engine is not present in this build', async () => {
    await expect(ownClientsEnforcementActive()).resolves.toBe(false);
  });
});
