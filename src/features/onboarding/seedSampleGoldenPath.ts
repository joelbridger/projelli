import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import {
  useBriefStore,
  localDay,
  type ExactMeetingBriefIdentity,
  type MeetingBriefDraft,
} from '@/features/meetings/briefStore';
import type { MeetingMeta } from '@/features/meetings/meetingStore';
import type { MeetingBriefBullet } from '@/features/meetings/generateBrief';
import type { SealedMeetingClientBoundary } from '@/features/meetings';
import type { TranscriptFile } from '@/platform/types/meeting';
import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { markdownToDocxBytes } from '@/platform/utils/docx-io';
import { useFirmStore } from '@/platform/firm/firmStore';
import { applyMeetingStamp } from '@/platform/fs/meetingMaterialVisibility';
import {
  SAMPLE_FILE_BENEFICIARY_ESTATE,
  SAMPLE_FILE_MEETING_NOTES,
  SAMPLE_FILE_PLAN_SUMMARY,
  sampleFilePath,
} from '@/platform/matter/samples/sampleMatterDemo';

const SAMPLE_MEETING_FOLDER = '2026-07-02-hendricks-annual-review';
/** Stable owner for the synthetic sample when no firm session is established. */
const SAMPLE_MEETING_OWNER_REF = 'sample-advisor';
const SAMPLE_COMPLETED_EVENT_ID = 'sample-hendricks-annual-review';
const SAMPLE_BRIEF_EVENT_ID = 'sample-hendricks-planning-check-in';
const SAMPLE_BRIEF_EVENT_TITLE = 'Hendricks planning check-in';
const SAMPLE_CRM_SOURCE_REF = 'meeting:sample-hendricks-annual-review';
const SAMPLE_CRM_HOUSEHOLD_KEY = 'sample-hendricks-household';

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
}

function abs(workspaceRoot: string, filename: string): string {
  return sampleFilePath(workspaceRoot, filename);
}

function sampleMeetingMeta(matterId: string): MeetingMeta {
  const startedAt = '2026-07-02T14:00:00.000Z';
  return {
    matterId,
    startedAt,
    durationMs: 42 * 60 * 1000,
    calendarTitle: 'Hendricks annual review',
    customTitle: 'Hendricks annual review',
    typeId: 'annual-review',
    reviewedAt: '2026-07-02T15:01:00.000Z',
    consent: {
      mode: 'two-party',
      confirmedBy: 'Advisor',
      confirmedAt: startedAt,
      note: 'Sample meeting. Consent captured for demo data only.',
    },
    calendarEvent: {
      id: SAMPLE_COMPLETED_EVENT_ID,
      title: 'Hendricks annual review',
      startUtc: startedAt,
      endUtc: '2026-07-02T14:42:00.000Z',
      attendees: [
        { name: 'Robert Hendricks', email: 'robert.hendricks@email.com' },
        { name: 'Susan Hendricks', email: 'susan.hendricks@email.com' },
      ],
    },
  };
}

function sampleTranscript(matterId: string): TranscriptFile {
  const startedAt = '2026-07-02T14:00:00.000Z';
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
      startedAt,
      durationMs: 42 * 60 * 1000,
      matterId,
      consent: {
        mode: 'two-party',
        confirmedBy: 'Advisor',
        confirmedAt: startedAt,
        note: 'Sample meeting. Consent captured for demo data only.',
      },
    },
  };
}

function sampleMeetingNotesMarkdown(): string {
  return [
    '# Hendricks annual review',
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
      eventId: SAMPLE_BRIEF_EVENT_ID,
      day,
    },
    brief: {
      status: 'ready',
      eventTitle: SAMPLE_BRIEF_EVENT_TITLE,
      generatedAt: new Date().toISOString(),
      stale: false,
      isSample: true,
      markdown: [
        `# Before you meet: ${SAMPLE_BRIEF_EVENT_TITLE}`,
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

function seedSampleCrmApproval(matterId: string): void {
  const store = useCrmWriteQueueStore.getState();
  const existing = store.items.some(
    (item) =>
      item.matterId === matterId && item.sourceRef === SAMPLE_CRM_SOURCE_REF
  );
  if (existing) return;
  store.enqueue({
    kind: 'note',
    matterId,
    title: 'Annual review follow-ups',
    body: 'Annual review completed. Prepare Q4 Roth conversion authorization, confirm remaining beneficiary designations, and revisit 529 funding at the October review.',
    sourceRef: SAMPLE_CRM_SOURCE_REF,
    aiSource: { kind: 'meeting', date: '2026-07-02' },
  });
}

function seedSampleCrmLink(matterId: string): void {
  const store = useMatterStore.getState();
  const matter = store.matters.find((m) => m.id === matterId);
  if (!matter) return;
  if ((matter.crmHouseholdKeys ?? []).includes(SAMPLE_CRM_HOUSEHOLD_KEY))
    return;
  store.addCrmHouseholdKey(matterId, SAMPLE_CRM_HOUSEHOLD_KEY);
}

export async function seedSampleGoldenPath(
  workspace: WorkspaceService,
  workspaceRoot: string,
  matterId: string
): Promise<void> {
  const meetingDir = `${workspaceRoot.replace(/[\\/]+$/, '')}/Meetings/${SAMPLE_MEETING_FOLDER}`;
  // CONTAINMENT (WB-085): the onboarding sample is file-backed meeting material
  // like any other, so it is stamped at creation. Without a stamp it would fail
  // closed on read and the golden-path sample would appear broken.
  // The sample carries a BROAD policy, not owner-private: it is synthetic demo
  // content, not a real client conversation, so classifying it as firm-visible
  // is honest rather than a relaxation — and it keeps the golden path working
  // for whichever advisor opens the sample workspace.
  const sampleOwner = useFirmStore.getState().session?.userId;
  await workspace.writeFile(
    `${meetingDir}/meeting.json`,
    JSON.stringify(
      applyMeetingStamp(
        sampleMeetingMeta(matterId) as unknown as Record<string, unknown>,
        {
          ownerRef:
            typeof sampleOwner === 'string' && sampleOwner.trim()
              ? sampleOwner.trim()
              : SAMPLE_MEETING_OWNER_REF,
          visibilityPolicyId: 'household-team',
        }
      ),
      null,
      2
    )
  );
  await workspace.writeFile(
    `${meetingDir}/transcript.json`,
    JSON.stringify(sampleTranscript(matterId), null, 2)
  );
  const notesBytes = await markdownToDocxBytes(
    sampleMeetingNotesMarkdown(),
    'notes.docx'
  );
  await workspace.writeFileBinary(
    `${meetingDir}/notes.docx`,
    exactBuffer(notesBytes)
  );

  seedSampleCrmLink(matterId);
  const sample = sampleBrief(workspaceRoot, matterId);
  useBriefStore.getState().upsert(sample.identity, sample.brief);
  seedSampleCrmApproval(matterId);
}

export const SAMPLE_GOLDEN_PATH = {
  meetingFolder: SAMPLE_MEETING_FOLDER,
  completedEventId: SAMPLE_COMPLETED_EVENT_ID,
  briefEventId: SAMPLE_BRIEF_EVENT_ID,
  eventId: SAMPLE_BRIEF_EVENT_ID,
  crmSourceRef: SAMPLE_CRM_SOURCE_REF,
  crmHouseholdKey: SAMPLE_CRM_HOUSEHOLD_KEY,
} as const;
