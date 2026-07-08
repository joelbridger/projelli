/**
 * Client groups (feedback line 13) — a local-first way to group clients in the
 * rail. Groups live ALONGSIDE the matter store in their own localStorage key;
 * they hold matter ids (never matter content), so nothing new leaves the
 * machine and there is no wire-schema change. A client may belong to many
 * groups; a group may be empty (and is still deletable).
 *
 * These tests pin the store contract before the UI is wired to it.
 */

import { beforeEach, describe, it, expect } from 'vitest';
import {
  useClientGroupStore,
  sanitizeClientGroups,
  type ClientGroup,
} from '@/platform/matter/clientGroupStore';

function reset() {
  useClientGroupStore.setState({ groups: [] });
}

describe('clientGroupStore — create / rename / delete', () => {
  beforeEach(reset);

  it('creates a named group with a stable id and no members', () => {
    const g = useClientGroupStore.getState().createGroup('  Retirement plans  ');
    expect(g.id).toMatch(/^cgroup_/);
    // Name is trimmed.
    expect(g.name).toBe('Retirement plans');
    expect(g.matterIds).toEqual([]);
    expect(useClientGroupStore.getState().groups).toHaveLength(1);
  });

  it('refuses to create a group with a blank name', () => {
    const g = useClientGroupStore.getState().createGroup('   ');
    expect(g).toBeNull();
    expect(useClientGroupStore.getState().groups).toHaveLength(0);
  });

  it('renames a group (trimmed) and ignores a blank rename', () => {
    const g = useClientGroupStore.getState().createGroup('Old')!;
    useClientGroupStore.getState().renameGroup(g.id, '  New name  ');
    expect(useClientGroupStore.getState().groups[0]!.name).toBe('New name');
    useClientGroupStore.getState().renameGroup(g.id, '   ');
    // Blank rename is a no-op — the name is unchanged.
    expect(useClientGroupStore.getState().groups[0]!.name).toBe('New name');
  });

  it('deletes a group — including an empty one', () => {
    const g = useClientGroupStore.getState().createGroup('Empty')!;
    expect(useClientGroupStore.getState().groups).toHaveLength(1);
    useClientGroupStore.getState().deleteGroup(g.id);
    expect(useClientGroupStore.getState().groups).toHaveLength(0);
  });
});

describe('clientGroupStore — membership', () => {
  beforeEach(reset);

  it('adds and removes members, de-duplicating adds', () => {
    const g = useClientGroupStore.getState().createGroup('Group')!;
    useClientGroupStore.getState().addToGroup(g.id, 'matter_a');
    useClientGroupStore.getState().addToGroup(g.id, 'matter_a'); // dupe
    useClientGroupStore.getState().addToGroup(g.id, 'matter_b');
    expect(useClientGroupStore.getState().groups[0]!.matterIds).toEqual([
      'matter_a',
      'matter_b',
    ]);
    useClientGroupStore.getState().removeFromGroup(g.id, 'matter_a');
    expect(useClientGroupStore.getState().groups[0]!.matterIds).toEqual([
      'matter_b',
    ]);
  });

  it('setGroupMembers replaces the whole membership set (de-duplicated)', () => {
    const g = useClientGroupStore.getState().createGroup('Group')!;
    useClientGroupStore
      .getState()
      .setGroupMembers(g.id, ['matter_x', 'matter_y', 'matter_x']);
    expect(useClientGroupStore.getState().groups[0]!.matterIds).toEqual([
      'matter_x',
      'matter_y',
    ]);
  });

  it('lets one client belong to multiple groups', () => {
    const a = useClientGroupStore.getState().createGroup('A')!;
    const b = useClientGroupStore.getState().createGroup('B')!;
    useClientGroupStore.getState().addToGroup(a.id, 'matter_shared');
    useClientGroupStore.getState().addToGroup(b.id, 'matter_shared');
    const groups = useClientGroupStore.getState().groups;
    expect(groups.find((x) => x.id === a.id)!.matterIds).toContain('matter_shared');
    expect(groups.find((x) => x.id === b.id)!.matterIds).toContain('matter_shared');
  });

  it('removing a matter from every group (e.g. on client delete) is safe', () => {
    const a = useClientGroupStore.getState().createGroup('A')!;
    const b = useClientGroupStore.getState().createGroup('B')!;
    useClientGroupStore.getState().addToGroup(a.id, 'gone');
    useClientGroupStore.getState().addToGroup(b.id, 'gone');
    useClientGroupStore.getState().removeMatterFromAllGroups('gone');
    expect(useClientGroupStore.getState().groups.every((x) => !x.matterIds.includes('gone'))).toBe(true);
  });
});

describe('sanitizeClientGroups — corrupt/legacy persisted data never throws', () => {
  it('coerces junk to an empty list', () => {
    expect(sanitizeClientGroups(undefined)).toEqual([]);
    expect(sanitizeClientGroups(null)).toEqual([]);
    expect(sanitizeClientGroups('nope')).toEqual([]);
    expect(sanitizeClientGroups({})).toEqual([]);
  });

  it('drops malformed entries and coerces member ids to unique strings', () => {
    const raw = [
      { id: 'cgroup_1', name: 'Good', matterIds: ['a', 'a', 'b', 7, null] },
      { id: '', name: 'no id', matterIds: [] }, // dropped: no id
      { id: 'cgroup_2', name: '   ', matterIds: [] }, // dropped: blank name
      { id: 'cgroup_3', name: 'No members field' }, // members default to []
      'garbage',
    ];
    const out: ClientGroup[] = sanitizeClientGroups(raw);
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe('cgroup_1');
    expect(out[0]!.matterIds).toEqual(['a', 'b']);
    expect(out[1]!.id).toBe('cgroup_3');
    expect(out[1]!.matterIds).toEqual([]);
  });
});
