import type {
  MeetingInsightDescriptor,
  MeetingInsightPrerequisite,
} from './meetingWorkspaceTypes';
import { meetingReviewInsightDescriptor } from './insights/review/meetingReviewArtifactStore';

export type {
  MeetingInsightArtifact,
  MeetingInsightArtifactContext,
  MeetingInsightArtifactProducer,
  MeetingInsightArtifactStore,
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
    const id = descriptor.id;
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
    const mounts: unknown = descriptor.mounts;
    if (
      !isRecord(mounts) ||
      typeof mounts['meetingSummary'] !== 'boolean' ||
      typeof mounts['clientSummary'] !== 'boolean'
    ) {
      throw new Error(`[meetingInsightRegistry] mounts are required: ${id}`);
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
    const artifactStore: unknown = descriptor.artifactStore;
    if (
      !isRecord(artifactStore) ||
      artifactStore['artifactId'] !== artifactProducer['artifactId'] ||
      artifactStore['version'] !== descriptor.version ||
      typeof artifactStore['read'] !== 'function' ||
      typeof artifactStore['write'] !== 'function'
    ) {
      throw new Error(
        `[meetingInsightRegistry] artifact store is required: ${id}`
      );
    }
    const selectors: unknown = descriptor.selectors;
    if (
      !isRecord(selectors) ||
      Object.keys(selectors).length === 0 ||
      Object.values(selectors).some(
        (selector) => typeof selector !== 'function'
      )
    ) {
      throw new Error(`[meetingInsightRegistry] selectors are required: ${id}`);
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
 * Append-only insight mount list. Each entry owns its versioned store and
 * selectors in its feature folder, so meetingStore never grows feature state.
 */
export const meetingInsightRegistry: readonly MeetingInsightDescriptor[] = [
  meetingReviewInsightDescriptor,
];

export function getRegisteredMeetingInsights(
  descriptors: readonly MeetingInsightDescriptor[] = meetingInsightRegistry
): readonly MeetingInsightDescriptor[] {
  validateMeetingInsightDescriptors(descriptors);
  return descriptors
    .filter((descriptor) => descriptor.isAvailable?.() ?? true)
    .sort((a, b) => a.order - b.order);
}

/** Descriptors that visibly mount on MeetingEntry's existing summary area. */
export function getMeetingInsights(
  descriptors: readonly MeetingInsightDescriptor[] = meetingInsightRegistry
): readonly MeetingInsightDescriptor[] {
  return getRegisteredMeetingInsights(descriptors).filter(
    (descriptor) => descriptor.mounts.meetingSummary
  );
}

export interface MeetingInsightComposition {
  /** All available insights (any mount), ordered — base + contributions. */
  readonly registered: readonly MeetingInsightDescriptor[];
  /** Available insights that mount on the meeting summary area, ordered. */
  readonly meetingSummary: readonly MeetingInsightDescriptor[];
}

/**
 * Open-world insight composition. Contributions validate together with the base
 * insight(s) (duplicate ids, malformed metadata, and unstable order rejected),
 * dark entries are excluded, and both projections are ordered without mutating
 * the shared registry.
 */
export function createMeetingInsightComposition(
  ...contributions: readonly MeetingInsightDescriptor[]
): MeetingInsightComposition {
  const registered = getRegisteredMeetingInsights([
    ...meetingInsightRegistry,
    ...contributions,
  ]);
  return {
    registered,
    meetingSummary: registered.filter(
      (descriptor) => descriptor.mounts.meetingSummary
    ),
  };
}

/** Base composition with no contributions (the built-in review-status insight). */
export const defaultMeetingInsightComposition: MeetingInsightComposition =
  createMeetingInsightComposition();

// The real weave: a feature registers its insight here and the host composition
// the Meetings page reads (`getMeetingInsightComposition`) includes it.
const registeredMeetingInsights: MeetingInsightDescriptor[] = [];

/**
 * Register a feature-owned insight into the live host composition. Validates
 * against base plus already-registered insights before adding, and returns an
 * unregister function.
 */
export function registerMeetingInsight(
  descriptor: MeetingInsightDescriptor
): () => void {
  createMeetingInsightComposition(...registeredMeetingInsights, descriptor);
  registeredMeetingInsights.push(descriptor);
  return () => {
    const index = registeredMeetingInsights.indexOf(descriptor);
    if (index >= 0) registeredMeetingInsights.splice(index, 1);
  };
}

/** The insight composition the real Meetings host renders. */
export function getMeetingInsightComposition(): MeetingInsightComposition {
  return createMeetingInsightComposition(...registeredMeetingInsights);
}
