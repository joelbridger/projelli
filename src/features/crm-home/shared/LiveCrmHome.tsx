/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useEffect, type ReactNode } from 'react';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { nextRecurringDue } from '@/platform/crm/tasks';
import { createMigrationExport, runWealthboxMigration } from '@/platform/crm/migration';
import { applyWorkflowStepCompletion, createTemplate, startScheduledWorkflows, startWorkflow, workflowRecords } from '../workflowLive';
import { CrmHomeShell } from '../CrmHome';
import type { HouseholdChoice } from '@/features/crm-workflows/Workflows';
import { mergeCrmTaskRecord, projectCrmTask } from './liveTaskAdapter';
import { projectCrmWorkflowWorkItem } from './liveWorkflowWorkItemAdapter';
import type { CrmHomeProps } from '../routes';
import type { CrmActivity, CrmApproval, CrmFirmMember, CrmFreshnessState, CrmHomeAdapter, CrmTask, CrmTaskSavedView, CrmWorkflowWorkItem, AttachmentAccountingRecord, ExportJobStatus, MigrationFidelityReport, MigrationNoteGap, MigrationWorkflowChecklist, PropagationOffer } from '../types';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { useFirmStore } from '@/platform/firm/firmStore';
import {
  derivedMeetingVisibility,
  explicitLegacyMeetingVisibility,
  meetingVisibilityParentForRecord,
} from '@/platform/meeting-visibility';

/** The live CRM state that a host shell passes to a registry destination. */
export interface LiveCrmHomeRuntime
  extends Pick<
    CrmHomeProps,
    'initialRoute' | 'showRail' | 'addRequest' | 'onAddRequestConsumed'
  > {
  adapter: CrmHomeAdapter;
  workflowData?: ReturnType<typeof workflowRecords>;
  workflowHouseholds?: readonly HouseholdChoice[];
  saveLiveRecord?: (record: LiveCrmRecord) => Promise<unknown>;
  adapterProvided: boolean;
}

function workflowHouseholdsFor(records: readonly LiveCrmRecord[]): HouseholdChoice[] {
  return records
    .filter((record) => record.kind === 'household')
    .map((record) => ({
      id: record.id,
      matterId: record.matterId?.trim() || record.id,
      label:
        typeof record['name'] === 'string'
          ? record['name']
          : typeof record['label'] === 'string'
            ? record['label']
            : 'Untitled household',
    }));
}

const PREVIEW_OFFERS: readonly PropagationOffer[] = [
  {
    id: 'offer-henderson',
    instanceId: 'winst-henderson',
    householdLabel: 'Henderson household',
    revisionLabel: 'Welcome sequence refresh',
    state: 'ready',
    steps: [
      {
        id: 'step-confirm-transfer',
        label: 'Confirm recurring transfer',
        changeKind: 'modify',
        protectedProgress: {
          status: 'todo',
          hasNotes: false,
          hasCompletion: false,
          hasOutcome: false,
          hasAssignmentHistory: false,
        },
        decisions: [
          {
            id: 'decision-due',
            revisionId: 'rev-welcome-refresh',
            stepId: 'step-confirm-transfer',
            field: 'due_offset',
            label: 'Due offset',
            before: '+0 days',
            after: '+4 days',
            decision: 'accepted',
            reofferState: 'original',
          },
          {
            id: 'decision-role',
            revisionId: 'rev-welcome-refresh',
            stepId: 'step-confirm-transfer',
            field: 'default_assignee_role',
            label: 'Default assignee role',
            before: 'CSA',
            after: 'Operations',
            decision: 'accepted',
            reofferState: 'original',
          },
        ],
      },
      {
        id: 'step-paper-kit',
        label: 'Paper welcome kit',
        changeKind: 'remove',
        protectedProgress: {
          status: 'todo',
          hasNotes: false,
          hasCompletion: false,
          hasOutcome: false,
          hasAssignmentHistory: false,
        },
        decisions: [
          {
            id: 'decision-remove',
            revisionId: 'rev-welcome-refresh',
            stepId: 'step-paper-kit',
            field: 'title',
            label: 'Remove untouched step',
            after: 'Untouched step will be removed',
            decision: 'accepted',
            reofferState: 'original',
          },
        ],
      },
    ],
  },
  {
    id: 'offer-miller',
    instanceId: 'winst-miller',
    householdLabel: 'Miller household',
    revisionLabel: 'Welcome sequence refresh',
    state: 'needs-decision',
    steps: [
      {
        id: 'step-send-packet',
        label: 'Send welcome packet',
        changeKind: 'modify',
        protectedProgress: {
          status: 'in_progress',
          hasNotes: true,
          hasCompletion: false,
          hasOutcome: false,
          hasAssignmentHistory: true,
        },
        decisions: [
          {
            id: 'decision-conflict',
            revisionId: 'rev-welcome-refresh-a',
            stepId: 'step-send-packet',
            field: 'due_offset',
            label: 'Due offset',
            before: '+2 days',
            after: '+4 days',
            decision: 'review_required',
            reofferState: 'original',
          },
        ],
        newAssignmentOffer: {
          id: 'assignment-miller',
          stepId: 'step-send-packet',
          assigneeLabel: 'Operations for future routing',
          decision: 'review_required',
        },
      },
    ],
  },
];

