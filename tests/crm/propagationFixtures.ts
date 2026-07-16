import type {
  PropagationTransactionPayload,
  PropagationTransactionPort,
  TemplateRevision,
  WorkflowInstanceSnapshot,
  WorkflowTemplateSnapshot,
} from '@/platform/crm/propagation';

export class RecordingTransaction implements PropagationTransactionPort {
  readonly payloads: PropagationTransactionPayload[] = [];
  transact(payload: PropagationTransactionPayload): void { this.payloads.push(payload); }
}

export function revision(
  revisionId: string,
  parents: string[],
  changes: TemplateRevision['stepChanges'],
  clock = 1,
): TemplateRevision {
  return {
    revisionId, templateId: 'template-1', parentRevisionIds: parents,
    issuedHlc: { wallMillis: clock, logicalCounter: 0, actorId: 'advisor', operationId: `op-${revisionId}` },
    label: revisionId, stepChanges: changes,
  };
}

export function template(revisions: TemplateRevision[], heads = revisions.map((item) => item.revisionId)): WorkflowTemplateSnapshot {
  return {
    id: 'template-1',
    revisions: Object.fromEntries(revisions.map((item) => [item.revisionId, item])),
    headRevisionIds: heads,
  };
}

export function instance(): WorkflowInstanceSnapshot {
  return {
    id: 'instance-1', acceptedRevisionIds: [], displayedRevisionSet: { revisionIds: [] },
    decisionLedger: [], propagationEvents: [],
    steps: {
      step: {
        stepId: 'step', origin: 'template', status: 'todo', titleSnapshot: 'Old title',
        derived: { title: { value: 'Old title', sourceRevisionId: 'base', sourceOperationId: 'old-op' } },
        removalRequestedBy: [], detachedFromTemplate: false, stepNotes: '',
        tagIds: [], documentRefs: [],
        assignmentOperations: [], completionOperations: [],
      },
    },
  };
}
