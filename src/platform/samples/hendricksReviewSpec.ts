/** The one accountless demo record that may be visible without an advisor ID. */
export const HENDRICKS_REVIEW = {
  householdRef: 'sample-hendricks-household',
  eventId: 'sample-hendricks-annual-review',
  sourceRef: 'meeting:sample-hendricks-annual-review',
  title: 'Hendricks annual review',
  typeId: 'annual-review',
  startedAt: '2026-07-02T14:00:00.000Z',
  endedAt: '2026-07-02T14:42:00.000Z',
  taskProposalId: 'sample-hendricks-task-proposal',
  crmProposalId: 'sample-hendricks-crm-proposal',
} as const;

export const HENDRICKS_REVIEW_PROPOSALS = [
  {
    id: HENDRICKS_REVIEW.taskProposalId,
    kind: 'task',
    title: 'Prepare Hendricks Roth conversion authorization',
    detail: 'Prepare the Schwab Roth conversion authorization for the Hendricks Q4 review.',
    ownerRef: null,
    dueDate: '2026-10-01',
  },
  {
    id: HENDRICKS_REVIEW.crmProposalId,
    kind: 'crm-update',
    title: 'Set Hendricks household October review date',
    detail: 'Move the household follow-up date to the October review after retirement income is clearer.',
    field: 'nextReviewDate',
    before: '2026-07-02',
    proposed: '2026-10-01',
  },
] as const;

type RecordLike = Record<string, unknown>;

/** Deliberately checks canonical machine facts only: never display copy. */
export function isExactHendricksAccountlessMeeting(
  value: unknown,
  boundary: { readonly matterId: string; readonly workspaceId: string }
): value is RecordLike {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as RecordLike;
  const references = record['references'];
  return record['kind'] === 'meeting' &&
    record['ownerRef'] === null &&
    record['householdRef'] === HENDRICKS_REVIEW.householdRef &&
    record['matterId'] === boundary.matterId &&
    record['workspaceId'] === boundary.workspaceId &&
    record['typeId'] === HENDRICKS_REVIEW.typeId &&
    record['scheduledStartUtc'] === HENDRICKS_REVIEW.startedAt &&
    record['scheduledEndUtc'] === HENDRICKS_REVIEW.endedAt &&
    Array.isArray(references) && references.length === 1 &&
    references[0] === HENDRICKS_REVIEW.sourceRef;
}

export function isExactHendricksReviewProposal(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proposal = value as RecordLike;
  return HENDRICKS_REVIEW_PROPOSALS.some((expected) => {
    if (proposal['id'] !== expected.id || proposal['kind'] !== expected.kind ||
      proposal['title'] !== expected.title || proposal['detail'] !== expected.detail) return false;
    if (expected.kind === 'task')
      return proposal['ownerRef'] === expected.ownerRef && proposal['dueDate'] === expected.dueDate;
    const fields = proposal['fields'];
    if (proposal['entityRef'] !== HENDRICKS_REVIEW.householdRef ||
      !Array.isArray(fields) || fields.length !== 1 ||
      !fields[0] || typeof fields[0] !== 'object' || Array.isArray(fields[0])) return false;
    const field = fields[0] as RecordLike;
    return field['field'] === expected.field && field['label'] === 'Next review date' &&
      field['valueType'] === 'date' && field['before'] === expected.before &&
      field['proposed'] === expected.proposed;
  });
}
