import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import {
  useBriefStore,
  localDay,
  type ExactMeetingBriefIdentity,
  type MeetingBriefDraft,
} from '@/features/meetings/briefStore';
import type { MeetingMeta } from '@/features/meetings/meetingStore';
import type { MeetingBriefBullet } from '@/features/meetings/generateBrief';
import {
  createAccountlessUnrestrictedMeetingFileVisibilityManifest,
  type ActiveClientMeetingPopulationOperation,
  type MeetingPopulationService,
  type SealedMeetingClientBoundary,
} from '@/features/meetings';
import type { MeetingFileVisibilityManifest } from '@/features/meetings/meetingFileVisibility';
import type { MeetingArtifactInput } from '@/features/meetings/foundation/contract';
import type { TranscriptFile } from '@/platform/types/meeting';
import { useMatterStore } from '@/platform/matter/matterStore';
import { markdownToDocxBytes } from '@/platform/utils/docx-io';
import {
  SAMPLE_FILE_BENEFICIARY_ESTATE,
  SAMPLE_FILE_MEETING_NOTES,
  SAMPLE_FILE_PLAN_SUMMARY,
  sampleFilePath,
} from '@/platform/matter/samples/sampleMatterDemo';

const SAMPLE_MEETING_FOLDER = '2026-07-02-hendricks-annual-review';
const SAMPLE_MEETING_EVENT_ID = 'sample-hendricks-annual-review';
const SAMPLE_MEETING_EVENT_TITLE = 'Hendricks annual review';
const SAMPLE_MEETING_STARTED_AT = '2026-07-02T14:00:00.000Z';
const SAMPLE_MEETING_ENDED_AT = '2026-07-02T14:42:00.000Z';
const SAMPLE_CRM_SOURCE_REF = `meeting:${SAMPLE_MEETING_EVENT_ID}`;
const SAMPLE_CRM_HOUSEHOLD_KEY = 'sample-hendricks-household';
const SAMPLE_TASK_PROPOSAL_ID = 'sample-hendricks-task-proposal';
const SAMPLE_CRM_PROPOSAL_ID = 'sample-hendricks-crm-proposal';
const SAMPLE_MEETING_FILE_NAMES = [
  'meeting.json',
  'transcript.json',
  'notes.docx',
] as const;

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
}

function abs(workspaceRoot: string, filename: string): string {
  return sampleFilePath(workspaceRoot, filename);
}

function sampleMeetingMeta(
  matterId: string,
  preservedVisibility?: MeetingMeta['meetingFileVisibility']
): MeetingMeta {
  return {
    matterId,
    startedAt: SAMPLE_MEETING_STARTED_AT,
    durationMs: 42 * 60 * 1000,
    calendarTitle: SAMPLE_MEETING_EVENT_TITLE,
    customTitle: SAMPLE_MEETING_EVENT_TITLE,
    typeId: 'annual-review',
    reviewedAt: '2026-07-02T15:01:00.000Z',
    consent: {
      mode: 'two-party',
      confirmedBy: 'Advisor',
      confirmedAt: SAMPLE_MEETING_STARTED_AT,
      note: 'Sample meeting. Consent captured for demo data only.',
    },
    calendarEvent: {
      id: SAMPLE_MEETING_EVENT_ID,
      title: SAMPLE_MEETING_EVENT_TITLE,
      startUtc: SAMPLE_MEETING_STARTED_AT,
      endUtc: SAMPLE_MEETING_ENDED_AT,
      attendees: [
        { name: 'Robert Hendricks', email: 'robert.hendricks@email.com' },
        { name: 'Susan Hendricks', email: 'susan.hendricks@email.com' },
      ],
    },
    meetingFileVisibility:
      preservedVisibility ??
      createAccountlessUnrestrictedMeetingFileVisibilityManifest({
        meetingSubjectId: `meeting-file:${SAMPLE_MEETING_EVENT_ID}`,
        fileNames: SAMPLE_MEETING_FILE_NAMES,
      }),
  };
}

