/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useEffect, useState } from 'react';
import { getCrmEngineFreshness, subscribeCrmEngineFreshness } from '@/platform/crm/store';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { nextRecurringDue } from '@/platform/crm/tasks';
import { createMigrationExport, runWealthboxMigration } from '@/platform/crm/migration';
import { completeWorkflowStep, createTemplate, startScheduledWorkflows, startWorkflow, stepValue, workflowRecords } from '../workflowLive';
import { CrmHomeShell } from '../CrmHome';
import type { HouseholdChoice } from '@/features/crm-workflows/Workflows';
import { liveStepTitle } from './workflowDisplay';
import type { CrmHomeProps } from '../routes';
import type { CrmActivity, CrmApproval, CrmFirmMember, CrmFreshnessState, CrmHomeAdapter, CrmTask, CrmTaskSavedView, CrmWorkflowWorkItem, AttachmentAccountingRecord, ExportJobStatus, MigrationFidelityReport, MigrationNoteGap, MigrationWorkflowChecklist, PropagationOffer } from '../types';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

function workflowHouseholdsFor(records: readonly LiveCrmRecord[]): HouseholdChoice[] {
  return records
    .filter((record) => record.kind === 'household')
    .map((record) => ({
      id: record.id,
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
  freshness: { kind: 'offline' },
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
  addRequest,
  onAddRequestConsumed,
}: CrmHomeProps) {
  const [freshness, setFreshness] = useState<CrmFreshnessState>(
    getCrmEngineFreshness()
  );
  const live = useLiveCrmRecords();
  useEffect(() => subscribeCrmEngineFreshness(setFreshness), []);
  const households = live.records
    .filter(
      (record) =>
        record.kind === 'household' && typeof record['name'] === 'string'
    )
    .map((record) => ({ id: record.id, name: record['name'] as string }));
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
    .filter((record) => record.kind === 'task')
    .map((record) => {
      const householdId = householdIdFor(record);
      const recurrence = record['recurrence'];
      const recurrenceFrequencyValue = (recurrence as { freq?: unknown } | null)
        ?.freq;
      const recurrenceFrequency =
        typeof recurrenceFrequencyValue === 'string'
          ? recurrenceFrequencyValue
          : '';
      const validRecurrence =
        recurrence &&
        typeof recurrence === 'object' &&
        ['daily', 'weekly', 'monthly', 'yearly'].includes(recurrenceFrequency)
          ? {
              freq: recurrenceFrequency as NonNullable<
                CrmTask['recurrence']
              >['freq'],
              interval: Math.max(
                1,
                Number((recurrence as { interval?: unknown }).interval) || 1
              ),
              regenerateOnComplete:
                (recurrence as { regenerateOnComplete?: unknown })
                  .regenerateOnComplete !== false,
            }
          : undefined;
      return {
        id: record.id,
        title:
          typeof record['title'] === 'string'
            ? record['title']
            : 'Untitled task',
        ...(typeof record['body'] === 'string' ? { body: record['body'] } : {}),
        assigneeUserId:
          typeof record['assigneeUserId'] === 'string'
            ? record['assigneeUserId']
            : null,
        ...(firmMembers.find(
          (member) => member.userId === record['assigneeUserId']
        )
          ? {
              assigneeLabel: firmMembers.find(
                (member) => member.userId === record['assigneeUserId']
              )?.displayName,
            }
          : {}),
        status:
          record['status'] === 'in_progress' ||
          record['status'] === 'blocked' ||
          record['status'] === 'done' ||
          record['status'] === 'cancelled'
            ? record['status']
            : 'open',
        priority:
          record['priority'] === 'high' || record['priority'] === 'low'
            ? record['priority']
            : 'normal',
        ...(householdId
          ? { householdId, householdLabel: householdName(householdId) }
          : {}),
        ...(typeof record['due'] === 'string'
          ? { dueAt: record['due'], dueLabel: record['due'] }
          : typeof record['dueAt'] === 'string'
            ? { dueAt: record['dueAt'], dueLabel: record['dueAt'] }
            : {}),
        ...(validRecurrence
          ? { recurrence: validRecurrence, recurrenceLabel: 'Recurring' }
          : {}),
        contextRefs: contextIds(record),
      };
    });
  const liveWorkflowWorkItems: readonly CrmWorkflowWorkItem[] = workflowRecords(
    live.records
  ).instances.flatMap((instance) =>
    Object.values(instance.snapshot.steps)
      .filter((step) => !step.hiddenByTemplateRemoval && step.status !== 'done')
      .map((step) => {
        const assigneeUserId = step.assigneeUserId ?? null;
        const member = firmMembers.find(
          (candidate) => candidate.userId === assigneeUserId
        );
        const dueValue = stepValue(instance, step.stepId, 'dueOffset');
        const offset = typeof dueValue === 'number' ? dueValue : undefined;
        const started = new Date(
          instance['createdAt'] ?? new Date().toISOString()
        );
        if (offset !== undefined)
          started.setUTCDate(started.getUTCDate() + offset);
        return {
          id: `${instance.id}:${step.stepId}`,
          instanceId: instance.id,
          stepId: step.stepId,
          title: liveStepTitle(instance, step.stepId),
          householdId: instance.householdId,
          householdLabel: instance.householdLabel,
          assigneeUserId,
          ...(member ? { assigneeLabel: member.displayName } : {}),
          status: step.status === 'in_progress' ? 'in_progress' : 'open',
          priority: 'normal' as const,
          ...(offset !== undefined
            ? { dueAt: started.toISOString().slice(0, 10) }
            : {}),
        };
      })
  );
  const liveApprovals: readonly CrmApproval[] = live.records
    .filter((record) => record.kind === 'proposalRecord')
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
        record.kind === 'activityEvent' && typeof record['at'] === 'string'
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
    verb = 'task.updated'
  ) => {
    const now = new Date().toISOString();
    await live.save({
      id: `activity-${crypto.randomUUID()}`,
      kind: 'activityEvent',
      matterId: 'firm_home',
      at: now,
      summary,
      actor: { userId: 'local-user', displayName: 'You' },
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
    });
  };
  const saveTask = async (task: CrmTask) => {
    const householdId = task.householdId ?? task.contextRefs?.[0];
    const previous = liveTasks.find((item) => item.id === task.id);
    const householdRef = householdId
      ? { kind: 'household', id: householdId, matterId: householdId }
      : null;
    await live.save({
      id: task.id,
      kind: 'task',
      matterId: 'firm_home',
      title: task.title.trim(),
      body: task.body ?? '',
      assigneeUserId: task.assigneeUserId,
      status: task.status,
      ...(task.dueAt ? { due: task.dueAt } : {}),
      priority: task.priority,
      ...(task.recurrence ? { recurrence: task.recurrence } : {}),
      householdRef,
      contextRefs: householdRef ? [householdRef] : [],
      customFields: {},
    });
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
          : 'task.created'
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
      await live.save({
        id: child.id,
        kind: 'task',
        matterId: 'firm_home',
        title: child.title,
        body: child.body ?? '',
        assigneeUserId: child.assigneeUserId,
        status: 'open',
        ...(dueAt ? { due: dueAt } : {}),
        priority: child.priority,
        recurrence: child.recurrence,
        householdRef,
        contextRefs: householdRef ? [householdRef] : [],
        customFields: {},
      });
      await recordActivity(
        `Created next recurring task: ${child.title}`,
        child
      );
    }
  };
  const completeWorkflowWorkItem = async (item: CrmWorkflowWorkItem) => {
    const instance = workflowRecords(live.records).instances.find(
      (candidate) => candidate.id === item.instanceId
    );
    if (!instance)
      throw new Error('That workflow step is no longer available.');
    await live.save(completeWorkflowStep(instance, item.stepId));
    const now = new Date().toISOString();
    await live.save({
      id: `activity-${crypto.randomUUID()}`,
      kind: 'activityEvent',
      matterId: 'firm_home',
      at: now,
      summary: `Completed workflow step: ${item.title}`,
      actor: { userId: 'local-user', displayName: 'You' },
      verb: 'workflow.step.done',
      targetRef: {
        kind: 'workflowInstance',
        id: item.instanceId,
        matterId: item.householdId,
      },
      householdId: item.householdId,
      payload: { stepId: item.stepId },
      important: false,
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
        if (!template) {
          if (!record.availableSteps.length)
            throw new Error(
              'This imported workflow has no readable steps. Record it as a trace gap instead.'
            );
          template = createTemplate(
            record.sourceTemplateLabel,
            record.availableSteps
          );
          await live.save(template);
        }
        let instance = startWorkflow(template, {
          id: household.id,
          label: household.name,
        });
        const currentStepIndex = template.steps.findIndex(
          (step) => step.title === record.selectedCurrentStep
        );
        for (const step of template.steps.slice(
          0,
          Math.max(0, currentStepIndex)
        ))
          instance = completeWorkflowStep(instance, step.id);
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
          (item) => item.id === approval.id && item.kind === 'proposalRecord'
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
          const instance = startWorkflow(template, household);
          await live.save(instance);
          appliedEntityRef = {
            kind: 'workflowInstance',
            id: instance.id,
            matterId: household.id,
          };
        }
        await live.save({
          ...record,
          state: decision,
          decidedAt,
          decidedBy: { userId: 'local-user', displayName: 'You' },
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
              ...(proposalTask.householdId
                ? { householdId: proposalTask.householdId }
                : householdIdFor(record)
                  ? { householdId: householdIdFor(record) }
                  : {}),
              ...(proposalTask.dueAt ? { dueAt: proposalTask.dueAt } : {}),
              contextRefs: proposalTask.contextRefs ?? [],
            });
        }
        await recordActivity(
          `${decision === 'approved' ? 'Approved' : 'Dismissed'} proposal: ${approval.title}`
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
          workflowData: workflowRecords(live.records),
          workflowHouseholds,
          saveLiveRecord: live.save,
        };
  return (
    <CrmHomeShell
      adapter={activeAdapter}
      preview={preview}
      adapterProvided={Boolean(adapter || preview)}
      {...liveWorkflowProps}
      {...(initialRoute ? { initialRoute } : {})}
      {...(addRequest ? { addRequest } : {})}
      {...(onAddRequestConsumed ? { onAddRequestConsumed } : {})}
    />
  );
}
