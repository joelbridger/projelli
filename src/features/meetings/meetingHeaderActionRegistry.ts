import type { MeetingHeaderActionDescriptor } from './meetingWorkspaceTypes';
import { legacyMeetingHeaderActions } from './meetingWorkspaceCompatibility';

export type {
  MeetingHeaderActionContext,
  MeetingHeaderActionDescriptor,
  MeetingHeaderActionId,
  MeetingHeaderActionIdMap,
  MeetingHeaderActionPlacement,
} from './meetingWorkspaceTypes';

export function validateMeetingHeaderActionDescriptors(
  descriptors: readonly MeetingHeaderActionDescriptor[]
): void {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) {
      throw new Error(
        `[meetingHeaderActionRegistry] duplicate action id: ${descriptor.id}`
      );
    }
    ids.add(descriptor.id);
    if (!Number.isFinite(descriptor.order)) {
      throw new Error(
        `[meetingHeaderActionRegistry] order must be finite: ${descriptor.id}`
      );
    }
    if (!descriptor.labelKey.includes('.')) {
      throw new Error(
        `[meetingHeaderActionRegistry] labelKey must be namespaced: ${descriptor.id}`
      );
    }
    if (
      !['primary', 'secondary', 'menu'].includes(descriptor.placement) ||
      typeof descriptor.mount !== 'function'
    ) {
      throw new Error(
        `[meetingHeaderActionRegistry] invalid action contract: ${descriptor.id}`
      );
    }
  }
}

/** Append-only mount list. Compatibility entries preserve today's visible order. */
export const meetingHeaderActionRegistry: readonly MeetingHeaderActionDescriptor[] =
  legacyMeetingHeaderActions;

export function getMeetingHeaderActions(
  descriptors: readonly MeetingHeaderActionDescriptor[] = meetingHeaderActionRegistry
): readonly MeetingHeaderActionDescriptor[] {
  validateMeetingHeaderActionDescriptors(descriptors);
  return descriptors
    .filter((descriptor) => descriptor.isAvailable?.() ?? true)
    .sort((a, b) => a.order - b.order);
}

export interface MeetingHeaderActionComposition {
  /** Ordered, available header actions the host renders — base + contributions. */
  readonly actions: readonly MeetingHeaderActionDescriptor[];
}

/**
 * Open-world header-action composition. Contributions validate together with
 * the base actions (duplicate ids, malformed contracts, unstable order, and
 * bad placement are rejected), dark entries are excluded, and the result is
 * ordered without mutating the shared registry.
 */
export function createMeetingHeaderActionComposition(
  ...contributions: readonly MeetingHeaderActionDescriptor[]
): MeetingHeaderActionComposition {
  return {
    actions: getMeetingHeaderActions([
      ...meetingHeaderActionRegistry,
      ...contributions,
    ]),
  };
}

/** Base composition with no contributions (Send / Mark reviewed / utilities). */
export const defaultMeetingHeaderActionComposition: MeetingHeaderActionComposition =
  createMeetingHeaderActionComposition();

// The real weave: a feature registers its header action here and the host
// composition the Meetings page reads (`getMeetingHeaderActionComposition`)
// includes it.
const registeredMeetingHeaderActions: MeetingHeaderActionDescriptor[] = [];

/**
 * Register a feature-owned header action into the live host composition.
 * Validates against base plus already-registered actions before adding, and
 * returns an unregister function.
 */
export function registerMeetingHeaderAction(
  descriptor: MeetingHeaderActionDescriptor
): () => void {
  createMeetingHeaderActionComposition(
    ...registeredMeetingHeaderActions,
    descriptor
  );
  registeredMeetingHeaderActions.push(descriptor);
  return () => {
    const index = registeredMeetingHeaderActions.indexOf(descriptor);
    if (index >= 0) registeredMeetingHeaderActions.splice(index, 1);
  };
}

/** The header-action composition the real Meetings host renders. */
export function getMeetingHeaderActionComposition(): MeetingHeaderActionComposition {
  return createMeetingHeaderActionComposition(
    ...registeredMeetingHeaderActions
  );
}
