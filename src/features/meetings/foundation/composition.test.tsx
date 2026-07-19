import { afterEach, describe, expect, it } from 'vitest';
import { BLESSED_MEETING_PANEL_IDS } from '@/features/meetings';
// Import the composition contracts from the PUBLIC surface only, exactly as an
// outside dependent would — this is the registry MeetingEntry renders through
// its default composition, so a contribution here is load-bearing in the host.
import {
  createMeetingPanelComposition,
  defaultMeetingPanelComposition,
  createMeetingHeaderActionComposition,
  defaultMeetingHeaderActionComposition,
  createMeetingInsightComposition,
  defaultMeetingInsightComposition,
  registerMeetingPanel,
  getMeetingPanelComposition,
  registerMeetingHeaderAction,
  getMeetingHeaderActionComposition,
  registerMeetingInsight,
  getMeetingInsightComposition,
  type MeetingPanelDescriptor,
  type MeetingPanelId,
  type MeetingHeaderActionDescriptor,
  type MeetingHeaderActionId,
  type MeetingInsightDescriptor,
  type MeetingInsightId,
} from '@/features/meetings';

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

const panel = (
  id: string,
  order: number,
  extra: Partial<MeetingPanelDescriptor> = {}
): MeetingPanelDescriptor => ({
  id: id as MeetingPanelId,
  order,
  labelKey: 'meetings.demo.tab',
  mount: () => null,
  ...extra,
});

const action = (
  id: string,
  order: number,
  extra: Partial<MeetingHeaderActionDescriptor> = {}
): MeetingHeaderActionDescriptor => ({
  id: id as MeetingHeaderActionId,
  order,
  labelKey: 'meetings.demo.action',
  placement: 'secondary',
  mount: () => null,
  ...extra,
});

const insight = (
  id: string,
  order: number,
  meetingSummary: boolean,
  extra: Partial<MeetingInsightDescriptor> = {}
): MeetingInsightDescriptor => {
  const artifactId = `${id}-artifact`;
  return {
    id: id as MeetingInsightId,
    order,
    version: 1,
    mounts: { meetingSummary, clientSummary: false },
    prerequisites: [],
    artifactProducer: { artifactId, produce: () => Promise.resolve(null) },
    artifactStore: {
      artifactId,
      version: 1,
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(null),
    },
    selectors: { pick: () => null },
    settings: {
      id: `${id}-settings`,
      labelKey: 'meetings.demo.settings',
      mount: () => null,
    },
    renderMeetingSummary: () => null,
    renderClientSummary: () => null,
    ...extra,
  };
};

describe('meeting panel registry (closed blessed manifest)', () => {
  it('renders the exact base composition the host reads with no contributions', () => {
    // These are the descriptors MeetingEntry renders through the defaults.
    expect(ids(defaultMeetingPanelComposition.panels)).toEqual([
      'summary',
      'transcript',
    ]);
    expect(ids(defaultMeetingHeaderActionComposition.actions)).toEqual([
      'send',
      'mark_reviewed',
      'utilities',
    ]);
    expect(ids(defaultMeetingInsightComposition.registered)).toEqual([
      'review_status',
    ]);
    expect(defaultMeetingInsightComposition.meetingSummary).toEqual([]);
  });

  it('maps the two legacy content tabs into blessed slots in manifest order', () => {
    expect(ids(createMeetingPanelComposition().panels)).toEqual([
      'summary',
      'transcript',
    ]);
  });

  it('returns the registered subset in blessed order, not caller order', () => {
    expect(
      ids(
        createMeetingPanelComposition(
          panel('follow-up', 1),
          panel('agenda', 999),
          panel('tasks', 2)
        ).panels
      )
    ).toEqual(['agenda', 'summary', 'transcript', 'tasks', 'follow-up']);
    expect(
      ids(createMeetingHeaderActionComposition(action('archive', 15)).actions)
    ).toEqual(['send', 'archive', 'mark_reviewed', 'utilities']);
    const withInsight = createMeetingInsightComposition(
      insight('trend', 5, true)
    );
    expect(ids(withInsight.registered)).toContain('trend');
    expect(ids(withInsight.meetingSummary)).toEqual(['trend']);
  });

  it('rejects an off-list id before it can reach the host', () => {
    expect(() => createMeetingPanelComposition(panel('media', 5))).toThrow(
      'panel id is not in the blessed manifest: media'
    );
  });

  it('rejects an attempted visible eighth tab', () => {
    expect(() =>
      createMeetingPanelComposition(
        ...BLESSED_MEETING_PANEL_IDS.map((id, index) => panel(id, index)),
        panel('media', 99)
      )
    ).toThrow('visible panel limit exceeded: 8 (maximum 7)');
  });

  it('excludes a dark (unavailable) blessed contribution from what the host renders', () => {
    expect(
      ids(
        createMeetingPanelComposition(
          panel('agenda', 5, { isAvailable: () => false })
        ).panels
      )
    ).toEqual(['summary', 'transcript']);
    expect(
      ids(
        createMeetingHeaderActionComposition(
          action('dark', 5, { isAvailable: () => false })
        ).actions
      )
    ).toEqual(['send', 'mark_reviewed', 'utilities']);
    expect(
      createMeetingInsightComposition(
        insight('dark', 5, true, { isAvailable: () => false })
      ).meetingSummary
    ).toEqual([]);
  });

  it('accepts exactly the blessed ids and rejects a duplicate contribution', () => {
    expect(
      ids(
        createMeetingPanelComposition(
          ...BLESSED_MEETING_PANEL_IDS.map((id, index) => panel(id, index))
        ).panels
      )
    ).toEqual(BLESSED_MEETING_PANEL_IDS);
    expect(() =>
      createMeetingPanelComposition(panel('agenda', 1), panel('agenda', 2))
    ).toThrow('duplicate panel id: agenda');
    expect(() =>
      createMeetingHeaderActionComposition(action('send', 99))
    ).toThrow('duplicate action id: send');
    expect(() =>
      createMeetingInsightComposition(insight('review_status', 99, true))
    ).toThrow('duplicate insight id: review_status');
  });

  it('rejects malformed contributions', () => {
    expect(() =>
      createMeetingPanelComposition(panel('agenda', 15, { labelKey: 'nodot' }))
    ).toThrow('labelKey must be namespaced');
    expect(() =>
      createMeetingHeaderActionComposition(
        action('badplace', 15, {
          placement: 'floating' as MeetingHeaderActionDescriptor['placement'],
        })
      )
    ).toThrow('invalid action contract');
    expect(() =>
      createMeetingInsightComposition(
        insight('badver', 15, true, { version: 0 })
      )
    ).toThrow('version must be a positive integer');
  });
});