function sampleTranscript(matterId: string): TranscriptFile {
  return {
    segments: [
      {
        startMs: 0,
        endMs: 18_000,
        channel: 'mic',
        speaker: 'Advisor',
        text: 'Today we are reviewing the Roth conversion, the beneficiary follow-up, and the 529 funding plan.',
      },
      {
        startMs: 18_000,
        endMs: 40_000,
        channel: 'sys',
        speaker: 'Robert Hendricks',
        text: 'I want to keep the conversion near the top of the 24 percent bracket and avoid Medicare surcharge surprises.',
      },
      {
        startMs: 40_000,
        endMs: 64_000,
        channel: 'sys',
        speaker: 'Susan Hendricks',
        text: 'The 529 gifts are still important, but I would rather confirm retirement cash flow before we commit the full amount.',
      },
      {
        startMs: 64_000,
        endMs: 92_000,
        channel: 'mic',
        speaker: 'Advisor',
        text: "I will prepare the Schwab Roth authorization, check Robert's consulting 401(k) beneficiaries, and revisit 529 funding in October.",
      },
    ],
    meta: {
      startedAt: SAMPLE_MEETING_STARTED_AT,
      durationMs: 42 * 60 * 1000,
      matterId,
      consent: {
        mode: 'two-party',
        confirmedBy: 'Advisor',
        confirmedAt: SAMPLE_MEETING_STARTED_AT,
        note: 'Sample meeting. Consent captured for demo data only.',
      },
    },
  };
}

function sampleMeetingNotesMarkdown(): string {
  return [
    `# ${SAMPLE_MEETING_EVENT_TITLE}`,
    '',
    '## Decisions',
    '',
    '- Keep the 2024 Roth conversion target near $48,000, pending final Holistiplan projections.',
    '- Rebalance the portfolio back toward the 65/35 near-term target before Susan retires.',
    '- Revisit 529 funding in October after retirement income is clearer.',
    '',
    '## Follow-ups',
    '',
    '- Prepare Schwab Roth conversion authorization documents for Q4.',
    "- Confirm Robert's consulting 401(k) beneficiary designations.",
    "- Schedule the long-term care specialist call before Susan's school district coverage lapses.",
    '',
    '## CRM note draft',
    '',
    "Annual review completed. Roth conversion remains planned for Q4 at about $48,000, subject to final tax projection. Beneficiary clean-up is mostly complete; confirm Robert's consulting 401(k) and Susan's school 403(b). 529 funding deferred to October review.",
  ].join('\n');
}

function sampleBriefBullets(workspaceRoot: string): MeetingBriefBullet[] {
  return [
    {
      id: 'sample-brief-b1',
      text: 'Roth conversion target is about $48,000, filling the 24% bracket without crossing into 32%.',
      sourcePath: abs(workspaceRoot, SAMPLE_FILE_PLAN_SUMMARY),
      quote:
        '2024 target conversion: $48,000 (fills the 24% bracket based on projected income).',
    },
    {
      id: 'sample-brief-b2',
      text: 'Beneficiary clean-up is mostly done, but the consulting 401(k) and school 403(b) still need confirmation.',
      sourcePath: abs(workspaceRoot, SAMPLE_FILE_BENEFICIARY_ESTATE),
      quote:
        "Confirm Robert's consulting 401(k) beneficiary designations match the intended primary/contingent lineup.",
    },
    {
      id: 'sample-brief-b3',
      text: '529 funding is still a client goal, but the prior meeting deferred final timing until retirement income is clearer.',
      sourcePath: abs(workspaceRoot, SAMPLE_FILE_MEETING_NOTES),
      quote: 'Revisit 529 funding strategy at October meeting.',
    },
  ];
}

