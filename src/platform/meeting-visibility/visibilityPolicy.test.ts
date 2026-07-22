import { describe, expect, it } from 'vitest';
import {
  canViewMeetingVisibilitySubject,
  resolveMeetingVisibility,
  validateMeetingVisibilityPolicy,
  type DerivedMeetingVisibilitySubject,
  type MeetingVisibilityPolicy,
  type MeetingVisibilitySubject,
  type MeetingVisibilitySubjectKind,
  type RootMeetingVisibilitySubject,
} from './index';

const restrictedPolicy: MeetingVisibilityPolicy = {
  id: 'policy-private-review',
  mode: 'explicit-review',
  includedMemberIds: ['advisor-included'],
  excludedMemberIds: ['advisor-excluded'],
};

const root: RootMeetingVisibilitySubject = {
  id: 'meeting-note-1',
  kind: 'meeting-note',
  lineage: 'root',
  ownerRef: 'advisor-owner',
  visibilityPolicyId: restrictedPolicy.id,
};

function derived(
  id: string,
  kind: DerivedMeetingVisibilitySubject['kind'],
  parent: MeetingVisibilitySubject
): DerivedMeetingVisibilitySubject {
  return {
    id,
    kind,
    lineage: 'derived',
    parentRef: { id: parent.id, kind: parent.kind },
  };
}

function resolver(subjects: readonly MeetingVisibilitySubject[]) {
  const byRef = new Map(
    subjects.map((subject) => [`${subject.kind}:${subject.id}`, subject])
  );
  return (ref: { kind: MeetingVisibilitySubjectKind; id: string }) =>
    byRef.get(`${ref.kind}:${ref.id}`);
}

function decide(
  subject: MeetingVisibilitySubject,
  viewerId: string | null | undefined,
  policies: readonly unknown[] = [restrictedPolicy],
  parents: readonly MeetingVisibilitySubject[] = [root]
) {
  return resolveMeetingVisibility({
    subject,
    viewerId,
    policies,
    resolveParent: resolver(parents),
  });
}

describe('meeting visibility policy validation', () => {
  it('accepts exact explicit include and exclude lists', () => {
    expect(validateMeetingVisibilityPolicy(restrictedPolicy)).toEqual(
      restrictedPolicy
    );
  });

  it('accepts the existing unrestricted household mode without member lists', () => {
    expect(
      validateMeetingVisibilityPolicy({
        id: 'household-default',
        mode: 'inherit-household',
      })
    ).toEqual({ id: 'household-default', mode: 'inherit-household' });
  });

  it.each([
    null,
    { id: 'policy-private-review', mode: 'unknown' },
    {
      id: 'policy-private-review',
      mode: 'explicit-review',
      includedMemberIds: ['advisor-a'],
    },
    {
      id: 'policy-private-review',
      mode: 'explicit-review',
      includedMemberIds: ['advisor-a', 'advisor-a'],
      excludedMemberIds: [],
    },
    {
      id: 'policy-private-review',
      mode: 'explicit-review',
      includedMemberIds: ['advisor-a'],
      excludedMemberIds: ['advisor-a'],
    },
    {
      id: 'household-default',
      mode: 'inherit-household',
      includedMemberIds: [],
    },
  ])('rejects malformed policy data %#', (policy) => {
    expect(() => validateMeetingVisibilityPolicy(policy)).toThrow();
  });
});

