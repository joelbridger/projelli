/**
 * Local-first public contracts for Ask.
 *
 * Cross-feature references stay generic on purpose. Ask must consume the real
 * ContactRef and MeetingRef from their owning public packages when those
 * contracts land; it must never publish lookalike replacements.
 */
export interface AskWorkspaceBoundary {
  readonly workspaceId: string;
}

/** The exact owner reference plus the shared-client revision saved at use time. */
export interface AskClientSnapshot<ClientReference> {
  readonly contactRef: ClientReference;
  readonly matterId: string;
  readonly revision: string;
}

/**
 * Ask's adapter for owner-supplied identity contracts.
 *
 * This does not define either owner reference. The client/meetings packages
 * must provide the real reference values and these pure operations.
 */
export interface AskOwnerIdentityAdapter<ClientReference, MeetingReference> {
  readonly isClientReference: (value: unknown) => value is ClientReference;
  readonly clientMatterId: (reference: ClientReference) => string;
  readonly sameClient: (
    left: ClientReference,
    right: ClientReference
  ) => boolean;
  readonly isMeetingReference: (value: unknown) => value is MeetingReference;
  readonly meetingId: (reference: MeetingReference) => string;
  readonly meetingMatterId: (reference: MeetingReference) => string;
  readonly sameMeeting: (
    left: MeetingReference,
    right: MeetingReference
  ) => boolean;
}

export type AskScope<
  ClientReference = never,
  MeetingReference = never,
> = AskWorkspaceBoundary &
  (
    | { readonly kind: 'whole-firm' }
    | {
        readonly kind: 'current-client';
        readonly client: AskClientSnapshot<ClientReference>;
      }
    | {
        readonly kind: 'chosen-sources';
        readonly client: AskClientSnapshot<ClientReference>;
        readonly sourceIds: readonly string[];
      }
    | {
        readonly kind: 'single-meeting';
        readonly client: AskClientSnapshot<ClientReference>;
        readonly meeting: MeetingReference;
      }
    | {
        readonly kind: 'selected-meetings';
        readonly client: AskClientSnapshot<ClientReference>;
        readonly meetings: readonly MeetingReference[];
      }
    | {
        readonly kind: 'meeting-range';
        readonly client: AskClientSnapshot<ClientReference>;
        readonly startsOn: string;
        readonly endsOn: string;
        readonly meetingTypes?: readonly string[];
      }
  );

/** A resolved scope has passed the current shared-client and owner checks. */
export type ResolvedAskScope<
  ClientReference = never,
  MeetingReference = never,