function sampleBrief(
  workspaceRoot: string,
  matterId: string
): {
  readonly identity: ExactMeetingBriefIdentity;
  readonly brief: MeetingBriefDraft;
} {
  const day = localDay();
  const clientBoundary = {
    householdRef: SAMPLE_CRM_HOUSEHOLD_KEY,
    matterId,
  } as SealedMeetingClientBoundary;
  return {
    identity: {
      clientBoundary,
      // Briefs remain keyed by the current local day, but always identify the
      // same canonical calendar event as the completed sample meeting.
      eventId: SAMPLE_MEETING_EVENT_ID,
      day,
    },
    brief: {
      status: 'ready',
      eventTitle: SAMPLE_MEETING_EVENT_TITLE,
      generatedAt: new Date().toISOString(),
      stale: false,
      isSample: true,
      markdown: [
        `# Before you meet: ${SAMPLE_MEETING_EVENT_TITLE}`,
        '',
        '- Robert wants the Roth conversion to stay near the top of the 24% bracket without creating IRMAA exposure.',
        '- Susan wants to revisit 529 funding after retirement cash flow is clearer.',
        "- Beneficiary clean-up is mostly done, but Robert's consulting 401(k) and Susan's school 403(b) still need confirmation.",
        '',
        '## Suggested agenda',
        '',
        '1. Confirm Roth conversion ceiling.',
        '2. Review beneficiary follow-ups.',
        '3. Decide whether to move the 529 conversation to October.',
      ].join('\n'),
      citations: [
        { path: abs(workspaceRoot, SAMPLE_FILE_PLAN_SUMMARY), score: 0.96 },
        {
          path: abs(workspaceRoot, SAMPLE_FILE_BENEFICIARY_ESTATE),
          score: 0.94,
        },
        { path: abs(workspaceRoot, SAMPLE_FILE_MEETING_NOTES), score: 0.9 },
      ],
      bullets: sampleBriefBullets(workspaceRoot),
    },
  };
}

export type SampleReviewArtifactWriter = (
  artifact: MeetingArtifactInput
) => Promise<void>;

function sampleReviewArtifacts(
  meetingId: string
): readonly MeetingArtifactInput[] {
  const transcriptRef = `transcript:${SAMPLE_MEETING_EVENT_ID}`;
  const sourceRefs = [SAMPLE_CRM_SOURCE_REF, transcriptRef] as const;
  return [
    {
      meetingId,
      kind: 'action-update-proposal',
      schemaVersion: 2,
      producedAt: SAMPLE_MEETING_ENDED_AT,
      sourceRefs,
      provenance: 'local-processing',
      payload: {
        proposal: {
          id: SAMPLE_TASK_PROPOSAL_ID,
          kind: 'task',
          title: 'Prepare Hendricks Roth conversion authorization',
          detail:
            'Prepare the Schwab Roth conversion authorization for the Hendricks Q4 review.',
          ownerRef: null,
          dueDate: '2026-10-01',
          transcriptRef,
          sourceLabel: SAMPLE_MEETING_EVENT_TITLE,
        },
      },
    },
    {
      meetingId,
      kind: 'action-update-proposal',
      schemaVersion: 2,
      producedAt: SAMPLE_MEETING_ENDED_AT,
      sourceRefs,
      provenance: 'local-processing',
      payload: {
        proposal: {
          id: SAMPLE_CRM_PROPOSAL_ID,
          kind: 'crm-update',
          title: 'Set Hendricks household October review date',
          detail:
            'Move the household follow-up date to the October review after retirement income is clearer.',
          transcriptRef,
          entityRef: SAMPLE_CRM_HOUSEHOLD_KEY,
          sourceLabel: SAMPLE_MEETING_EVENT_TITLE,
          fields: [
            {
              field: 'nextReviewDate',
              label: 'Next review date',
              valueType: 'date',
              before: '2026-07-02',
              proposed: '2026-10-01',
            },
          ],
        },
      },
    },
  ];
}

/**
 * The sample's durable CRM link must exist before the normal matter-selection
 * request. That request is the authority that mints the Meetings boundary.
 */
export function ensureSampleHendricksCrmLink(matterId: string): void {
  const store = useMatterStore.getState();
  const matter = store.matters.find((m) => m.id === matterId);
  if (!matter) return;
  if ((matter.crmHouseholdKeys ?? []).includes(SAMPLE_CRM_HOUSEHOLD_KEY))
    return;
  store.addCrmHouseholdKey(matterId, SAMPLE_CRM_HOUSEHOLD_KEY);
}