describe('meeting visibility viewer decisions', () => {
  it('always lets the record owner see an explicit-review note', () => {
    expect(decide(root, 'advisor-owner')).toMatchObject({
      visible: true,
      reason: 'owner',
      ownerRef: 'advisor-owner',
    });
  });

  it('lets an explicitly included coworker see the note', () => {
    expect(decide(root, 'advisor-included')).toMatchObject({
      visible: true,
      reason: 'included',
    });
  });

  it('hides the note from an explicitly excluded coworker', () => {
    expect(decide(root, 'advisor-excluded')).toMatchObject({
      visible: false,
      reason: 'excluded',
    });
  });

  it('hides the note from a coworker who was not included', () => {
    expect(decide(root, 'advisor-other')).toMatchObject({
      visible: false,
      reason: 'not-included',
    });
  });

  it.each([null, undefined, '', '   '])(
    'fails closed when there is no usable current viewer (%p)',
    (viewerId) => {
      expect(decide(root, viewerId)).toMatchObject({
        visible: false,
        reason: 'no-viewer',
      });
    }
  );

  it('keeps a genuine legacy unrestricted record usable without a viewer', () => {
    const legacy: MeetingVisibilitySubject = {
      id: 'legacy-task',
      kind: 'task',
      lineage: 'legacy-unrestricted',
    };
    expect(decide(legacy, null, [], [])).toEqual({
      visible: true,
      reason: 'legacy-unrestricted',
    });
  });

  it('keeps an explicitly accountless solo record usable without inventing a viewer', () => {
    const solo: MeetingVisibilitySubject = {
      id: 'solo-meeting-note',
      kind: 'meeting-note',
      lineage: 'accountless-unrestricted',
    };
    expect(decide(solo, null, [], [])).toEqual({
      visible: true,
      reason: 'accountless-unrestricted',
    });
  });

  it('hides a non-legacy root that is missing its required policy', () => {
    const missingPolicyRoot: RootMeetingVisibilitySubject = {
      id: 'legacy-meeting-note',
      kind: 'meeting-note',
      lineage: 'root',
      ownerRef: 'advisor-owner',
    };
    expect(decide(missingPolicyRoot, 'advisor-owner', [], [])).toMatchObject({
      visible: false,
      reason: 'missing-policy',
    });
  });

  it('honours the existing unrestricted household mode', () => {
    const householdRoot: RootMeetingVisibilitySubject = {
      ...root,
      visibilityPolicyId: 'household-default',
    };
    expect(
      decide(
        householdRoot,
        'advisor-household',
        [{ id: 'household-default', mode: 'inherit-household' }],
        []
      )
    ).toMatchObject({ visible: true, reason: 'household-inherited' });
  });

  it('does not let household mode stand in for a missing viewer identity', () => {
    const householdRoot: RootMeetingVisibilitySubject = {
      ...root,
      visibilityPolicyId: 'household-default',
    };
    expect(
      decide(
        householdRoot,
        null,
        [{ id: 'household-default', mode: 'inherit-household' }],
        []
      )
    ).toMatchObject({ visible: false, reason: 'no-viewer' });
  });
});

