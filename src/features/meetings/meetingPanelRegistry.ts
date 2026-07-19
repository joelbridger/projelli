import type { MeetingPanelDescriptor } from './meetingWorkspaceTypes';
import { legacyMeetingPanels } from './meetingWorkspaceCompatibility';

/**
 * The only meeting-detail panel slots the product can render. New panel lanes
 * must import an id from this sealed manifest rather than inventing one.
 */
export const BLESSED_MEETING_PANEL_IDS = Object.freeze([
  'prep',
  'agenda',
  'summary',
  'transcript',
  'tasks',
  'crm-update',
  'follow-up',
] as const);

export type BlessedMeetingPanelId = (typeof BLESSED_MEETING_PANEL_IDS)[number];

declare module './meetingWorkspaceTypes' {
  interface MeetingPanelIdMap {
    prep: true;
    agenda: true;
    tasks: true;
    'crm-update': true;
    'follow-up': true;
  }
}

export type {
  MeetingPanelContext,
  MeetingPanelDescriptor,
  MeetingPanelId,
  MeetingPanelIdMap,
} from './meetingWorkspaceTypes';

const BLESSED_MEETING_PANEL_ID_SET = new Set<string>(BLESSED_MEETING_PANEL_IDS);

const BLESSED_MEETING_PANEL_ORDER = new Map<string, number>(
  BLESSED_MEETING_PANEL_IDS.map((id, index) => [id, index])
);

/** The two pre-manifest content tabs occupy their matching live slots. */
const LEGACY_PANEL_ID_TO_BLESSED_ID: Readonly<
  Record<string, BlessedMeetingPanelId>
> = {
  transcript: 'transcript',
  summary: 'summary',
};

function isBlessedMeetingPanelId(id: string): id is BlessedMeetingPanelId {
  return BLESSED_MEETING_PANEL_ID_SET.has(id);
}

function assertBlessedMeetingPanelId(id: string): void {
  if (!isBlessedMeetingPanelId(id)) {
    throw new Error(
      `[meetingPanelRegistry] panel id is not in the blessed manifest: ${id}`
    );
  }
}

function countVisiblePanels(
  descriptors: readonly MeetingPanelDescriptor[]
): number {
  return descriptors.filter((descriptor) => descriptor.isAvailable?.() ?? true)
    .length;
}

function assertVisiblePanelLimit(
  descriptors: readonly MeetingPanelDescriptor[]
): void {
  const visiblePanelCount = countVisiblePanels(descriptors);
  if (visiblePanelCount > BLESSED_MEETING_PANEL_IDS.length) {
    throw new Error(
      `[meetingPanelRegistry] visible panel limit exceeded: ${String(visiblePanelCount)} (maximum ${String(BLESSED_MEETING_PANEL_IDS.length)})`
    );
  }
}

function validateLabelKey(registryName: string, id: string, labelKey: string) {
  if (!labelKey.includes('.')) {
    throw new Error(`[${registryName}] labelKey must be namespaced: ${id}`);
  }
}

export function validateMeetingPanelDescriptors(
  descriptors: readonly MeetingPanelDescriptor[]
): void {
  assertVisiblePanelLimit(descriptors);
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    assertBlessedMeetingPanelId(descriptor.id);
    if (ids.has(descriptor.id)) {
      throw new Error(
        `[meetingPanelRegistry] duplicate panel id: ${descriptor.id}`
      );
    }
    ids.add(descriptor.id);
    if (!Number.isFinite(descriptor.order)) {
      throw new Error(
        `[meetingPanelRegistry] order must be finite: ${descriptor.id}`
      );
    }
    validateLabelKey(
      'meetingPanelRegistry',
      descriptor.id,
      descriptor.labelKey
    );
    if (typeof descriptor.mount !== 'function') {
      throw new Error(
        `[meetingPanelRegistry] invalid panel contract: ${descriptor.id}`
      );
    }
  }
}

