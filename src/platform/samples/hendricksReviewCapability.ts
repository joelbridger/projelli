/**
 * The small, fixed capability behind Lantern's built-in Hendricks walkthrough.
 * It is deliberately data, not a second review store: the two payloads below
 * are written as ordinary meeting artifacts and then travel through the normal
 * approval and local-delivery code.
 */
import type { MeetingArtifactInput } from '@/features/meetings';
import { invoke, isTauri } from '@tauri-apps/api/core';

export const HENDRICKS_REVIEW_CAPABILITY_V1 = 'hendricks-review-capability-v1' as const;
export const HENDRICKS_REVIEW_LINEAGE = 'hendricks-sample-capability' as const;
/** SHA-256 of the immutable built-in identity, meeting facts, IDs, and field name. */
export const HENDRICKS_REVIEW_CAPABILITY_STATIC_DIGEST = 'e8d6c5e662def2548d39dc225e6f8beea47fc688da56860e50b3eefbc708fa3a' as const;
export const HENDRICKS_TASK_ARTIFACT_ID = 'hendricks-review-task-v1' as const;
export const HENDRICKS_CRM_ARTIFACT_ID = 'hendricks-review-crm-v1' as const;
export const HENDRICKS_HOUSEHOLD_KEY = 'sample-hendricks-household' as const;
export const HENDRICKS_EVENT_ID = 'sample-hendricks-annual-review' as const;
export const HENDRICKS_STARTED_AT = '2026-07-02T14:00:00.000Z' as const;
export const HENDRICKS_ENDED_AT = '2026-07-02T14:42:00.000Z' as const;

export type HendricksReviewBinding = Readonly<{
  workspaceRoot: string;
  workspaceGeneration: number;
  matterId: string;
  meetingId: string;
}>;

export function hendricksReviewProposals(binding: HendricksReviewBinding) {
  const transcriptRef = `meeting:${HENDRICKS_EVENT_ID}:transcript`;
  const capability = {
    version: HENDRICKS_REVIEW_CAPABILITY_V1,
    lineage: HENDRICKS_REVIEW_LINEAGE,
    workspaceRoot: binding.workspaceRoot,
    workspaceGeneration: binding.workspaceGeneration,
    matterId: binding.matterId,
    householdRef: HENDRICKS_HOUSEHOLD_KEY,
    meetingId: binding.meetingId,
    eventId: HENDRICKS_EVENT_ID,
    startedAt: HENDRICKS_STARTED_AT,
    endedAt: HENDRICKS_ENDED_AT,
  } as const;
  return [
    {
      id: HENDRICKS_TASK_ARTIFACT_ID,
      kind: 'task' as const,
      title: "Confirm Robert's consulting 401(k) beneficiary designations",
      detail: "Confirm Robert's consulting 401(k) beneficiary designations and record the result for the Hendricks household.",
      ownerRef: null,
      dueDate: null,
      transcriptRef,
      sourceLabel: 'Hendricks annual review transcript',
      capability,
    },
    {
      id: HENDRICKS_CRM_ARTIFACT_ID,
      kind: 'crm-update' as const,
      title: 'Record the Hendricks annual-review follow-up',
      detail: 'Add the annual-review follow-up to the local Hendricks household record.',
      transcriptRef,
      entityRef: HENDRICKS_HOUSEHOLD_KEY,
      fields: [
        {
          field: 'annualReviewFollowUp',
          valueType: 'text' as const,
          before: null,
          proposed: 'Confirm Robert\'s consulting 401(k) beneficiary designations.',
        },
      ],
      sourceLabel: 'Hendricks annual review transcript',
      capability,
    },
  ] as const;
}

/** Build only the two canonical artifact inputs; callers still use the real store. */
export function hendricksReviewArtifactInputs(
  binding: HendricksReviewBinding
): readonly (MeetingArtifactInput & { readonly id: string })[] {
  return hendricksReviewProposals(binding).map((proposal) => ({
    id: proposal.id,
    meetingId: binding.meetingId,
    kind: 'action-update-proposal' as const,
    schemaVersion: 2,
    producedAt: HENDRICKS_ENDED_AT,
    sourceRefs: [proposal.transcriptRef],
    provenance: HENDRICKS_REVIEW_LINEAGE,
    payload: { proposal },
  }));
}

/** The desktop path asks SQLCipher to validate and sign this before artifacts exist. */
export async function sealHendricksReviewCapability(
  binding: HendricksReviewBinding
): Promise<void> {
  if (!isTauri()) return;
  const proposals = hendricksReviewProposals(binding).map(({ capability: _capability, ...proposal }) => proposal);
  await invoke('crm_hendricks_review_capability_seal', {
    manifest: {
      version: HENDRICKS_REVIEW_CAPABILITY_V1,
      lineage: HENDRICKS_REVIEW_LINEAGE,
      staticDigest: HENDRICKS_REVIEW_CAPABILITY_STATIC_DIGEST,
      workspaceRoot: binding.workspaceRoot,
      workspaceGeneration: binding.workspaceGeneration,
      matterId: binding.matterId,
      householdRef: HENDRICKS_HOUSEHOLD_KEY,
      meetingId: binding.meetingId,
      eventId: HENDRICKS_EVENT_ID,
      startedAt: HENDRICKS_STARTED_AT,
      endedAt: HENDRICKS_ENDED_AT,
      proposals,
    },
  });
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Fail closed unless this is one of the two exact built-in artifacts. */
export function isHendricksReviewArtifact(value: {
  readonly id: string;
  readonly meetingId: string;
  readonly householdRef: string;
  readonly matterId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly schemaVersion: number;
  readonly meetingVisibility?: { readonly lineage?: unknown };
}): boolean {
  if (
    value.householdRef !== HENDRICKS_HOUSEHOLD_KEY ||
    value.schemaVersion !== 2 ||
    value.meetingVisibility?.lineage !== 'accountless-unrestricted'
  ) return false;
  const expected = hendricksReviewProposals({
    workspaceRoot: String((value.payload['proposal'] as { capability?: { workspaceRoot?: unknown } })?.capability?.workspaceRoot ?? ''),
    workspaceGeneration: Number((value.payload['proposal'] as { capability?: { workspaceGeneration?: unknown } })?.capability?.workspaceGeneration),
    matterId: value.matterId,
    meetingId: value.meetingId,
  }).find((proposal) => proposal.id === value.id);
  return Boolean(expected && sameJson(value.payload['proposal'], expected));
}
