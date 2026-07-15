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
  return descriptors.slice().sort((a, b) => a.order - b.order);
}
