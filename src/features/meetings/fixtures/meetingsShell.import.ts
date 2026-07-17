import {
  useMeetingFoundationStore,
  useMeetingArtifactStore,
  useMeetingTypeStore,
  useMeetingTemplateStore,
  useMeetingIntelligenceSettingsStore,
  useMeetingFoundationPreferencesStore,
  type MeetingStore,
  type MeetingArtifactStore,
  type MeetingListProjection,
} from '@/features/meetings';

void useMeetingFoundationStore;
void useMeetingArtifactStore;
void useMeetingTypeStore;
void useMeetingTemplateStore;
void useMeetingIntelligenceSettingsStore;
void useMeetingFoundationPreferencesStore;
export type MeetingsShellImportProof =
  | MeetingStore
  | MeetingArtifactStore
  | MeetingListProjection;