/**
 * Compatibility entries keep their existing mounts while claiming their fixed
 * v2 slots. Recording is deliberately not bridged: audio is secondary media,
 * not a meeting-detail tab. This chokepoint keeps its renderer available for
 * the later media handoff without letting the raw id reach a composed host tab.
 */
export const meetingPanelRegistry: readonly MeetingPanelDescriptor[] =
  legacyMeetingPanels.flatMap((descriptor) => {
    const blessedId = LEGACY_PANEL_ID_TO_BLESSED_ID[descriptor.id];
    if (!blessedId) {
      if (descriptor.id === 'recording') return [];
      throw new Error(
        `[meetingPanelRegistry] legacy panel has no blessed manifest slot: ${descriptor.id}`
      );
    }
    return { ...descriptor, id: blessedId };
  });

export function getMeetingPanels(
  descriptors: readonly MeetingPanelDescriptor[] = meetingPanelRegistry
): readonly MeetingPanelDescriptor[] {
  validateMeetingPanelDescriptors(descriptors);
  return descriptors
    .filter((descriptor) => descriptor.isAvailable?.() ?? true)
    .sort((a, b) => {
      const aOrder = BLESSED_MEETING_PANEL_ORDER.get(a.id);
      const bOrder = BLESSED_MEETING_PANEL_ORDER.get(b.id);
      if (aOrder === undefined || bOrder === undefined) {
        throw new Error(
          '[meetingPanelRegistry] blessed panel ordering is incomplete'
        );
      }
      return aOrder - bOrder;
    });
}

export interface MeetingPanelComposition {
  /** Ordered, available panels the host renders as tabs — base + contributions. */
  readonly panels: readonly MeetingPanelDescriptor[];
}

/**
 * Closed-world panel composition. Contributions can replace a compatibility
 * mount in its fixed slot or fill an empty blessed slot. Every other id and an
 * eighth visible panel are rejected before the host can render them.
 */
export function createMeetingPanelComposition(
  ...contributions: readonly MeetingPanelDescriptor[]
): MeetingPanelComposition {
  validateMeetingPanelDescriptors(contributions);
  const panelsById = new Map<string, MeetingPanelDescriptor>(
    meetingPanelRegistry.map((descriptor) => [descriptor.id, descriptor])
  );
  for (const descriptor of contributions) {
    panelsById.set(descriptor.id, descriptor);
  }
  return {
    panels: getMeetingPanels([...panelsById.values()]),
  };
}

/** Base composition with no contributions (the legacy compatibility tabs). */
export const defaultMeetingPanelComposition: MeetingPanelComposition =
  createMeetingPanelComposition();

// The real weave: a feature registers its panel here, and the host composition
// the Meetings page reads (`getMeetingPanelComposition`) includes it. This is
// what makes a contribution load-bearing — not a private returned array.
const registeredMeetingPanels: MeetingPanelDescriptor[] = [];

/**
 * Register a feature-owned panel into the live host composition. A panel may
 * replace its compatibility mount, but a second feature may not claim that
 * same blessed slot. Returns an unregister function; a dependent's flag-off
 * path should not register at all.
 */
export function registerMeetingPanel(
  descriptor: MeetingPanelDescriptor
): () => void {
  validateMeetingPanelDescriptors([...registeredMeetingPanels, descriptor]);
  createMeetingPanelComposition(...registeredMeetingPanels, descriptor);
  registeredMeetingPanels.push(descriptor);
  return () => {
    const index = registeredMeetingPanels.indexOf(descriptor);
    if (index >= 0) registeredMeetingPanels.splice(index, 1);
  };
}

/**
 * The composition the real Meetings host (`MeetingEntry`) renders: the base
 * compatibility tabs plus every registered contribution, validated, ordered,
 * and dark-filtered. With no registrations this equals the base tabs.
 */
export function getMeetingPanelComposition(): MeetingPanelComposition {
  return createMeetingPanelComposition(...registeredMeetingPanels);
}
