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
  return descriptors.slice().sort((a, b) => a.order - b.order);
}
