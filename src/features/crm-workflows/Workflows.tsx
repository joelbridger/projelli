/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useEffect, useRef, useState } from 'react';
import { Plus, Workflow } from 'lucide-react';
import { Button } from '@/ui/kp';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { STARTER_WORKFLOWS } from '@/features/crm-workflows-library';
import {
  FreshnessBanner,
  Screen,
  mutedStyle,
  panelStyle,
} from '@/features/crm-home/shared/ui';
import type {
  CrmHomeRoute,
  CrmHouseholdAddRequest,
} from '@/features/crm-home/routes';
import {
  addWorkflowStepNote,
  applyWorkflowStepCompletion,
  createMeetingWorkflowProposal,
  createTemplate,
  offerForInstance,
  publishTemplateUpdate,
  renameWorkflowStepLocally,
  startWorkflow,
  updateWorkflowTemplate,
  workflowRecords,
  type LiveWorkflowInstance,
  type WorkflowScheduleDraft,
  type WorkflowStepOutcomeDraft,
  WorkflowCompletionRefusedError,
} from '@/features/crm-home/workflowLive';
import type {
  CrmFreshnessState,
  CrmWorkflowWorkItem,
} from '@/features/crm-home/types';
import { useCrmHomeSurfaceContext } from '@/features/crm-home/surfaceContext';
import { liveStepTitle } from '@/features/crm-home/shared/workflowDisplay';
import {
  mountWorkflowRules,
  mountWorkflowStepExtensions,
} from './workflowExtensionRegistry';
import { saveWorkflowStepMetadata } from './workflowStepPersistence';
import { WorkflowRecordStartSlot } from './authoring/WorkflowRecordStartSlot';

export function Workflows({
  freshness,
  onNavigate,
}: {
  freshness: CrmFreshnessState;
  onNavigate: (route: CrmHomeRoute) => void;
}) {
  return (
    <Screen
      title="Workflows"
      description="Steps your firm follows for each household"
      Icon={Workflow}
      action={undefined}
    >
      <FreshnessBanner freshness={freshness} />
      <section style={panelStyle}>
        <strong>No workflow records are connected to this view.</strong>
        <p style={mutedStyle}>
          Open the live CRM workspace to create a workflow and review its
          household updates. Lantern will not show made-up workflow counts here.
        </p>
        <Button
          variant="secondary"
          data-testid="crm-workflow-review"
          onClick={() => {
            onNavigate('propagation');
          }}
        >
          Review workflow updates
        </Button>
      </section>
    </Screen>
  );
}

export function WorkflowsSurface() {
  const {
    adapter,
    navigate,
    workflowOpenItem,
    workflowData,
    workflowHouseholds,
    saveLiveRecord,
    addRequest,
    onAddRequestConsumed,
  } = useCrmHomeSurfaceContext();
  return workflowData && workflowHouseholds && saveLiveRecord ? (
    <LiveWorkflows
      data={workflowData}
      households={workflowHouseholds}
      onSave={saveLiveRecord}
      onNavigate={navigate}
      {...(workflowOpenItem ? { openWorkItem: workflowOpenItem } : {})}
      {...(addRequest ? { addRequest } : {})}
      {...(onAddRequestConsumed ? { onAddRequestConsumed } : {})}
    />
  ) : (
    <Workflows freshness={adapter.freshness} onNavigate={navigate} />
  );
}

export type LiveWorkflowData = ReturnType<typeof workflowRecords>;
export type HouseholdChoice = { id: string; label: string; matterId: string };

function isStartableTemplate(
  template: LiveWorkflowData['templates'][number] | undefined
): template is LiveWorkflowData['templates'][number] {
  // Templates saved before lifecycle statuses existed were already startable.
  return (
    template !== undefined &&
    (template.status === undefined || template.status === 'published')
  );
}