const PREVIEW_MIGRATION = {
  workflowChecklists: [
    {
      id: 'workflow-henderson',
      clientLabel: 'Henderson household',
      sourceTemplateLabel: 'Annual review',
      activityEvidence: [
        'Activity: review due',
        'Legacy Project: Annual review',
      ],
      availableSteps: ['Prepare review', 'Confirm meeting', 'Complete review'],
      decision: 'pending' as const,
    },
  ],
  attachmentAccounting: [
    {
      id: 'attachment-henderson',
      clientLabel: 'Henderson household',
      status: 'pending' as const,
    },
  ],
  exports: [
    {
      kind: 'archive' as const,
      status: 'ready' as const,
      manifestId: 'manifest_preview_001',
    },
    { kind: 'rollback' as const, status: 'ready' as const },
  ],
};

const PREVIEW_ADAPTER: CrmHomeAdapter = {
  freshness: { kind: 'idle' },
  tasks: [],
  offers: PREVIEW_OFFERS,
  migration: PREVIEW_MIGRATION,
  actions: {
    updateTask: () => undefined,
    applyPropagation: () => undefined,
    undoPropagation: () => ({ restored: 0, protectedCells: [] }),
    markNotificationsRead: () => undefined,
    recordWorkflowChecklist: () => undefined,
    recordAttachmentAccounting: () => undefined,
    createExport: () => undefined,
    retryExport: () => undefined,
  },
};

function emptyEngineAdapter(freshness: CrmFreshnessState): CrmHomeAdapter {
  return {
    freshness,
    tasks: [],
    approvals: [],
    activity: [],
    savedTaskViews: [],
    offers: [],
    migration: {
      workflowChecklists: [],
      attachmentAccounting: [],
      exports: [],
    },
    actions: {},
  };
}

