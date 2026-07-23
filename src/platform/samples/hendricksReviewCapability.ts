/**
 * The one sealed walkthrough capability.  These values are repeated by the
 * SQLCipher command; this browser copy is display data only and never grants
 * access or signs a proposal.
 */
export const HENDRICKS_REVIEW_LINEAGE = 'hendricks-sample-capability' as const;
export const HENDRICKS_REVIEW_VERSION = 1 as const;
export const HENDRICKS_SAMPLE_MATTER_ID = 'matter_sample_garcia_v_meridian' as const;
export const HENDRICKS_HOUSEHOLD_REF = 'sample-hendricks-household' as const;
export const HENDRICKS_MEETING_ID = 'sample-hendricks-annual-review' as const;
export const HENDRICKS_TASK_ARTIFACT_ID = 'builtin-hendricks-task-v1' as const;
export const HENDRICKS_CRM_ARTIFACT_ID = 'builtin-hendricks-crm-v1' as const;
export const HENDRICKS_TRANSCRIPT_REF =
  'sample-hendricks-annual-review#64-92000' as const;

export const HENDRICKS_REVIEW_CAPABILITY = Object.freeze({
  version: HENDRICKS_REVIEW_VERSION,
  lineage: HENDRICKS_REVIEW_LINEAGE,
  matterId: HENDRICKS_SAMPLE_MATTER_ID,
  householdRef: HENDRICKS_HOUSEHOLD_REF,
  meeting: {
    id: HENDRICKS_MEETING_ID,
    title: 'Hendricks annual review',
    typeId: 'annual-review',
    state: 'completed',
    ownerRef: null,
    sourceRef: 'meeting:sample-hendricks-annual-review',
    startedAt: '2026-07-02T14:00:00.000Z',
    endedAt: '2026-07-02T14:42:00.000Z',
    directory: 'Meetings/2026-07-02-hendricks-annual-review',
  },
  task: {
    id: HENDRICKS_TASK_ARTIFACT_ID,
    title: 'Confirm Robert’s consulting 401(k) beneficiary designations',
    detail:
      'Confirm the primary and contingent beneficiary designations and record the outcome.',
    ownerRef: null,
    dueDate: null,
    transcriptRef: HENDRICKS_TRANSCRIPT_REF,
    sourceLabel: 'Hendricks annual review transcript',
  },
  crm: {
    id: HENDRICKS_CRM_ARTIFACT_ID,
    title: 'Record the annual-review follow-up',
    detail: 'Save the completed annual-review note on the Hendricks household.',
    transcriptRef: HENDRICKS_TRANSCRIPT_REF,
    sourceLabel: 'Hendricks annual review transcript',
    entityRef: HENDRICKS_HOUSEHOLD_REF,
    field: 'annualReviewNote',
    valueType: 'text',
    before: '',
    proposed:
      'Annual review completed. Roth conversion remains planned for Q4; confirm Robert’s consulting 401(k) beneficiaries; revisit 529 funding in October.',
  },
});

export type HendricksReviewCapability = typeof HENDRICKS_REVIEW_CAPABILITY;

export function isExactHendricksReviewCapability(
  value: unknown
): value is HendricksReviewCapability {
  return JSON.stringify(value) === JSON.stringify(HENDRICKS_REVIEW_CAPABILITY);
}

export function isHendricksReviewIdentity(input: {
  readonly matterId: unknown;
  readonly householdRef: unknown;
  readonly meetingId: unknown;
}): boolean {
  return (
    input.matterId === HENDRICKS_SAMPLE_MATTER_ID &&
    input.householdRef === HENDRICKS_HOUSEHOLD_REF &&
    input.meetingId === HENDRICKS_MEETING_ID
  );
}