async function preservedMeetingVisibility(
  workspace: WorkspaceService,
  meetingJsonPath: string
): Promise<MeetingMeta['meetingFileVisibility'] | undefined> {
  const source = workspace as WorkspaceService & {
    exists?: (path: string) => Promise<boolean>;
  };
  if (typeof source.readFile !== 'function') return undefined;
  let existing: unknown;
  try {
    existing = JSON.parse(await source.readFile(meetingJsonPath));
  } catch (error) {
    if (
      typeof source.exists === 'function' &&
      !(await source.exists(meetingJsonPath))
    )
      return undefined;
    if (
      error instanceof Error &&
      /missing|not found|enoent/i.test(error.message)
    )
      return undefined;
    throw new Error(
      'The existing sample meeting visibility could not be recovered safely.'
    );
  }
  if (!existing || typeof existing !== 'object' || Array.isArray(existing))
    throw new Error(
      'The existing sample meeting visibility could not be recovered safely.'
    );
  const visibility = (existing as { meetingFileVisibility?: unknown })
    .meetingFileVisibility;
  if (!isPreservableSampleVisibility(visibility)) {
    throw new Error(
      'The existing sample meeting visibility could not be recovered safely.'
    );
  }
  return visibility;
}

async function ensureCanonicalSampleMeeting(
  operation: ActiveClientMeetingPopulationOperation,
  workspaceRoot: string
): Promise<Awaited<ReturnType<MeetingPopulationService['findByReference']>>> {
  let meeting = await operation.findByReference(SAMPLE_CRM_SOURCE_REF);
  if (meeting) {
    return meeting;
  } else {
    // The population service, not this seed, derives the household + matter
    // from the live selected-client boundary immediately before it writes.
    meeting = await operation.createForActiveClient({
      workspaceId: workspaceRoot,
      typeId: 'annual-review',
      // A local sample is explicitly accountless, not a made-up advisor.
      ownerRef: null,
      scheduledStartUtc: SAMPLE_MEETING_STARTED_AT,
      scheduledEndUtc: SAMPLE_MEETING_ENDED_AT,
      timezone: 'UTC',
      references: [SAMPLE_CRM_SOURCE_REF],
    });
  }

  return meeting;
}

function exactText(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value === value.trim()
  );
}

function isOwnerPrivateManifest(
  value: unknown
): value is MeetingFileVisibilityManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as MeetingFileVisibilityManifest;
  const root = manifest.meetingSubject;
  if (
    manifest.version !== 1 ||
    !root ||
    root.kind !== 'meeting-note' ||
    root.lineage !== 'root' ||
    !exactText(root.id) ||
    !exactText(root.ownerRef) ||
    !exactText(root.visibilityPolicyId) ||
    !manifest.files ||
    typeof manifest.files !== 'object' ||
    Array.isArray(manifest.files)
  )
    return false;
  return Object.entries(manifest.files).every(
    ([name, subject]) =>
      exactText(name) &&
      !name.includes('/') &&
      subject?.kind === 'file-reference' &&
      subject.lineage === 'derived' &&
      subject.parentRef?.kind === 'meeting-note' &&
      subject.parentRef.id === root.id &&
      exactText(subject.id)
  );
}

function isExactAccountlessSampleManifest(
  value: unknown
): value is MeetingFileVisibilityManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as MeetingFileVisibilityManifest;
  const rootId = `meeting-file:${SAMPLE_MEETING_EVENT_ID}`;
  if (
    manifest.version !== 1 ||
    manifest.meetingSubject?.id !== rootId ||
    manifest.meetingSubject.kind !== 'meeting-note' ||
    manifest.meetingSubject.lineage !== 'accountless-unrestricted'
  )
    return false;
  const names = Object.keys(manifest.files ?? {}).sort();
  if (
    names.join('\u0000') !==
    [...SAMPLE_MEETING_FILE_NAMES].sort().join('\u0000')
  )
    return false;
  return names.every((name) => {
    const subject = manifest.files[name];
    return (
      subject?.kind === 'file-reference' &&
      subject.lineage === 'accountless-unrestricted' &&
      subject.id === `${rootId}:file:${encodeURIComponent(name)}`
    );
  });
}

function isPreservableSampleVisibility(
  value: unknown
): value is MeetingFileVisibilityManifest {
  return (
    isOwnerPrivateManifest(value) || isExactAccountlessSampleManifest(value)
  );
}