describe('meeting composition weave (the host reads registered contributions)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });
  const track = (off: () => void) => {
    cleanups.push(off);
    return off;
  };

  it('registers a panel into the live host composition and removes it on unregister', () => {
    // The host getter (what MeetingEntry reads) starts at the base tabs.
    expect(ids(getMeetingPanelComposition().panels)).toEqual([
      'summary',
      'transcript',
    ]);
    const off = track(registerMeetingPanel(panel('agenda', 15)));
    // The registered contribution now appears in the HOST composition, in order,
    // and equals what the outside builder would produce for the same input.
    expect(ids(getMeetingPanelComposition().panels)).toEqual([
      'agenda',
      'summary',
      'transcript',
    ]);
    expect(ids(getMeetingPanelComposition().panels)).toEqual(
      ids(createMeetingPanelComposition(panel('agenda', 15)).panels)
    );
    off();
    cleanups.pop();
    expect(ids(getMeetingPanelComposition().panels)).toEqual([
      'summary',
      'transcript',
    ]);
  });

  it('registers a header action into the live host composition', () => {
    track(registerMeetingHeaderAction(action('archive', 15)));
    expect(ids(getMeetingHeaderActionComposition().actions)).toEqual([
      'send',
      'archive',
      'mark_reviewed',
      'utilities',
    ]);
  });

  it('registers an insight that reaches the host meeting-summary composition', () => {
    track(registerMeetingInsight(insight('trend', 5, true)));
    expect(ids(getMeetingInsightComposition().meetingSummary)).toEqual([
      'trend',
    ]);
    expect(ids(getMeetingInsightComposition().registered)).toContain('trend');
  });

  it('rejects a duplicate registration and never adds it to the host', () => {
    track(registerMeetingPanel(panel('agenda', 15)));
    expect(() => registerMeetingPanel(panel('agenda', 99))).toThrow(
      'duplicate panel id: agenda'
    );
    // Exactly one 'agenda' remains in the host composition.
    expect(
      ids(getMeetingPanelComposition().panels).filter((id) => id === 'agenda')
    ).toHaveLength(1);
  });

  it('accepts every blessed slot and rejects an eighth visible registration', () => {
    expect(() => registerMeetingPanel(panel('media', 99))).toThrow(
      'panel id is not in the blessed manifest: media'
    );
    for (const [index, id] of BLESSED_MEETING_PANEL_IDS.entries()) {
      track(registerMeetingPanel(panel(id, index)));
    }
    expect(ids(getMeetingPanelComposition().panels)).toEqual(
      BLESSED_MEETING_PANEL_IDS
    );
    expect(() => registerMeetingPanel(panel('media', 99))).toThrow(
      'visible panel limit exceeded: 8 (maximum 7)'
    );
  });

  it('excludes a dark registered contribution from the host', () => {
    track(
      registerMeetingPanel(panel('agenda', 5, { isAvailable: () => false }))
    );
    expect(ids(getMeetingPanelComposition().panels)).toEqual([
      'summary',
      'transcript',
    ]);
  });
});
