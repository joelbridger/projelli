import type { MeetingPanelDescriptor } from './meetingWorkspaceTypes';
import { legacyMeetingPanels } from './meetingWorkspaceCompatibility';

export type {
  MeetingPanelContext,
  MeetingPanelDescriptor,
  MeetingPanelId,
  MeetingPanelIdMap,
} from './meetingWorkspaceTypes';

function validateLabelKey(registryName: string, id: string, labelKey: string) {
  if (!labelKey.includes('.')) {
    throw new Error(`[${registryName}] labelKey must be namespaced: ${id}`);
  }
}

export function validateMeetingPanelDescriptors(
  descriptors: readonly MeetingPanelDescriptor[]
): void {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
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

/** Append-only mount list. Compatibility entries preserve today's visible order. */
export const meetingPanelRegistry: readonly MeetingPanelDescriptor[] =
  legacyMeetingPanels;

export function getMeetingPanels(
  descriptors: readonly MeetingPanelDescriptor[] = meetingPanelRegistry
): readonly MeetingPanelDescriptor[] {
  validateMeetingPanelDescriptors(descriptors);
  return descriptors
    .filter((descriptor) => descriptor.isAvailable?.() ?? true)
    .sort((a, b) => a.order - b.order);
}

export interface MeetingPanelComposition {
  /** Ordered, available panels the host renders as tabs — base + contributions. */
  readonly panels: readonly MeetingPanelDescriptor[];
}

/**
 * Open-world panel composition. Contributions are validated together with the
 * base compatibility panels (duplicate ids, malformed contracts, and unstable
 * order are rejected), dark (unavailable) entries are excluded, and the result
 * is ordered without mutating the shared registry.
 */
export function createMeetingPanelComposition(
  ...contributions: readonly MeetingPanelDescriptor[]
): MeetingPanelComposition {
  return {
    panels: getMeetingPanels([...meetingPanelRegistry, ...contributions]),
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
 * Register a feature-owned panel into the live host composition. Validates the
 * contribution against the base plus already-registered panels (duplicate id
 * and malformed descriptors are rejected) BEFORE it is added. Returns an
 * unregister function; a dependent's flag-off path should not register at all.
 */
export function registerMeetingPanel(
  descriptor: MeetingPanelDescriptor
): () => void {
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