> = AskScope<ClientReference, MeetingReference> & {
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

interface AskSourceBase<ClientReference> {
  readonly sourceId: string;
  readonly workspaceId: string;
  readonly client: AskClientSnapshot<ClientReference>;
  readonly label: string;
  readonly availability: 'available' | 'unavailable';
  readonly citationOpenPath: AskCitationOpenPath;
}

export type AskCrmSource<ClientReference = never> =
  AskSourceBase<ClientReference> & {
    readonly kind: 'crm-contact';
  };

export type AskDocumentSource<ClientReference = never> =
  AskSourceBase<ClientReference> & {
    readonly kind: 'document';
  };

/** Safe facts supplied by the Meetings owner for eligibility checks. */
export type AskMeetingArtifactSource<
  ClientReference = never,
  MeetingReference = never,
> = AskSourceBase<ClientReference> & {
  readonly kind: 'meeting-artifact';
  readonly meeting: MeetingReference;
  /** Calendar date in YYYY-MM-DD form, supplied by the approved artifact. */
  readonly occurredOn: string;
  readonly meetingType: string;
};

export type AskEmailDescriptor<ClientReference = never> =
  AskSourceBase<ClientReference> & {
    readonly kind: 'email-descriptor';
    readonly date: string;
  };

export type AskSourceDescriptor<
  ClientReference = never,
  MeetingReference = never,
> =
  | AskCrmSource<ClientReference>
  | AskDocumentSource<ClientReference>
  | AskMeetingArtifactSource<ClientReference, MeetingReference>
  | AskEmailDescriptor<ClientReference>;

export interface AskSourceAdapter<
  ClientReference = never,
  MeetingReference = never,
> {
  readonly id: string;
  readonly order: number;
  readonly sourceKinds: readonly AskSourceKind[];
  readonly isEnabled?: (
    scope: ResolvedAskScope<ClientReference, MeetingReference>
  ) => boolean;
  readonly listCandidates: (
    scope: ResolvedAskScope<ClientReference, MeetingReference>
  ) => readonly AskSourceDescriptor<ClientReference, MeetingReference>[];
}

export interface AskSourceReference {
  readonly sourceId: string;
  readonly reason: string;
}

export interface AskSavedSourceSelection<
  ClientReference = never,
  MeetingReference = never,
> {
  readonly id: string;
  readonly scope: AskScope<ClientReference, MeetingReference>;
  readonly sources: readonly AskSourceDescriptor<
    ClientReference,
    MeetingReference
  >[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AskRetrievalPlan<
  ClientReference = never,
  MeetingReference = never,
> {
  readonly scope: ResolvedAskScope<ClientReference, MeetingReference>;
  readonly requestedSourceKinds: readonly AskSourceKind[];
  readonly references: readonly AskSourceReference[];
}

export interface AskCitation<
  ClientReference = never,
  MeetingReference = never,
> {
  readonly claimId: string;
  readonly sourceId: string;
  readonly sourceKind: AskSourceKind;
  readonly client: AskClientSnapshot<ClientReference>;
  readonly scope: AskScope<ClientReference, MeetingReference>;
  readonly opener: AskCitationOpenPath;
  readonly label: string;
  readonly meeting?: MeetingReference;
  readonly occurredOn?: string;
  readonly meetingType?: string;
}

export type AskAnswerProjection<
  ClientReference = never,
  MeetingReference = never,
> =
  | {
      readonly kind: 'local-answer';
      readonly text: string;
      readonly citations: readonly AskCitation<
        ClientReference,
        MeetingReference
      >[];
    }
  | {
      readonly kind: 'no-local-answer';
      readonly message: string;
      readonly citations: readonly AskCitation<
        ClientReference,
        MeetingReference
      >[];
    };

export interface AskScopeBuilder {
  readonly wholeFirm: (workspaceId: string) => AskScope;
  readonly currentClient: <ClientReference>(
    workspaceId: string,
    client: AskClientSnapshot<ClientReference> | null
  ) => AskScope<ClientReference>;
  readonly chosenSources: <ClientReference>(
    workspaceId: string,
    client: AskClientSnapshot<ClientReference>,
    sourceIds: readonly string[]
  ) => AskScope<ClientReference>;
  readonly singleMeeting: <ClientReference, MeetingReference>(
    workspaceId: string,
    client: AskClientSnapshot<ClientReference>,
    meeting: MeetingReference
  ) => AskScope<ClientReference, MeetingReference>;
  readonly selectedMeetings: <ClientReference, MeetingReference>(
    workspaceId: string,
    client: AskClientSnapshot<ClientReference>,
    meetings: readonly MeetingReference[]
  ) => AskScope<ClientReference, MeetingReference>;
  readonly meetingRange: <ClientReference>(
    workspaceId: string,
    client: AskClientSnapshot<ClientReference>,
    startsOn: string,
    endsOn: string,
    meetingTypes?: readonly string[]
  ) => AskScope<ClientReference>;
}

export interface AskModeDescriptor<
  ClientReference = never,
  MeetingReference = never,
> {
  readonly id: string;
  readonly order: number;
  readonly responseFormat: 'normal' | 'meeting-report';
  readonly isEnabled?: (
    scope: ResolvedAskScope<ClientReference, MeetingReference>
  ) => boolean;
  readonly buildScope: AskScopeBuilder;
}

/**
 * Authority and audit values are generic until their real owner exports land.
 * Ask intentionally publishes no local authority/audit lookalike.
 */
export interface AskAnswerActionContext<
  ClientReference,
  MeetingReference,
  Authority,
  Audit,
> {
  readonly answer: AskAnswerProjection<ClientReference, MeetingReference>;
  readonly citations: readonly AskCitation<ClientReference, MeetingReference>[];
  readonly scope: ResolvedAskScope<ClientReference, MeetingReference>;
  readonly authority: Authority;
  readonly audit: Audit;
}

export interface AskAnswerActionDescriptor<
  ClientReference = never,
  MeetingReference = never,
  Authority = never,
  Audit = never,
> {
  readonly id: string;
  readonly order: number;
  readonly isEnabled?: (
    context: AskAnswerActionContext<
      ClientReference,
      MeetingReference,
      Authority,
      Audit
    >
  ) => boolean;
  readonly isAvailable: (
    context: AskAnswerActionContext<
      ClientReference,
      MeetingReference,
      Authority,
      Audit
    >
  ) => boolean;
  /** Must only open a record or create a review draft. */
  readonly execute: (
    context: AskAnswerActionContext<
      ClientReference,
      MeetingReference,
      Authority,
      Audit
    >
  ) => void | Promise<void>;
}

export interface AskConversationMetadata<
  ClientReference = never,
  MeetingReference = never,
> {
  readonly id: string;
  readonly scope: AskScope<ClientReference, MeetingReference>;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AskReviewDraft<
  ClientReference = never,
  MeetingReference = never,
> {
  readonly id: string;
  readonly scope: AskScope<ClientReference, MeetingReference>;
  readonly destination: 'task' | 'crm-note' | 'follow-up';
  readonly body: string;
  readonly citationIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}
