import type {
  MeetingInsightDescriptor,
  MeetingInsightPrerequisite,
} from './meetingWorkspaceTypes';

export type {
  MeetingInsightArtifact,
  MeetingInsightArtifactContext,
  MeetingInsightArtifactProducer,
  MeetingInsightClientSummaryContext,
  MeetingInsightDescriptor,
  MeetingInsightId,
  MeetingInsightIdMap,
  MeetingInsightMeetingSummaryContext,
  MeetingInsightPrerequisite,
  MeetingInsightSettingsContext,
  MeetingInsightSettingsDescriptor,
} from './meetingWorkspaceTypes';

function isPositiveVersion(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPrerequisite(value: unknown): value is MeetingInsightPrerequisite {
  return (
    isRecord(value) &&
    typeof value['artifactId'] === 'string' &&
    value['artifactId'].trim().length > 0 &&
    isPositiveVersion(value['minimumVersion'])
  );
}

export function validateMeetingInsightDescriptors(
  descriptors: readonly MeetingInsightDescriptor[]
): void {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    const id = String(descriptor.id);
    if (ids.has(id)) {
      throw new Error(`[meetingInsightRegistry] duplicate insight id: ${id}`);
    }
    ids.add(id);
    if (!Number.isFinite(descriptor.order)) {
      throw new Error(`[meetingInsightRegistry] order must be finite: ${id}`);
    }
    if (!isPositiveVersion(descriptor.version)) {
      throw new Error(
        `[meetingInsightRegistry] version must be a positive integer: ${id}`
      );
    }
    const prerequisites: unknown = descriptor.prerequisites;
    if (!Array.isArray(prerequisites)) {
      throw new Error(
        `[meetingInsightRegistry] prerequisites are required: ${id}`
      );
    }
    const prerequisiteIds = new Set<string>();
    for (const prerequisite of prerequisites) {
      if (!isPrerequisite(prerequisite)) {
        throw new Error(`[meetingInsightRegistry] invalid prerequisite: ${id}`);
      }
      if (prerequisiteIds.has(prerequisite.artifactId)) {
        throw new Error(
          `[meetingInsightRegistry] duplicate prerequisite: ${id}:${prerequisite.artifactId}`
        );
      }
      prerequisiteIds.add(prerequisite.artifactId);
    }
    const artifactProducer: unknown = descriptor.artifactProducer;
    if (
      !isRecord(artifactProducer) ||
      typeof artifactProducer['artifactId'] !== 'string' ||
      !artifactProducer['artifactId'].trim() ||
      typeof artifactProducer['produce'] !== 'function'
    ) {
      throw new Error(
        `[meetingInsightRegistry] artifact producer is required: ${id}`
      );
    }
    const settings: unknown = descriptor.settings;
    if (
      !isRecord(settings) ||
      typeof settings['id'] !== 'string' ||
      !settings['id'].trim() ||
      typeof settings['labelKey'] !== 'string' ||
      !settings['labelKey'].includes('.') ||
      typeof settings['mount'] !== 'function'
    ) {
      throw new Error(
        `[meetingInsightRegistry] settings descriptor is required: ${id}`
      );
    }
    if (
      typeof descriptor.renderMeetingSummary !== 'function' ||
      typeof descriptor.renderClientSummary !== 'function'
    ) {
      throw new Error(
        `[meetingInsightRegistry] meeting and client summary renderers are required: ${id}`
      );
    }
  }
}

/**
 * Future insight features append their own complete descriptors here. The seam
 * intentionally ships empty: this refactor does not create intelligence.
 */
export const meetingInsightRegistry: readonly MeetingInsightDescriptor[] = [];

export function getMeetingInsights(
  descriptors: readonly MeetingInsightDescriptor[] = meetingInsightRegistry
): readonly MeetingInsightDescriptor[] {
  validateMeetingInsightDescriptors(descriptors);
  return descriptors.slice().sort((a, b) => a.order - b.order);
}
