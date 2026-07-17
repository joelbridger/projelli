import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { UseFirmResult } from '@/platform/hooks/useFirm';
import type { TranscriptFile } from '@/platform/types/meeting';
import type { DocxTextExtraction } from '@/platform/utils/docx-io';
import type { MeetingMeta } from './meetingStore';
import type { ClientBoundary, MeetingProjection } from './foundation/contract';

/** Feature modules augment these maps beside their descriptors. No string fallback is intentional. */
export interface MeetingPanelIdMap {}
export interface MeetingHeaderActionIdMap {}
export interface MeetingInsightIdMap {}

export type MeetingPanelId = Extract<keyof MeetingPanelIdMap, string>;
export type MeetingHeaderActionId = Extract<
  keyof MeetingHeaderActionIdMap,
  string
>;
export type MeetingInsightId = Extract<keyof MeetingInsightIdMap, string>;

export interface MeetingPanelContext {
  t: TFunction;
  matterId: string;
  /** Resolved by the opener; never derived from `meetingDir` by this host. */
  canonicalMeeting: MeetingProjection | null;
  /** Resolved with the canonical meeting; paths never grant this boundary. */
  clientBoundary: ClientBoundary | null;
  meetingDir: string;
  clientName: string;
  workspaceRoot: string;
  workspaceService: WorkspaceService | null;
  firm: Pick<UseFirmResult, 'org' | 'role'>;
  meta: MeetingMeta | null;
  transcript: TranscriptFile | null;
  summaryExtraction: DocxTextExtraction | null;
  summaryText: string;
  audioSrc: string | null;
  renderAudioPlayer: () => ReactNode;
  seekMs: number | undefined;
  hasAudio: boolean;
  hasNotes: boolean;
  summaryReady: boolean;
  crmBlockedReason: string | null;
  retryingNotes: boolean;
  retryingTranscript: boolean;
  onSeek: (ms: number) => void;
  onRetryNotes: () => void;
  onRetryTranscript: () => void;
}

export interface MeetingPanelDescriptor {
  id: MeetingPanelId;
  order: number;
  labelKey: string;
  /** Flag-aware availability; omitted means always available. A dark (false)
   *  contribution is excluded from the composition the host renders. */
  isAvailable?: () => boolean;
  mount: (context: MeetingPanelContext) => ReactNode;
}

export type MeetingHeaderActionPlacement = 'primary' | 'secondary' | 'menu';

export interface MeetingHeaderActionContext {
  t: TFunction;
  canonicalMeeting: MeetingProjection | null;
  clientBoundary: ClientBoundary | null;
  meta: MeetingMeta | null;
  transcript: TranscriptFile | null;
  summaryText: string;
  hasAudio: boolean;
  hasTranscript: boolean;
  summaryReady: boolean;
  exporting: string | null;
  onOpenSend: () => void;
  onMarkReviewed: () => Promise<void>;
  onDownloadAudio: () => void;
  onCopyTranscript: () => void;
  onCopySummary: () => void;
  onExportTranscript: () => void;
  onExportSummaryDocx: () => void;
  onExportSummaryPdf: () => void;
  onRequestDeleteAudio: () => void;
  onActionError: (error: unknown) => void;
}

export interface MeetingHeaderActionDescriptor {
  id: MeetingHeaderActionId;
  order: number;
  labelKey: string;
  placement: MeetingHeaderActionPlacement;
  /** Flag-aware availability; omitted means always available. A dark (false)
   *  contribution is excluded from the composition the host renders. */
  isAvailable?: () => boolean;
  mount: (context: MeetingHeaderActionContext) => ReactNode;
}

export interface MeetingInsightPrerequisite {
  artifactId: string;
  minimumVersion: number;
}

export interface MeetingInsightArtifact {
  artifactId: string;
  version: number;
  payload: unknown;
}

export interface MeetingInsightArtifactContext {
  matterId: string;
  canonicalMeeting: MeetingProjection | null;
  clientBoundary: ClientBoundary | null;
  meetingDir: string;
  workspaceService: WorkspaceService | null;
}

export interface MeetingInsightArtifactProducer {
  artifactId: string;
  produce: (
    context: MeetingInsightArtifactContext
  ) => Promise<MeetingInsightArtifact | null>;
}

export interface MeetingInsightArtifactStore {
  artifactId: string;
  version: number;
  read: (
    context: MeetingInsightArtifactContext
  ) => Promise<MeetingInsightArtifact | null>;
  write: (
    context: MeetingInsightArtifactContext,
    artifact: MeetingInsightArtifact
  ) => Promise<MeetingInsightArtifact | null>;
}

export interface MeetingInsightSettingsContext {
  workspaceService: WorkspaceService | null;
}

export interface MeetingInsightSettingsDescriptor {
  id: string;
  labelKey: string;
  mount: (context: MeetingInsightSettingsContext) => ReactNode;
}

export interface MeetingInsightMeetingSummaryContext extends MeetingInsightArtifactContext {
  clientName: string;
}

export interface MeetingInsightClientSummaryContext {
  matterId: string;
  clientName: string;
  workspaceService: WorkspaceService | null;
}

/**
 * A complete insight plug-in contract. Production, settings, and both summary
 * mounts stay together so a new insight cannot leave an orphaned artifact.
 */
export interface MeetingInsightDescriptor {
  id: MeetingInsightId;
  order: number;
  version: number;
  /** Flag-aware availability; omitted means always available. A dark (false)
   *  contribution is excluded from the composition the host renders. */
  isAvailable?: () => boolean;
  mounts: {
    meetingSummary: boolean;
    clientSummary: boolean;
  };
  prerequisites: readonly MeetingInsightPrerequisite[];
  artifactStore: MeetingInsightArtifactStore;
  artifactProducer: MeetingInsightArtifactProducer;
  selectors: Readonly<Record<string, unknown>>;
  settings: MeetingInsightSettingsDescriptor;
  renderMeetingSummary: (
    context: MeetingInsightMeetingSummaryContext
  ) => ReactNode;
  renderClientSummary: (
    context: MeetingInsightClientSummaryContext
  ) => ReactNode;
}