describe('meeting visibility fail-closed behavior', () => {
  it('hides a restricted record when its policy is unknown', () => {
    expect(decide(root, 'advisor-owner', [], [])).toMatchObject({
      visible: false,
      reason: 'unknown-policy',
    });
  });

  it.each([
    {
      id: restrictedPolicy.id,
      mode: 'explicit-review',
      includedMemberIds: 'advisor-included',
      excludedMemberIds: [],
    },
    {
      id: restrictedPolicy.id,
      mode: 'explicit-review',
      includedMemberIds: ['advisor-included', 'advisor-included'],
      excludedMemberIds: [],
    },
    {
      id: restrictedPolicy.id,
      mode: 'explicit-review',
      includedMemberIds: ['advisor-included'],
      excludedMemberIds: ['advisor-included'],
    },
  ])('hides a restricted record when its policy is malformed %#', (policy) => {
    expect(decide(root, 'advisor-owner', [policy], [])).toMatchObject({
      visible: false,
      reason: 'malformed-policy',
    });
  });

  it('hides a record when duplicate policy IDs make the policy ambiguous', () => {
    expect(
      decide(root, 'advisor-owner', [restrictedPolicy, restrictedPolicy], [])
    ).toMatchObject({ visible: false, reason: 'malformed-policy' });
  });

  it.each([null, '', '   ', 42])(
    'hides a record with a malformed policy reference (%p)',
    (visibilityPolicyId) => {
      const malformed = {
        ...root,
        visibilityPolicyId,
      } as unknown as RootMeetingVisibilitySubject;
      expect(decide(malformed, 'advisor-owner')).toMatchObject({
        visible: false,
        reason: 'malformed-subject',
      });
    }
  );

  it('hides derived material when its exact parent cannot be found', () => {
    const task = derived('task-1', 'task', root);
    expect(decide(task, 'advisor-owner', [restrictedPolicy], [])).toMatchObject(
      {
        visible: false,
        reason: 'missing-parent',
      }
    );
  });

  it('hides a derived chain when neither it nor its non-legacy root has a policy', () => {
    const missingPolicyRoot: RootMeetingVisibilitySubject = {
      id: 'meeting-note-without-policy',
      kind: 'meeting-note',
      lineage: 'root',
      ownerRef: 'advisor-owner',
    };
    const task = derived('task-without-policy', 'task', missingPolicyRoot);
    expect(
      decide(task, 'advisor-owner', [], [missingPolicyRoot])
    ).toMatchObject({ visible: false, reason: 'missing-policy' });
  });

  it('does not let a derived subject inherit the legacy-unrestricted escape hatch', () => {
    const legacyParent: MeetingVisibilitySubject = {
      id: 'legacy-parent',
      kind: 'activity',
      lineage: 'legacy-unrestricted',
    };
    const task = derived('derived-from-legacy', 'task', legacyParent);
    expect(decide(task, 'advisor-owner', [], [legacyParent])).toMatchObject({
      visible: false,
      reason: 'missing-policy',
    });
  });

  it('hides derived material when the parent resolver returns a different identity', () => {
    const task = derived('task-1', 'task', root);
    expect(
      resolveMeetingVisibility({
        subject: task,
        viewerId: 'advisor-owner',
        policies: [restrictedPolicy],
        resolveParent: () => ({ ...root, id: 'different-note' }),
      })
    ).toMatchObject({ visible: false, reason: 'parent-mismatch' });
  });

  it('hides derived material when parent resolution throws', () => {
    const task = derived('task-1', 'task', root);
    expect(
      resolveMeetingVisibility({
        subject: task,
        viewerId: 'advisor-owner',
        policies: [restrictedPolicy],
        resolveParent: () => {
          throw new Error('store unavailable');
        },
      })
    ).toMatchObject({ visible: false, reason: 'parent-unavailable' });
  });

  it('refuses a cycle instead of treating it as unrestricted', () => {
    const task = {
      id: 'task-cycle',
      kind: 'task',
      lineage: 'derived',
      parentRef: { id: 'activity-cycle', kind: 'activity' },
    } satisfies DerivedMeetingVisibilitySubject;
    const activity = {
      id: 'activity-cycle',
      kind: 'activity',
      lineage: 'derived',
      parentRef: { id: 'task-cycle', kind: 'task' },
    } satisfies DerivedMeetingVisibilitySubject;
    expect(
      decide(task, 'advisor-owner', [restrictedPolicy], [task, activity])
    ).toMatchObject({ visible: false, reason: 'cycle' });
  });

  it('refuses conflicting owner or policy data in one lineage', () => {
    const task = {
      ...derived('task-conflict', 'task', root),
      ownerRef: 'different-owner',
    };
    expect(decide(task, 'advisor-owner')).toMatchObject({
      visible: false,
      reason: 'conflicting-lineage',
    });
  });
});

