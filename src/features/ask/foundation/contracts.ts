/**
 * Local-first public contract for new Ask consumers.
 *
 * This contract deliberately carries references and opening metadata only. It
 * never exposes a connector, credential, file bytes, or provider callback.
 */
export interface ContactRef {
  readonly kind: string;
  readonly id: string;
  readonly matterId: string;
}

export interface MeetingRef {
  readonly id: string;
  readonly matterId: string;
}

export interface AskWorkspaceBoundary {
  readonly workspaceId: string;
}

export interface AskClientContext {
  readonly contactRef: ContactRef;
  readonly matterId: string;
  readonly revision: string;
}

export type AskScope = AskWorkspaceBoundary &
  (
    | { readonly kind: 'whole-firm' }
    | ({ readonly kind: 'current-client' } & AskClientContext)
    | {
        readonly kind: 'chosen-sources';
        readonly matterId: string;
        readonly contactRef?: ContactRef;
        readonly sourceIds: readonly string[];
      }
    | { readonly kind: 'single-meeting'; readonly meeting: MeetingRef }
    | {
        readonly kind: 'selected-meetings';
        readonly meetings: readonly MeetingRef[];
      }
    | {
        readonly kind: 'meeting-range';
        readonly matterId: string;
        readonly startsOn: string;
        readonly endsOn: string;
        readonly meetingTypes?: readonly string[];
      }
  );

/** A resolved scope has passed the fail-closed local boundary checks. */
export type ResolvedAskScope = AskScope & {
  readonly resolved: true;
};

export type AskSourceKind =
  | 'crm-contact'
  | 'document'
  | 'meeting-artifact'
  | 'email-descriptor';

export interface AskCitationOpenPath {
  readonly kind: 'contact' | 'document' | 'meeting' | 'email-descriptor';
  readonly token: string;
}

/** A stable, client-bounded record that may be selected for local retrieval. */
export interface AskSourceDescriptor {
  readonly sourceId: string;
  readonly kind: AskSourceKind;
  readonly workspaceId: string;
  readonly matterId: string;
  readonly contactRef?: ContactRef;
  readonly label: string;
  readonly availability: 'available' | 'unavailable';
  readonly citationOpenPath: AskCitationOpenPath;
}

export type AskCrmSource = AskSourceDescriptor & {
  readonly kind: 'crm-contact';
};
export type AskDocumentSource = AskSourceDescriptor & {
  readonly kind: 'document';
};
export type AskMeetingArtifactSource = AskSourceDescriptor & {
  readonly kind: 'meeting-artifact';
  readonly meeting: MeetingRef;
};
export type AskEmailDescriptor = AskSourceDescriptor & {
  readonly kind: 'email-descriptor';
  readonly date: string;
};

export interface AskSourceAdapter {
  readonly id: string;
  readonly order: number;
  readonly sourceKinds: readonly AskSourceKind[];
  readonly listCandidates: (
    scope: ResolvedAskScope
  ) => readonly AskSourceDescriptor[];
}

export interface AskSourceReference {
  readonly sourceId: string;
  readonly reason: string;
}

/** A saved source choice retains the full scope snapshot, including revision. */
export interface AskSelectedSource {
  readonly source: AskSourceDescriptor;
  readonly scope: AskScope;
}

export interface AskRetrievalPlan {
  readonly scope: ResolvedAskScope;
  readonly requestedSourceKinds: readonly AskSourceKind[];
  readonly references: readonly AskSourceReference[];
}

export interface AskCitation {
  readonly claimId: string;
  readonly sourceId: string;
  readonly sourceKind: AskSourceKind;
  readonly matterId: string;
  readonly contactRef?: ContactRef;
  /** The full client-safe snapshot is retained for stale-open rejection. */
  readonly scope: AskScope;
  readonly opener: AskCitationOpenPath;
  readonly label: string;
}

export type AskAnswerProjection =
  | {
      readonly kind: 'local-answer';
      readonly text: string;
      readonly citations: readonly AskCitation[];
    }
  | {
      readonly kind: 'no-local-answer';
      readonly message: string;
      readonly citations: readonly AskCitation[];
    };

export interface AskModeDescriptor {
  readonly id: string;
  readonly order: number;
  readonly responseFormat: 'normal' | 'meeting-report';
  readonly buildScope: AskScopeBuilder;
}

export interface AskScopeBuilder {
  readonly wholeFirm: (workspaceId: string) => AskScope;
  readonly currentClient: (
    workspaceId: string,
    context: AskClientContext | null
  ) => AskScope;
  readonly chosenSources: (
    workspaceId: string,
    matterId: string,
    sourceIds: readonly string[],
    contactRef?: ContactRef
  ) => AskScope;
  readonly singleMeeting: (
    workspaceId: string,
    meeting: MeetingRef
  ) => AskScope;
  readonly selectedMeetings: (
    workspaceId: string,
    meetings: readonly MeetingRef[]
  ) => AskScope;
  readonly meetingRange: (
    workspaceId: string,
    matterId: string,
    startsOn: string,
    endsOn: string,
    meetingTypes?: readonly string[]
  ) => AskScope;
}

export interface AskActionAuthority {
  readonly require: (operation: string, matterId: string) => boolean;
}

export interface AskActionAuditContext {
  readonly write: (
    action: string,
    matterId: string,
    sourceIds: readonly string[]
  ) => Promise<void>;
}

export interface AskAnswerActionContext {
  readonly answer: AskAnswerProjection;
  readonly citations: readonly AskCitation[];
  readonly scope: ResolvedAskScope;
  readonly authority: AskActionAuthority;
  readonly audit: AskActionAuditContext;
}

export interface AskAnswerActionDescriptor {
  readonly id: string;
  readonly order: number;
  readonly isAvailable: (context: AskAnswerActionContext) => boolean;
  /** Must only open a record or create a review draft. */
  readonly execute: (context: AskAnswerActionContext) => void | Promise<void>;
}

export interface AskConversationMetadata {
  readonly id: string;
  readonly scope: AskScope;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AskReviewDraft {
  readonly id: string;
  readonly scope: AskScope;
  readonly destination: 'task' | 'crm-note' | 'follow-up';
  readonly body: string;
  readonly citationIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}