export function LiveWorkflows({
  data,
  households,
  onSave,
  onNavigate,
  openWorkItem,
  addRequest,
  onAddRequestConsumed,
}: {
  data: LiveWorkflowData;
  households: readonly HouseholdChoice[];
  onSave: (record: LiveCrmRecord) => Promise<unknown>;
  onNavigate: (route: CrmHomeRoute) => void;
  openWorkItem?: Pick<CrmWorkflowWorkItem, 'instanceId' | 'stepId'>;
  addRequest?: CrmHouseholdAddRequest;
  onAddRequestConsumed?: () => void;
}) {
  const selectedInstance = openWorkItem
    ? data.instances.find((instance) => instance.id === openWorkItem.instanceId)
    : undefined;
  const template = selectedInstance
    ? data.templates.find(
        (candidate) => candidate.id === selectedInstance.templateId
      )
    : data.templates[0];
  const startableTemplate = data.templates.find(isStartableTemplate);
  const startUnavailableMessage = template
    ? 'Publish this workflow template before starting it.'
    : 'Create a workflow template before starting a workflow.';
  const [creating, setCreating] = useState(
    addRequest?.kind === 'workflow' && !template
  );
  const [name, setName] = useState('');
  const [titles, setTitles] = useState(['', '', '']);
  const [newHousehold, setNewHousehold] = useState('');
  const [selectedHouseholdId, setSelectedHouseholdId] = useState(
    addRequest?.kind === 'workflow' ? addRequest.householdId : ''
  );
  const [editing, setEditing] = useState(false);
  const [changedTitle, setChangedTitle] = useState('');
  const [addedTitle, setAddedTitle] = useState('Send welcome summary');
  const [schedule, setSchedule] = useState<WorkflowScheduleDraft>({
    frequency: 'annual',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    startsAt: new Date().toISOString().slice(0, 10),
    householdIds: [],
    enabled: false,
  });
  const [outcomes, setOutcomes] = useState<
    Record<string, WorkflowStepOutcomeDraft[]>
  >({});
  const [meetingId, setMeetingId] = useState('');
  const [meetingHouseholdId, setMeetingHouseholdId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const instances = template
    ? data.instances.filter((instance) => instance.templateId === template.id)
    : [];
  const save = async (record: LiveCrmRecord | (() => LiveCrmRecord)) => {
    try {
      setError(null);
      await onSave(typeof record === 'function' ? record() : record);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const saveForStepExtension = async (record: LiveCrmRecord) => {
    try {
      setError(null);
      return await onSave(record);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    }
  };
  const chooseStarter = (starter: (typeof STARTER_WORKFLOWS)[number]) => {
    setName(starter.name);
    setTitles([...starter.steps]);
    setCreating(true);
  };
  const create = async () => {
    await save(createTemplate(name, titles));
    setCreating(false);
  };
  const start = async () => {
    const currentStartableTemplate = data.templates.find(isStartableTemplate);
    if (!currentStartableTemplate) return;
    let household = households.find((item) => item.id === selectedHouseholdId);
    if (!household) {
      const id = `household-${String(Date.now())}`;
      household = {
        id,
        matterId: id,
        label: newHousehold.trim() || 'New household',
      };
      await save({
        id,
        kind: 'household',
        matterId: id,
        name: household.label,
      });
    }
    await save(startWorkflow(currentStartableTemplate, household));
    onAddRequestConsumed?.();
  };
  const publish = async () => {
    if (!template) return;
    try {
      setError(null);
      const update = publishTemplateUpdate(template, changedTitle, addedTitle);
      await onSave(
        updateWorkflowTemplate(update.template, { schedule, outcomes })
      );
      for (const instance of instances)
        await onSave(
          offerForInstance(
            update.template,
            instance,
            update.revisionId,
            update.label
          )
        );
      setEditing(false);
      onNavigate('propagation');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const saveSettings = async () => {
    if (!template) return;
    await save(updateWorkflowTemplate(template, { schedule, outcomes }));
    setEditing(false);
  };
  const addOutcome = (stepId: string) => {
    setOutcomes((current) => ({
      ...current,
      [stepId]: [
        ...(current[stepId] ?? []),
        { id: `outcome-${stepId}-${String(Date.now())}`, label: '' },
      ],
    }));
  };
  const editOutcome = (
    stepId: string,
    outcomeId: string,
    change: Partial<WorkflowStepOutcomeDraft>
  ) => {
    setOutcomes((current) => ({
      ...current,
      [stepId]: (current[stepId] ?? []).map((outcome) =>
        outcome.id === outcomeId ? { ...outcome, ...change } : outcome
      ),
    }));
  };
  return (
    <Screen
      title="Workflows"
      description="Steps your firm follows for each household"
      Icon={Workflow}
      action={
        <Button
          data-testid="crm-live-workflow-new-template"
          iconLeft={Plus}
          onClick={() => {
            setCreating(true);
          }}
        >
          New template
        </Button>
      }
    >
      {error && (
        <div
          role="alert"
          style={{ ...panelStyle, borderColor: 'var(--kp-danger)' }}
        >
          {error}
        </div>
      )}
      <WorkflowRecordStartSlot
        {...(addRequest ? { addRequest } : {})}
        households={households}
        {...(onAddRequestConsumed ? { onAddRequestConsumed } : {})}
        {...(template ? { templateId: template.id } : {})}
      />
      {!template && !creating && (
        <>
          <section style={panelStyle}>
            <strong>No workflow templates yet</strong>
            <p style={mutedStyle}>
              Create your own set of steps, or start from a common firm
              workflow. Nothing is added until you choose one.
            </p>
            <Button
              data-testid="crm-live-workflow-create-first"
              onClick={() => {
                setCreating(true);
              }}
            >
              Create a workflow
            </Button>
          </section>
          <section data-testid="crm-live-workflow-library" style={panelStyle}>
            <strong>Starter workflow library</strong>
            <p style={mutedStyle}>
              These are editable starting points, not records in your firm.
            </p>
            {STARTER_WORKFLOWS.map((starter) => (
              <div
                key={starter.id}
                {...(starter.id === 'annual-review'
                  ? { 'data-testid': 'crm-approved-playbook-fixture' }
                  : {})}
                style={{
                  borderTop: '1px solid var(--kp-border)',
                  marginTop: 8,
                  paddingTop: 8,
                }}
              >
                <strong>{starter.name}</strong>
                <p style={mutedStyle}>{starter.description}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid={`crm-starter-workflow-${starter.id}`}
                  onClick={() => {
                    chooseStarter(starter);
                  }}
                >
                  Use this template
                </Button>
              </div>
            ))}
          </section>
        </>
      )}
      {creating && (
        <section
          data-testid="crm-live-workflow-template-form"
          style={panelStyle}
        >
          <strong>Create a workflow template</strong>
          <p style={mutedStyle}>
            Start with the steps your firm follows. You can adjust them before
            publishing later.
          </p>
          <label>
            Template name
            <input
              data-testid="crm-live-workflow-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          {titles.map((title, index) => (
            <label key={index} style={{ display: 'block', marginTop: 8 }}>
              Step {String(index + 1)}
              <input
                data-testid={`crm-live-workflow-step-title-${String(index + 1)}`}
                value={title}
                onChange={(event) => {
                  setTitles((current) =>
                    current.map((item, position) =>
                      position === index ? event.target.value : item
                    )
                  );
                }}
              />
            </label>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Button
              data-testid="crm-live-workflow-create-template"
              onClick={() => {
                void create();
              }}
            >
              Save template
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setCreating(false);
                onAddRequestConsumed?.();
              }}
            >
              Cancel
            </Button>
          </div>
        </section>
      )}
      {template && (
        <>
          <section data-testid="crm-live-workflow-template" style={panelStyle}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <strong>{template.name}</strong>
                <p style={mutedStyle}>
                  {
                    instances.filter((item) => item.status !== 'completed')
                      .length
                  }{' '}
                  open household workflow{instances.length === 1 ? '' : 's'}
                </p>
              </div>
              <span style={{ display: 'flex', gap: 8 }}>
                <Button
                  variant="secondary"
                  data-testid="crm-live-workflow-open-propagation"
                  onClick={() => {
                    onNavigate('propagation');
                  }}
                >
                  Review updates
                </Button>
                <Button
                  variant="secondary"
                  data-testid="crm-live-workflow-edit-template"
                  onClick={() => {
                    setChangedTitle(
                      (template.steps[1] ?? template.steps[0])?.title ?? ''
                    );
                    setSchedule(template.schedule ?? schedule);
                    setOutcomes(
                      Object.fromEntries(
                        template.steps.map((step) => [step.id, step.outcomes])
                      )
                    );
                    setEditing(true);
                  }}
                >
                  Edit template
                </Button>
              </span>
            </div>
            <ol>
              {template.steps.map((step) => (
                <li key={step.id}>
                  {step.title} · {step.role} ·{' '}
                  {step.dueOffset === 0
                    ? 'start day'
                    : `day ${String(step.dueOffset + 1)}`}{' '}
                  · {step.required ? 'required' : 'optional'}
                  {step.outcomes.length
                    ? ` · ${String(step.outcomes.length)} outcome${step.outcomes.length === 1 ? '' : 's'}`
                    : ''}
                </li>
              ))}
            </ol>
            {editing && (
              <div
                data-testid="crm-live-workflow-update-form"
                style={{ ...panelStyle, background: 'var(--color-background)' }}
              >
                <strong>Update this template</strong>
                <p style={mutedStyle}>
                  Template step changes ask before they touch open household
                  work. Schedule and outcome choices guide new work from this
                  point on.
                </p>
                <label>
                  Rename “{(template.steps[1] ?? template.steps[0])?.title}”
                  <input
                    data-testid="crm-live-workflow-change-title"
                    value={changedTitle}
                    onChange={(event) => {
                      setChangedTitle(event.target.value);
                    }}
                  />
                </label>
                <label style={{ display: 'block', marginTop: 8 }}>
                  Add a step
                  <input
                    data-testid="crm-live-workflow-add-title"
                    value={addedTitle}
                    onChange={(event) => {
                      setAddedTitle(event.target.value);
                    }}
                  />
                </label>
                {mountWorkflowRules({
                  template,
                  compatibilityMount: (
                    <>
                      <section
                        data-testid="crm-live-workflow-schedule"
                        style={{
                          borderTop: '1px solid var(--kp-border)',
                          marginTop: 12,
                          paddingTop: 12,
                        }}
                      >
                        <strong>Scheduled workflow</strong>
                        <p style={mutedStyle}>
                          When this time arrives, this app creates a workflow
                          for the selected households. It never sends anything
                          outside Lantern.
                        </p>
                        <label>
                          <input
                            data-testid="crm-live-workflow-schedule-enabled"
                            type="checkbox"
                            checked={schedule.enabled}
                            onChange={(event) => {
                              setSchedule((current) => ({
                                ...current,
                                enabled: event.target.checked,
                              }));
                            }}
                          />{' '}
                          Start on a schedule
                        </label>
                        <label style={{ display: 'block', marginTop: 8 }}>
                          Repeat
                          <select
                            data-testid="crm-live-workflow-schedule-frequency"
                            value={schedule.frequency}
                            onChange={(event) => {
                              setSchedule((current) => ({
                                ...current,
                                frequency: event.target
                                  .value as WorkflowScheduleDraft['frequency'],
                              }));
                            }}
                          >
                            {[
                              'daily',
                              'weekly',
                              'monthly',
                              'quarterly',
                              'annual',
                            ].map((frequency) => (
                              <option key={frequency} value={frequency}>
                                {frequency}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label style={{ display: 'block', marginTop: 8 }}>
                          First run
                          <input
                            data-testid="crm-live-workflow-schedule-starts-at"
                            type="date"
                            value={schedule.startsAt.slice(0, 10)}
                            onChange={(event) => {
                              setSchedule((current) => ({
                                ...current,
                                startsAt: event.target.value,
                              }));
                            }}
                          />
                        </label>
                        <label style={{ display: 'block', marginTop: 8 }}>
                          Households
                          <select
                            data-testid="crm-live-workflow-schedule-households"
                            multiple
                            value={schedule.householdIds}
                            onChange={(event) => {
                              setSchedule((current) => ({
                                ...current,
                                householdIds: Array.from(
                                  event.currentTarget.selectedOptions,
                                  (option) => option.value
                                ),
                              }));
                            }}
                          >
                            {households.map((household) => (
                              <option key={household.id} value={household.id}>
                                {household.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </section>
                      <section
                        data-testid="crm-live-workflow-outcome-add"
                        style={{
                          borderTop: '1px solid var(--kp-border)',
                          marginTop: 12,
                          paddingTop: 12,
                        }}
                      >
                        <strong>Step outcomes and branching</strong>
                        <p style={mutedStyle}>
                          A completed step can move work to another step,
                          restart work at a step, or finish this workflow.
                        </p>
                        {template.steps.map((step) => (
                          <div key={step.id} style={{ marginTop: 8 }}>
                            <strong>{step.title}</strong>
                            {(outcomes[step.id] ?? []).map((outcome) => (
                              <div
                                key={outcome.id}
                                style={{
                                  display: 'flex',
                                  gap: 6,
                                  marginTop: 6,
                                  flexWrap: 'wrap',
                                }}
                              >
                                <input
                                  data-testid={`crm-live-workflow-outcome-label-${outcome.id}`}
                                  aria-label={`Outcome label for ${step.title}`}
                                  value={outcome.label}
                                  placeholder="Outcome, such as Approved"
                                  onChange={(event) => {
                                    editOutcome(step.id, outcome.id, {
                                      label: event.target.value,
                                    });
                                  }}
                                />
                                <select
                                  data-testid={`crm-live-workflow-outcome-action-${outcome.id}`}
                                  value={
                                    outcome.restartAtStepId
                                      ? `restart:${outcome.restartAtStepId}`
                                      : outcome.nextStepId
                                        ? `next:${outcome.nextStepId}`
                                        : 'complete'
                                  }
                                  onChange={(event) => {
                                    const [kind, target] =
                                      event.target.value.split(':');
                                    editOutcome(
                                      step.id,
                                      outcome.id,
                                      kind === 'next'
                                        ? {
                                            nextStepId: target,
                                            restartAtStepId: undefined,
                                          }
                                        : kind === 'restart'
                                          ? {
                                              restartAtStepId: target,
                                              nextStepId: undefined,
                                            }
                                          : {
                                              nextStepId: undefined,
                                              restartAtStepId: undefined,
                                            }
                                    );
                                  }}
                                >
                                  <option value="complete">
                                    Complete workflow
                                  </option>
                                  {template.steps
                                    .filter(
                                      (candidate) => candidate.id !== step.id
                                    )
                                    .map((candidate) => (
                                      <option
                                        key={`next-${candidate.id}`}
                                        value={`next:${candidate.id}`}
                                      >
                                        Go to {candidate.title}
                                      </option>
                                    ))}
                                  {template.steps.map((candidate) => (
                                    <option
                                      key={`restart-${candidate.id}`}
                                      value={`restart:${candidate.id}`}
                                    >
                                      Restart at {candidate.title}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ))}
                            <Button
                              size="sm"
                              variant="secondary"
                              data-testid={`crm-live-workflow-add-outcome-${step.id}`}
                              style={{ marginTop: 6 }}
                              onClick={() => {
                                addOutcome(step.id);
                              }}
                            >
                              Add outcome
                            </Button>
                          </div>
                        ))}
                      </section>
                    </>
                  ),
                })}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <Button
                    data-testid="crm-live-workflow-publish"
                    onClick={() => {
                      void publish();
                    }}
                  >
                    Publish step update
                  </Button>
                  <Button
                    variant="secondary"
                    data-testid="crm-live-workflow-save-settings"
                    onClick={() => {
                      void saveSettings();
                    }}
                  >
                    Save schedule and outcomes
                  </Button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
      <section style={panelStyle}>
        <strong>Start for a household</strong>
        <p style={mutedStyle}>
          This creates an open workflow for one real household. Nothing is
          shared until you choose to do so.
        </p>
        <p
          id="crm-live-workflow-start-unavailable"
          data-testid="crm-live-workflow-start-unavailable"
          aria-hidden={startableTemplate ? true : undefined}
          style={{
            ...mutedStyle,
            visibility: startableTemplate ? 'hidden' : 'visible',
          }}
        >
          {startUnavailableMessage}
        </p>
        {households.length ? (
          <label>
            Household
            <select
              data-testid="crm-live-workflow-household"
              value={selectedHouseholdId}
              onChange={(event) => {
                setSelectedHouseholdId(event.target.value);
              }}
            >
              <option value="">Choose a household</option>
              {households.map((household) => (
                <option key={household.id} value={household.id}>
                  {household.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Household name
            <input
              data-testid="crm-live-workflow-new-household"
              value={newHousehold}
              onChange={(event) => {
                setNewHousehold(event.target.value);
              }}
            />
          </label>
        )}
        <Button
          data-testid="crm-live-workflow-start"
          style={{ marginLeft: 8 }}
          aria-disabled={!startableTemplate || undefined}
          aria-describedby={
            startableTemplate
              ? undefined
              : 'crm-live-workflow-start-unavailable'
          }
          title={startableTemplate ? undefined : startUnavailableMessage}
          onKeyDown={(event) => {
            if (
              !startableTemplate &&
              (event.key === 'Enter' || event.key === ' ')
            ) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onClick={(event) => {
            if (!startableTemplate) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            void start();
          }}
        >
          Start workflow
        </Button>
      </section>
      {template && (
        <>
          <section data-testid="crm-live-workflow-instances" style={panelStyle}>
            <strong>Household workflows</strong>
            {instances.length === 0 ? (
              <p style={mutedStyle}>
                Start this workflow for a household to see its steps here.
              </p>
            ) : (
              instances.map((instance) => (
                <LiveInstanceCard
                  key={instance.id}
                  instance={instance}
                  onSave={save}
                  onSaveStepMetadata={saveForStepExtension}
                  {...(openWorkItem?.instanceId === instance.id
                    ? { openStepId: openWorkItem.stepId }
                    : {})}
                />
              ))
            )}
          </section>
          <div data-testid="crm-jump-meeting-fixture">
            <section
              data-testid="crm-live-workflow-meeting-proposal"
              style={panelStyle}
            >
              <strong>Propose a workflow from a meeting</strong>
              <p style={mutedStyle}>
                Meeting content can suggest a workflow. It always waits for a
                person to approve before it starts.
              </p>
              {data.meetings.length === 0 ? (
                <p style={mutedStyle}>No meeting activity is available yet.</p>
              ) : (
                <>
                  <label>
                    Meeting
                    <select
                      data-testid="crm-live-meeting-select"
                      value={meetingId}
                      onChange={(event) => {
                        setMeetingId(event.target.value);
                      }}
                    >
                      <option value="">Choose a meeting</option>
                      {data.meetings.map((meeting) => (
                        <option key={meeting.id} value={meeting.id}>
                          {typeof meeting['summary'] === 'string'
                            ? meeting['summary']
                            : 'Untitled meeting'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'block', marginTop: 8 }}>
                    Household
                    <select
                      data-testid="crm-live-meeting-household"
                      value={meetingHouseholdId}
                      onChange={(event) => {
                        setMeetingHouseholdId(event.target.value);
                      }}
                    >
                      <option value="">Choose a household</option>
                      {households.map((household) => (
                        <option key={household.id} value={household.id}>
                          {household.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    data-testid="crm-live-meeting-propose-workflow"
                    style={{ marginTop: 8 }}
                    disabled={!meetingId || !meetingHouseholdId}
                    onClick={() => {
                      const meeting = data.meetings.find(
                        (item) => item.id === meetingId
                      );
                      const household = households.find(
                        (item) => item.id === meetingHouseholdId
                      );
                      if (meeting && household)
                        void save(
                          createMeetingWorkflowProposal(
                            meeting,
                            template,
                            household
                          )
                        );
                    }}
                  >
                    Create proposal for approval
                  </Button>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </Screen>
  );
}

function LiveInstanceCard({
  instance,
  onSave,
  onSaveStepMetadata,
  openStepId,
}: {
  instance: LiveWorkflowInstance;
  onSave: (record: LiveCrmRecord | (() => LiveCrmRecord)) => Promise<unknown>;
  onSaveStepMetadata: (record: LiveCrmRecord) => Promise<unknown>;
  openStepId?: string;
}) {
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [localTitle, setLocalTitle] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [outcomeIds, setOutcomeIds] = useState<Record<string, string>>({});
  const [completionRefusal, setCompletionRefusal] = useState<{
    stepId: string;
    message: string;
  } | null>(null);
  const completionRefusalRef = useRef<HTMLParagraphElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const openedTargetRef = useRef<string | null>(null);
  const steps = Object.values(instance.snapshot.steps).filter(
    (step) => !step.hiddenByTemplateRemoval
  );
  useEffect(() => {
    completionRefusalRef.current?.focus();
  }, [completionRefusal]);
  useEffect(() => {
    if (!openStepId || !instance.snapshot.steps[openStepId]) return;
    const target = `${instance.id}:${openStepId}`;
    if (openedTargetRef.current === target) return;
    openedTargetRef.current = target;
    setEditingStep(openStepId);
    setLocalTitle(liveStepTitle(instance, openStepId));
  }, [instance, openStepId]);
  useEffect(() => {
    if (editingStep === openStepId) editInputRef.current?.focus();
  }, [editingStep, openStepId]);
  return (
    <section
      data-testid={`crm-live-workflow-instance-${instance.id}`}
      style={{
        borderTop: '1px solid var(--kp-border)',
        marginTop: 10,
        paddingTop: 10,
      }}
    >
      <strong>{instance.householdLabel}</strong>
      <span style={mutedStyle}>
        {' '}
        ·{' '}
        {instance.status === 'completed'
          ? 'workflow complete'
          : `${String(steps.filter((step) => step.status === 'done').length)} of ${String(steps.length)} complete`}
      </span>
      {steps.map((step) => {
        const choices = instance.outcomesByStep?.[step.stepId] ?? [];
        return (
          <div
            key={step.stepId}
            data-testid={`crm-live-workflow-instance-step-${step.stepId}`}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
              padding: '7px 0',
            }}
          >
            <span>{step.status === 'done' ? '✓' : '□'}</span>
            <strong>{liveStepTitle(instance, step.stepId)}</strong>
            {mountWorkflowStepExtensions({
              instance,
              stepId: step.stepId,
              saveStepMetadata: (patch) =>
                saveWorkflowStepMetadata(
                  instance,
                  step.stepId,
                  patch,
                  onSaveStepMetadata
                ),
              compatibilityMount: (
                <>
                  {step.status === 'done' ? (
                    <span style={mutedStyle}>
                      {step.outcome ? `Completed: ${step.outcome}. ` : ''}
                      Completed work stays as it is.
                    </span>
                  ) : (
                    <>
                      <>
                        {choices.length > 0 && (
                          <select
                            data-testid={`crm-live-workflow-outcome-choice-${instance.id}-${step.stepId}`}
                            value={outcomeIds[step.stepId] ?? ''}
                            onChange={(event) => {
                              setOutcomeIds((current) => ({
                                ...current,
                                [step.stepId]: event.target.value,
                              }));
                            }}
                          >
                            <option value="">Choose an outcome</option>
                            {choices.map((outcome) => (
                              <option key={outcome.id} value={outcome.id}>
                                {outcome.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </>
                      <div
                        style={{
                          alignItems: 'center',
                          display: 'inline-flex',
                          flexWrap: 'wrap',
                          gap: 8,
                        }}
                      >
                        <Button
                          size="sm"
                          variant="secondary"
                          data-testid={`crm-live-workflow-complete-${instance.id}-${step.stepId}`}
                          onClick={() => {
                            try {
                              const completed = applyWorkflowStepCompletion(
                                instance,
                                step.stepId,
                                outcomeIds[step.stepId]
                              );
                              setCompletionRefusal(null);
                              void onSave(completed).catch(
                                (saveReason: unknown) => {
                                  setCompletionRefusal({
                                    stepId: step.stepId,
                                    message:
                                      saveReason instanceof Error
                                        ? saveReason.message
                                        : String(saveReason),
                                  });
                                }
                              );
                            } catch (reason) {
                              if (
                                reason instanceof WorkflowCompletionRefusedError
                              ) {
                                setCompletionRefusal({
                                  stepId: step.stepId,
                                  message: reason.message,
                                });
                                return;
                              }
                              void onSave(() => {
                                throw reason;
                              }).catch((saveReason: unknown) => {
                                setCompletionRefusal({
                                  stepId: step.stepId,
                                  message:
                                    saveReason instanceof Error
                                      ? saveReason.message
                                      : String(saveReason),
                                });
                              });
                            }
                          }}
                        >
                          Complete step
                        </Button>
                        {completionRefusal?.stepId === step.stepId ? (
                          <p
                            data-testid={`crm-live-workflow-completion-refusal-${instance.id}-${step.stepId}`}
                            ref={completionRefusalRef}
                            role="alert"
                            tabIndex={-1}
                            style={{
                              color: 'var(--kp-danger)',
                              fontWeight: 600,
                              margin: 0,
                            }}
                          >
                            {completionRefusal.message}
                          </p>
                        ) : null}
                      </div>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    data-testid={`crm-live-workflow-edit-local-${instance.id}-${step.stepId}`}
                    onClick={() => {
                      setEditingStep(step.stepId);
                      setLocalTitle(liveStepTitle(instance, step.stepId));
                    }}
                  >
                    Edit for this household
                  </Button>
                  {editingStep === step.stepId && (
                    <span>
                      <input
                        ref={editInputRef}
                        data-testid={`crm-live-workflow-local-title-${instance.id}-${step.stepId}`}
                        value={localTitle}
                        onChange={(event) => {
                          setLocalTitle(event.target.value);
                        }}
                      />
                      <Button
                        size="sm"
                        data-testid={`crm-live-workflow-local-save-${instance.id}-${step.stepId}`}
                        onClick={() => {
                          void onSave(
                            renameWorkflowStepLocally(
                              instance,
                              step.stepId,
                              localTitle
                            )
                          );
                          setEditingStep(null);
                        }}
                      >
                        Save
                      </Button>
                    </span>
                  )}
                  <div
                    data-testid="crm-live-workflow-step-comment"
                    style={{ width: '100%' }}
                  >
                    <textarea
                      data-testid={`crm-live-workflow-step-note-${instance.id}-${step.stepId}`}
                      value={notes[step.stepId] ?? ''}
                      placeholder="Add an internal step comment"
                      onChange={(event) => {
                        setNotes((current) => ({
                          ...current,
                          [step.stepId]: event.target.value,
                        }));
                      }}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      data-testid={`crm-live-workflow-save-note-${instance.id}-${step.stepId}`}
                      disabled={!notes[step.stepId]?.trim()}
                      onClick={() => {
                        void onSave(
                          addWorkflowStepNote(
                            instance,
                            step.stepId,
                            notes[step.stepId] ?? ''
                          )
                        );
                        setNotes((current) => ({
                          ...current,
                          [step.stepId]: '',
                        }));
                      }}
                    >
                      Save comment
                    </Button>
                    {step.stepNotes && (
                      <p
                        data-testid={`crm-live-workflow-step-notes-${instance.id}-${step.stepId}`}
                        style={mutedStyle}
                      >
                        {step.stepNotes}
                      </p>
                    )}
                  </div>
                </>
              ),
            })}
          </div>
        );
      })}
    </section>
  );
}