describe('meeting visibility parent inheritance', () => {
  function chainWithParentLinks(
    parentLinks: number,
    outermostPatch: Partial<DerivedMeetingVisibilitySubject> = {}
  ): {
    readonly subject: DerivedMeetingVisibilitySubject;
    readonly parents: readonly MeetingVisibilitySubject[];
  } {
    let subject: MeetingVisibilitySubject = root;
    const parents: MeetingVisibilitySubject[] = [root];
    for (let index = 0; index < parentLinks; index += 1) {
      subject = derived(`chain-${String(index)}`, 'meeting-artifact', subject);
      parents.push(subject);
    }
    return {
      subject: {
        ...subject,
        ...outermostPatch,
      } as DerivedMeetingVisibilitySubject,
      parents,
    };
  }

  it('inherits one restricted decision across every named derived record kind', () => {
    const artifact = derived('artifact-1', 'meeting-artifact', root);
    const task = derived('task-1', 'task', artifact);
    const activity = derived('activity-1', 'activity', task);
    const proposal = derived('proposal-1', 'proposal', activity);
    const file = derived('file-1', 'file-reference', proposal);
    const parents = [root, artifact, task, activity, proposal, file];

    for (const subject of [artifact, task, activity, proposal, file]) {
      expect(
        decide(subject, 'advisor-included', [restrictedPolicy], parents)
      ).toMatchObject({ visible: true, reason: 'included' });
      expect(
        decide(subject, 'advisor-excluded', [restrictedPolicy], parents)
      ).toMatchObject({ visible: false, reason: 'excluded' });
    }
  });

  it('accepts a copied policy only when it agrees with the parent lineage', () => {
    const artifact = {
      ...derived('artifact-1', 'meeting-artifact', root),
      visibilityPolicyId: restrictedPolicy.id,
    };
    expect(decide(artifact, 'advisor-included')).toMatchObject({
      visible: true,
      reason: 'included',
    });

    const conflicting = {
      ...artifact,
      visibilityPolicyId: 'different-policy',
    };
    expect(
      decide(
        conflicting,
        'advisor-included',
        [
          restrictedPolicy,
          {
            id: 'different-policy',
            mode: 'explicit-review',
            includedMemberIds: ['advisor-included'],
            excludedMemberIds: [],
          },
        ],
        [root]
      )
    ).toMatchObject({ visible: false, reason: 'conflicting-lineage' });
  });

  it('exports a boolean helper that uses the same central decision', () => {
    expect(
      canViewMeetingVisibilitySubject({
        subject: root,
        viewerId: 'advisor-included',
        policies: [restrictedPolicy],
        resolveParent: resolver([]),
      })
    ).toBe(true);
    expect(
      canViewMeetingVisibilitySubject({
        subject: root,
        viewerId: 'advisor-excluded',
        policies: [restrictedPolicy],
        resolveParent: resolver([]),
      })
    ).toBe(false);
  });

  it.each([63, 64])(
    'processes the terminal root after %i parent links',
    (parentLinks) => {
      const chain = chainWithParentLinks(parentLinks);
      expect(
        decide(
          chain.subject,
          'advisor-included',
          [restrictedPolicy],
          chain.parents
        )
      ).toMatchObject({ visible: true, reason: 'included' });
    }
  );

  it('fails closed when a chain needs 65 parent links', () => {
    const chain = chainWithParentLinks(65);
    expect(
      decide(
        chain.subject,
        'advisor-included',
        [restrictedPolicy],
        chain.parents
      )
    ).toMatchObject({ visible: false, reason: 'lineage-too-deep' });
  });

  it.each([
    { ownerRef: 'different-owner' },
    { visibilityPolicyId: 'different-policy' },
  ])(
    'detects a copied owner or policy conflict at the 64-link boundary',
    (outermostPatch) => {
      const chain = chainWithParentLinks(64, outermostPatch);
      expect(
        decide(
          chain.subject,
          'advisor-included',
          [
            restrictedPolicy,
            {
              id: 'different-policy',
              mode: 'explicit-review',
              includedMemberIds: ['advisor-included'],
              excludedMemberIds: [],
            },
          ],
          chain.parents
        )
      ).toMatchObject({ visible: false, reason: 'conflicting-lineage' });
    }
  );
});