export function LiveCrmHome({
  adapter,
  preview = false,
  initialRoute,
  showRail,
  addRequest,
  onAddRequestConsumed,
  render,
}: CrmHomeProps & {
  /** Lets another shell host the same live adapter and registry destinations. */
  render?: (runtime: LiveCrmHomeRuntime) => ReactNode;
}) {
  const live = useLiveCrmRecords();
  const viewerId = useFirmStore((state) => state.session?.userId ?? null);
  const freshness: CrmFreshnessState = live.freshness;
  const households = live.records
    .filter(
      (record) =>
        record.kind === 'household' && typeof record['name'] === 'string'
    )
    .map((record) => ({
      id: record.id,
      matterId: record.matterId?.trim() || record.id,
      name: record['name'] as string,
    }));
  const firmMembers: readonly CrmFirmMember[] = live.records
    .filter(
      (record) =>
        record.kind === 'firmDirectoryEntry' &&
        record['active'] === true &&
        typeof record['userId'] === 'string' &&
        typeof record['displayName'] === 'string'
    )
    .map((record) => ({
      userId: record['userId'] as string,
      displayName: record['displayName'] as string,
      ...(typeof record['title'] === 'string'
        ? { title: record['title'] }
        : {}),
    }));
  const householdName = (id: string | undefined) =>
    households.find((household) => household.id === id)?.name;
  const contextIds = (record: Record<string, unknown>): string[] =>
    Array.isArray(record['contextRefs'])
      ? record['contextRefs'].flatMap((value) =>
          typeof value === 'string'
            ? [value]
            : value &&
                typeof value === 'object' &&
                (value as { kind?: unknown }).kind === 'household' &&
                typeof (value as { id?: unknown }).id === 'string'
              ? [(value as { id: string }).id]
              : []
        )
      : [];
  const householdIdFor = (
    record: Record<string, unknown>
  ): string | undefined => {
    const ref = record['householdRef'];
    return ref &&
      typeof ref === 'object' &&
      typeof (ref as { id?: unknown }).id === 'string'
      ? (ref as { id: string }).id
      : contextIds(record)[0];
  };
  const liveTasks: readonly CrmTask[] = live.records
    .filter(
      (record) =>
        record.kind === 'task' &&
        live.canReadMeetingDerivedRecord(record, 'task')
    )
    .map((record) => {
      const householdId = householdIdFor(record);
      const member = firmMembers.find((candidate) => candidate.userId === record['assigneeUserId']);
      const householdLabel = householdId ? householdName(householdId) : undefined;
      return projectCrmTask(record, {
        ...(householdLabel ? { householdLabel } : {}),
        ...(member ? { assigneeLabel: member.displayName } : {}),
      });
    });
  const allWorkflowData = workflowRecords(live.records);
  const visibleWorkflowInstances = allWorkflowData.instances.filter((record) =>
    live.canReadMeetingDerivedRecord(record, 'workflow')
  );
  const visibleWorkflowIds = new Set(
    visibleWorkflowInstances.map((instance) => instance.id)
  );
  const visibleWorkflowData: ReturnType<typeof workflowRecords> = {
    ...allWorkflowData,
    instances: visibleWorkflowInstances,
    offers: allWorkflowData.offers.filter((offer) =>
      visibleWorkflowIds.has(offer.engineOffer.instanceId)
    ),
  };
  const liveWorkflowWorkItems: readonly CrmWorkflowWorkItem[] =
    visibleWorkflowInstances.flatMap((instance) =>
    Object.values(instance.snapshot.steps)
      .filter((step) => !step.hiddenByTemplateRemoval && step.status !== 'done')
      .map((step) => {
        const assigneeUserId = step.assigneeUserId ?? null;
        const member = firmMembers.find(
          (candidate) => candidate.userId === assigneeUserId
        );
        return projectCrmWorkflowWorkItem(instance, step, member?.displayName);
      })
  );
  const liveApprovals: readonly CrmApproval[] = live.records
    .filter(
      (record) =>
        record.kind === 'proposalRecord' &&
        live.canReadMeetingDerivedRecord(record, 'proposal')
    )
    .map((record) => {
      const householdId = householdIdFor(record);
      const proposalKind =
        typeof record['proposalKind'] === 'string'
          ? record['proposalKind'].replaceAll('_', ' ')
          : 'proposed change';
      return {
        id: record.id,
        title:
          typeof record['title'] === 'string'
            ? record['title']
            : `Review ${proposalKind}`,
        ...(typeof record['rationale'] === 'string'
          ? { rationale: record['rationale'] }
          : {}),
        ...(householdId ? { householdLabel: householdName(householdId) } : {}),
        state:
          record['state'] === 'approved' ||
          record['state'] === 'rejected' ||
          record['state'] === 'expired'
            ? record['state']
            : 'pending',
        ...(typeof record['decidedAt'] === 'string'
          ? { decidedAt: record['decidedAt'] }
          : {}),
      };
    });
  const liveActivity: readonly CrmActivity[] = live.records
    .filter(
      (record) =>
        record.kind === 'activityEvent' &&
        typeof record['at'] === 'string' &&
        live.canReadMeetingDerivedRecord(record, 'activity')
    )
    .map((record) => ({
      id: record.id,
      summary:
        typeof record['summary'] === 'string'
          ? record['summary']
          : 'CRM activity recorded',
      at: record['at'] as string,
    }));
  const savedTaskViews: readonly CrmTaskSavedView[] = live.records
    .filter(
      (record) => record.kind === 'savedView' && record['surface'] === 'tasks'
    )
    .map((record) => ({
      id: record.id,
      name: typeof record['name'] === 'string' ? record['name'] : 'Saved view',
      layout:
        record['layout'] === 'kanban' || record['layout'] === 'table'
          ? record['layout']
          : 'list',
      ...(typeof (record['query'] as { search?: unknown } | undefined)
        ?.search === 'string'
        ? { search: (record['query'] as { search: string }).search }
        : {}),
    }));
  const liveWorkflowChecklists: readonly MigrationWorkflowChecklist[] =
    live.records
      .filter((record) => record.kind === 'migration_workflow_checklist')
      .map((record) => ({
        id: record.id,
        ...(typeof record['householdId'] === 'string'
          ? { householdId: record['householdId'] }
          : {}),
        clientLabel:
          typeof record['clientLabel'] === 'string'
            ? record['clientLabel']
            : 'Imported client',
        sourceTemplateLabel:
          typeof record['sourceTemplateLabel'] === 'string'
            ? record['sourceTemplateLabel']
            : 'Imported workflow',
        activityEvidence: Array.isArray(record['activityEvidence'])
          ? record['activityEvidence'].filter(
              (item): item is string => typeof item === 'string'
            )
          : [],
        availableSteps: Array.isArray(record['availableSteps'])
          ? record['availableSteps'].filter(
              (item): item is string => typeof item === 'string'
            )
          : [],
        ...(typeof record['selectedCurrentStep'] === 'string'
          ? { selectedCurrentStep: record['selectedCurrentStep'] }
          : {}),
        evidenceReviewed: record['evidenceReviewed'] === true,
        decision:
          record['decision'] === 'recreate' || record['decision'] === 'gap'
            ? record['decision']
            : 'pending',
        ...(typeof record['resultingInstanceLabel'] === 'string'
          ? { resultingInstanceLabel: record['resultingInstanceLabel'] }
          : {}),
        ...(typeof record['gapReason'] === 'string'
          ? { gapReason: record['gapReason'] }
          : {}),
      }));
  const liveAttachmentAccounting: readonly AttachmentAccountingRecord[] =
    live.records
      .filter((record) => record.kind === 'migration_attachment_accounting')
      .map((record) => ({
        id: record.id,
        clientLabel:
          typeof record['clientLabel'] === 'string'
            ? record['clientLabel']
            : 'Imported client',
        status:
          record['status'] === 'exported' || record['status'] === 'gap'
            ? record['status']
            : 'pending',
        ...(typeof record['exportSource'] === 'string'
          ? { exportSource: record['exportSource'] }
          : {}),
        ...(typeof record['exportedBy'] === 'string'
          ? { exportedBy: record['exportedBy'] }
          : {}),
        ...(typeof record['gapReason'] === 'string'
          ? { gapReason: record['gapReason'] }
          : {}),
        ...(typeof record['gapOwner'] === 'string'
          ? { gapOwner: record['gapOwner'] }
          : {}),
      }));
  const liveNoteGaps: readonly MigrationNoteGap[] = live.records
    .filter((record) => record.kind === 'migration_note_gap')
    .map((record) => ({
      id: record.id,
      label:
        typeof record['label'] === 'string' ? record['label'] : 'Untitled note',
      reason:
        typeof record['reason'] === 'string'
          ? record['reason']
          : 'This note could not be safely linked to a client.',
    }));
  const reportRecord = live.records.find(
    (record) => record.kind === 'migration_report'
  );
  const liveReport: MigrationFidelityReport | undefined =
    reportRecord &&
    Array.isArray(reportRecord['matrix']) &&
    typeof reportRecord['batchId'] === 'string' &&
    typeof reportRecord['generatedAt'] === 'string' &&
    typeof reportRecord['message'] === 'string' &&
    reportRecord['attachments'] &&
    typeof reportRecord['attachments'] === 'object' &&
    reportRecord['workflows'] &&
    typeof reportRecord['workflows'] === 'object'
      ? (reportRecord as unknown as MigrationFidelityReport)
      : undefined;
  const liveExports: readonly ExportJobStatus[] = (
    ['archive', 'rollback'] as const
  ).map((kind) => {
    const record = live.records.find(
      (item) => item.kind === 'migration_export' && item['exportKind'] === kind
    );
    return {
      kind,
      status:
        record?.['status'] === 'exported' ||
        record?.['status'] === 'preparing' ||
        record?.['status'] === 'failed'
          ? record['status']
          : 'ready',
      ...(typeof record?.['exportedAt'] === 'string'
        ? { exportedAt: record['exportedAt'] }
        : {}),
      ...(typeof record?.['manifestId'] === 'string'
        ? { manifestId: record['manifestId'] }
        : {}),
      ...(typeof record?.['reconciliationReportId'] === 'string'
        ? { reconciliationReportId: record['reconciliationReportId'] }
        : {}),
      ...(typeof record?.['filePath'] === 'string'
        ? { filePath: record['filePath'] }
        : {}),
      ...(typeof record?.['byteLength'] === 'number'
        ? { byteLength: record['byteLength'] }
        : {}),
      ...(typeof record?.['sha256'] === 'string'
        ? { sha256: record['sha256'] }
        : {}),
      ...(typeof record?.['failureReason'] === 'string'
        ? { failureReason: record['failureReason'] }
        : {}),
    };
  });
  const recordActivity = async (
    summary: string,
    task?: CrmTask,
    verb = 'task.updated',
    visibilityParent?: LiveCrmRecord
  ) => {
    const now = new Date().toISOString();
    const id = `activity-${crypto.randomUUID()}`;
    const parent = visibilityParent
      ? meetingVisibilityParentForRecord(visibilityParent)
      : null;
    await live.save({
      id,
      kind: 'activityEvent',
      matterId: 'firm_home',
      at: now,
      summary,
      actor: { ...(viewerId ? { userId: viewerId } : {}), displayName: 'You' },
      verb,
      targetRef: task
        ? {
            kind: 'task',
            id: task.id,
            ...(task.householdId ? { matterId: task.householdId } : {}),
          }
        : { kind: 'firmDoc', id: 'firm_home' },
      ...(task?.householdId ? { householdId: task.householdId } : {}),
      payload: task ? { taskId: task.id, status: task.status } : {},
      important: false,
      meetingVisibility: parent
        ? derivedMeetingVisibility('activity', id, parent)
        : explicitLegacyMeetingVisibility('activity', id),
    });
  };
  const saveTask = async (task: CrmTask, visibilityParent?: LiveCrmRecord) => {
    const householdId = task.householdId ?? task.contextRefs?.[0];
    const householdMatterId = households.find(
      (household) => household.id === householdId
    )?.matterId;
    const previous = liveTasks.find((item) => item.id === task.id);
    const current = live.records.find((record) => record.kind === 'task' && record.id === task.id);
    const taskRecord = mergeCrmTaskRecord(
      task,
      current,
      householdMatterId,
      visibilityParent
    );
    await live.save(taskRecord);
    await recordActivity(
      task.status === 'done' && previous?.status !== 'done'
        ? `Completed task: ${task.title}`
        : previous
          ? `Updated task: ${task.title}`
          : `Created task: ${task.title}`,
      { ...task, ...(householdId ? { householdId } : {}) },
      task.status === 'done' && previous?.status !== 'done'
        ? 'task.completed'
        : previous
          ? 'task.updated'
          : 'task.created',
      taskRecord
    );
    if (
      task.status === 'done' &&
      previous?.status !== 'done' &&
      task.recurrence?.regenerateOnComplete
    ) {
      const dueAt = nextRecurringDue(task.dueAt, task.recurrence);
      const child: CrmTask = {
        ...task,
        id: `task-${crypto.randomUUID()}`,
        status: 'open',
        ...(dueAt ? { dueAt, dueLabel: dueAt } : {}),
      };
      const childRecord = mergeCrmTaskRecord(
        child,
        undefined,
        householdMatterId,
        taskRecord
      );
      await live.save(childRecord);
      await recordActivity(
        `Created next recurring task: ${child.title}`,
        child,
        'task.created',
        childRecord
      );
    }
  };
  const completeWorkflowWorkItem = async (item: CrmWorkflowWorkItem) => {
    const instance = visibleWorkflowInstances.find(
      (candidate) => candidate.id === item.instanceId
    );
    if (!instance)
      throw new Error('That workflow step is no longer available.');
    await live.save(applyWorkflowStepCompletion(instance, item.stepId));
    const now = new Date().toISOString();
    const activityId = `activity-${crypto.randomUUID()}`;
    await live.save({
      id: activityId,
      kind: 'activityEvent',
      matterId: 'firm_home',
      at: now,
      summary: `Completed workflow step: ${item.title}`,
      actor: { ...(viewerId ? { userId: viewerId } : {}), displayName: 'You' },
      verb: 'workflow.step.done',
      targetRef: {
        kind: 'workflowInstance',
        id: item.instanceId,
        matterId: item.householdId,
      },
      householdId: item.householdId,
      payload: { stepId: item.stepId },
      important: false,
      ...(instance.meetingVisibility
        ? {
            meetingVisibility: derivedMeetingVisibility(
              'activity',
              activityId,
              instance.meetingVisibility
            ),
          }
        : {}),
    });
  };
  const liveAdapter: CrmHomeAdapter = {
    ...emptyEngineAdapter(freshness),
    tasks: liveTasks,
    households,
    firmMembers,
    workflowWorkItems: liveWorkflowWorkItems,
    approvals: liveApprovals,
    activity: liveActivity,
    savedTaskViews,
    migration: {
      noteGaps: liveNoteGaps,
      workflowChecklists: liveWorkflowChecklists,
      attachmentAccounting: liveAttachmentAccounting,
      exports: liveExports,
      ...(liveReport ? { report: liveReport } : {}),
    },
    actions: {
      updateTask: saveTask,
      completeWorkflowWorkItem,
      recordWorkflowChecklist: async (record) => {
        if (record.decision !== 'recreate') {
          await live.save({
            ...record,
            kind: 'migration_workflow_checklist',
            matterId: 'firm',
          });
          return;
        }
        const household =
          (record.householdId
            ? households.find((item) => item.id === record.householdId)
            : undefined) ??
          households.find((item) => item.name === record.clientLabel);
        if (!household)
          throw new Error(
            'Choose the client for this imported workflow before creating it.'
          );
        if (
          !record.selectedCurrentStep ||
          !record.availableSteps.includes(record.selectedCurrentStep)
        )
          throw new Error(
            'Choose the workflow’s current step before creating it.'
          );
        let template = workflowRecords(live.records).templates.find(
          (item) => item.name === record.sourceTemplateLabel
        );
        let templateNeedsSave = false;
        if (!template) {
          if (!record.availableSteps.length)
            throw new Error(
              'This imported workflow has no readable steps. Record it as a trace gap instead.'
            );
          template = createTemplate(
            record.sourceTemplateLabel,
            record.availableSteps
          );
          templateNeedsSave = true;
        }
        let instance = startWorkflow(template, {
          id: household.id,
          matterId: household.matterId,
          label: household.name,
        });
        const currentStepIndex = template.steps.findIndex(
          (step) => step.title === record.selectedCurrentStep
        );
        for (const step of template.steps.slice(
          0,
          Math.max(0, currentStepIndex)
        ))
          instance = applyWorkflowStepCompletion(instance, step.id);
        // Run every completion preflight before persisting any part of this
        // recreation. A refusal must not leave a template without its matching
        // workflow instance and checklist record.
        if (templateNeedsSave) await live.save(template);
        await live.save(instance);
        await live.save({
          ...record,
          householdId: household.id,
          kind: 'migration_workflow_checklist',
          matterId: 'firm',
          resultingInstanceLabel: instance.name,
          resultingWorkflowInstanceRef: instance.id,
        });
      },
      recordAttachmentAccounting: async (record) => {
        await live.save({
          ...record,
          kind: 'migration_attachment_accounting',
          matterId: 'firm',
        });
      },
      createExport: (kind) => {
        void createMigrationExport(live.workspaceRoot, kind).then(() =>
          live.reload()
        );
      },
      retryExport: (kind) => {
        void createMigrationExport(live.workspaceRoot, kind).then(() =>
          live.reload()
        );
      },
      runMigrationImport: async (baseUrl) => {
        await runWealthboxMigration(live.workspaceRoot, baseUrl);
        await live.reload();
      },
      saveTaskView: async (view) => {
        await live.save({
          id: view.id,
          kind: 'savedView',
          matterId: 'firm_home',
          name: view.name,
          surface: 'tasks',
          layout: view.layout,
          query: {
            entity: 'task',
            filters: [],
            ...(view.search ? { search: view.search } : {}),
          },
          visibility: 'personal',
        });
        await recordActivity(`Saved task view: ${view.name}`);
      },
      decideApproval: async (approval, decision) => {
        const record = live.records.find(
          (item) =>
            item.id === approval.id &&
            item.kind === 'proposalRecord' &&
            live.canReadMeetingDerivedRecord(item, 'proposal')
        );
        if (!record) throw new Error('This approval is no longer available.');
        const decidedAt = new Date().toISOString();
        let appliedEntityRef:
          | { kind: 'workflowInstance'; id: string; matterId: string }
          | undefined;
        if (
          decision === 'approved' &&
          record['proposalKind'] === 'workflow_launch'
        ) {
          const proposed = record['proposedMutation'] as
            | { workflowTemplateId?: unknown }
            | undefined;
          const templateId =
            typeof proposed?.workflowTemplateId === 'string'
              ? proposed.workflowTemplateId
              : undefined;
          const householdId = householdIdFor(record);
          const template = templateId
            ? workflowRecords(live.records).templates.find(
                (item) => item.id === templateId
              )
            : undefined;
          const household = householdId
            ? workflowHouseholds.find((item) => item.id === householdId)
            : undefined;
          if (!template || !household)
            throw new Error(
              'This proposed workflow no longer has a template and household to start.'
            );
          const visibilityParent = meetingVisibilityParentForRecord(record);
          if (!visibilityParent)
            throw new Error(
              'This proposal is missing its private-note lineage. No workflow was started.'
            );
          const instance = startWorkflow(template, household, {
            visibilityParent,
          });
          await live.save(instance);
          appliedEntityRef = {
            kind: 'workflowInstance',
            id: instance.id,
            matterId: household.matterId,
          };
        }
        await live.save({
          ...record,
          state: decision,
          decidedAt,
          decidedBy: {
            ...(viewerId ? { userId: viewerId } : {}),
            displayName: 'You',
          },
          ...(appliedEntityRef ? { appliedEntityRef } : {}),
        });
        if (
          decision === 'approved' &&
          record['proposalKind'] === 'task_create'
        ) {
          const proposed = record['proposedMutation'] as
            | { task?: Partial<CrmTask> }
            | undefined;
          const proposalTask = proposed?.task;
          if (proposalTask?.title)
            await saveTask({
              id: `task-${record.id}`,
              title: proposalTask.title,
              body: '',
              assigneeUserId: proposalTask.assigneeUserId ?? null,
              status: 'open',
              priority: proposalTask.priority ?? 'normal',
              tagIds: proposalTask.tagIds ?? [],
              ...(proposalTask.householdId
                ? { householdId: proposalTask.householdId }
                : householdIdFor(record)
                  ? { householdId: householdIdFor(record) }
                  : {}),
              ...(proposalTask.dueAt ? { dueAt: proposalTask.dueAt } : {}),
              contextRefs: proposalTask.contextRefs ?? [],
            }, record);
        }
        await recordActivity(
          `${decision === 'approved' ? 'Approved' : 'Dismissed'} proposal: ${approval.title}`,
          undefined,
          'proposal.decided',
          record
        );
      },
    },
  };
  const activeAdapter = adapter ?? (preview ? PREVIEW_ADAPTER : liveAdapter);
  const { records: liveRecords, save: saveLiveRecord } = live;
  const workflowHouseholds = workflowHouseholdsFor(liveRecords);
  // Scheduling is client-computed from encrypted records. It runs whenever the
  // CRM home is open, not only while a person is looking at the Workflows tab.
  useEffect(() => {
    if (adapter || preview) return;
    const abortController = new AbortController();
    const shouldStop = () => abortController.signal.aborted;
    void (async () => {
      for (const template of workflowRecords(liveRecords).templates) {
        if (shouldStop()) return;
        const scheduled = startScheduledWorkflows(template, workflowHouseholdsFor(liveRecords));
        if (!scheduled.instances.length) continue;
        for (const instance of scheduled.instances) {
          if (shouldStop()) return;
          await saveLiveRecord(instance);
        }
        if (shouldStop()) return;
        await saveLiveRecord(scheduled.template);
      }
    })();
    return () => {
      abortController.abort();
    };
  }, [adapter, liveRecords, preview, saveLiveRecord]);
  const liveWorkflowProps =
    adapter || preview
      ? {}
      : {
          workflowData: visibleWorkflowData,
          workflowHouseholds,
          saveLiveRecord: live.save,
        };
  const runtime: LiveCrmHomeRuntime = {
    adapter: activeAdapter,
    adapterProvided: Boolean(adapter || preview),
    ...liveWorkflowProps,
    ...(initialRoute ? { initialRoute } : {}),
    ...(showRail === undefined ? {} : { showRail }),
    ...(addRequest ? { addRequest } : {}),
    ...(onAddRequestConsumed ? { onAddRequestConsumed } : {}),
  };
  if (render) return <>{render(runtime)}</>;
  return (
    <CrmHomeShell
      adapter={activeAdapter}
      preview={preview}
      adapterProvided={Boolean(adapter || preview)}
      {...liveWorkflowProps}
      {...(initialRoute ? { initialRoute } : {})}
      {...(showRail === undefined ? {} : { showRail })}
      {...(addRequest ? { addRequest } : {})}
      {...(onAddRequestConsumed ? { onAddRequestConsumed } : {})}
    />
  );
}