async function completeCanonicalSampleMeeting(
  operation: ActiveClientMeetingPopulationOperation,
  meeting: NonNullable<
    Awaited<ReturnType<MeetingPopulationService['findByReference']>>
  >
): Promise<void> {
  const meetingDir = `Meetings/${SAMPLE_MEETING_FOLDER}`;
  meeting = await operation.linkLegacy(meeting.id, { meetingDir });

  while (meeting.state !== 'completed') {
    const transition = (() => {
      switch (meeting.state) {
        case 'draft':
          return {
            from: 'draft' as const,
            to: 'scheduled' as const,
            at: SAMPLE_MEETING_STARTED_AT,
          };
        case 'scheduled':
          return {
            from: 'scheduled' as const,
            to: 'in-progress' as const,
            at: SAMPLE_MEETING_STARTED_AT,
          };
        case 'in-progress':
          return {
            from: 'in-progress' as const,
            to: 'completed' as const,
            at: SAMPLE_MEETING_ENDED_AT,
          };
        case 'cancelled':
          throw new Error(
            'The canonical Hendricks meeting is not completable.'
          );
      }
    })();
    meeting = await operation.transition(meeting.id, transition);
  }
}

export async function seedSampleGoldenPath(
  workspace: WorkspaceService,
  workspaceRoot: string,
  matterId: string,
  population: MeetingPopulationService,
  boundary: SealedMeetingClientBoundary,
  writeReviewArtifact: SampleReviewArtifactWriter = async () => undefined
): Promise<void> {
  // The welcome action minted this exact boundary. Deferred work must verify
  // it, never capture whichever client happens to be selected later.
  if (
    boundary.matterId !== matterId ||
    boundary.householdRef !== SAMPLE_CRM_HOUSEHOLD_KEY
  ) {
    throw new Error('The Hendricks sample client changed before setup began.');
  }
  const operation =
    population.captureActiveClientOperationForBoundary(boundary);
  const meetingDir = `${workspaceRoot.replace(/[\\/]+$/, '')}/Meetings/${SAMPLE_MEETING_FOLDER}`;
  const visibility = await preservedMeetingVisibility(
    workspace,
    `${meetingDir}/meeting.json`
  );
  operation.assertStable();
  // Create the canonical record before any workspace file. A failed create
  // therefore cannot leave sample material in the previously open workspace.
  const canonical = await ensureCanonicalSampleMeeting(
    operation,
    workspaceRoot
  );
  if (!canonical)
    throw new Error('The canonical Hendricks meeting could not be found.');
  operation.assertStable();
  await workspace.writeFile(
    `${meetingDir}/meeting.json`,
    JSON.stringify(sampleMeetingMeta(matterId, visibility), null, 2)
  );
  operation.assertStable();
  await workspace.writeFile(
    `${meetingDir}/transcript.json`,
    JSON.stringify(sampleTranscript(matterId), null, 2)
  );
  operation.assertStable();
  const notesBytes = await markdownToDocxBytes(
    sampleMeetingNotesMarkdown(),
    'notes.docx'
  );
  operation.assertStable();
  await workspace.writeFileBinary(
    `${meetingDir}/notes.docx`,
    exactBuffer(notesBytes)
  );

  operation.assertStable();
  await completeCanonicalSampleMeeting(operation, canonical);
  operation.assertStable();
  for (const artifact of sampleReviewArtifacts(canonical.id)) {
    await writeReviewArtifact(artifact);
    operation.assertStable();
  }
  const sample = sampleBrief(workspaceRoot, matterId);
  useBriefStore.getState().upsert(sample.identity, sample.brief);
}

export const SAMPLE_GOLDEN_PATH = {
  meetingFolder: SAMPLE_MEETING_FOLDER,
  completedEventId: SAMPLE_MEETING_EVENT_ID,
  briefEventId: SAMPLE_MEETING_EVENT_ID,
  eventId: SAMPLE_MEETING_EVENT_ID,
  eventTitle: SAMPLE_MEETING_EVENT_TITLE,
  startedAt: SAMPLE_MEETING_STARTED_AT,
  endedAt: SAMPLE_MEETING_ENDED_AT,
  crmSourceRef: SAMPLE_CRM_SOURCE_REF,
  crmHouseholdKey: SAMPLE_CRM_HOUSEHOLD_KEY,
  taskProposalId: SAMPLE_TASK_PROPOSAL_ID,
  crmProposalId: SAMPLE_CRM_PROPOSAL_ID,
} as const;
